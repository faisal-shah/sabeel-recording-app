import { HttpsError } from 'firebase-functions/v2/https';
import { auditedCall } from './audited';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  COLLECTIONS,
  audioStoragePath,
  canTransition,
  publishBlockers,
  type ClassDoc,
  type RecordingDoc,
  type RecordingStatus,
} from '@sabeel/shared';
import { requireClassScope } from './guards';

/** Max upload size, mirrored in storage.rules. A 2-hour 128 kbps M4A is ~115 MB;
 *  300 MB leaves room without letting a video file through by accident. */
export const MAX_AUDIO_BYTES = 300 * 1024 * 1024;

// ---------------------------------------------------------------- create --

export interface CreateRecordingInput {
  classId: string;
  title: string;
  recordedAt: number | null;
}

export function validateCreateRecording(data: unknown): CreateRecordingInput {
  const d = data as Partial<CreateRecordingInput> | null;
  if (typeof d?.classId !== 'string' || !d.classId) {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }
  const title = typeof d.title === 'string' ? d.title.trim() : '';
  if (!title) throw new HttpsError('invalid-argument', 'A title is required.');
  if (title.length > 200) throw new HttpsError('invalid-argument', 'That title is too long.');
  const recordedAt =
    d.recordedAt === null || d.recordedAt === undefined
      ? null
      : typeof d.recordedAt === 'number' && Number.isFinite(d.recordedAt)
        ? d.recordedAt
        : (() => {
            throw new HttpsError('invalid-argument', 'recordedAt must be epoch ms or null.');
          })();
  return { classId: d.classId, title, recordedAt };
}

/**
 * Create the draft BEFORE any audio exists.
 *
 * This ordering is what makes the upload safe: class scope is checked here,
 * server-side, and the client is handed an id it may then write audio to.
 * Storage rules cannot read Firestore, so they can only check "is staff" — the
 * authorization that matters happens at this call and again at publish.
 */
export async function createRecordingDraft(callerUid: string, input: CreateRecordingInput) {
  const db = getFirestore();
  const clsSnap = await db.collection(COLLECTIONS.classes).doc(input.classId).get();
  if (!clsSnap.exists) throw new HttpsError('not-found', 'No such class.');

  const doc: RecordingDoc = {
    cohortId: (clsSnap.data() as ClassDoc).cohortId,
    classId: input.classId,
    title: input.title,
    status: 'draft',
    source: 'manual',
    recordedAt: input.recordedAt,
    dueDate: null,
    notes: '',
    audioPath: null,
    durationSec: null,
    sizeBytes: null,
    createdAt: Date.now(),
    createdBy: callerUid,
    updatedAt: Date.now(),
  };
  const ref = await db.collection(COLLECTIONS.recordings).add(doc);
  return { id: ref.id, audioPath: audioStoragePath(ref.id) };
}

export const createRecording = auditedCall('createRecording', async (req, audit) => {
  const input = validateCreateRecording(req.data);
  const uid = await requireClassScope(req, input.classId);
  audit.classId = input.classId;
  return createRecordingDraft(uid, input);
});

// -------------------------------------------------------------- finalize --

export interface FinalizeInput {
  recordingId: string;
  durationSec: number | null;
}

export function validateFinalize(data: unknown): FinalizeInput {
  const d = data as Partial<FinalizeInput> | null;
  if (typeof d?.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  if (d.durationSec !== null && d.durationSec !== undefined) {
    if (typeof d.durationSec !== 'number' || !Number.isFinite(d.durationSec) || d.durationSec <= 0) {
      throw new HttpsError('invalid-argument', 'durationSec must be a positive number or null.');
    }
  }
  return { recordingId: d.recordingId, durationSec: d.durationSec ?? null };
}

/**
 * Confirm the upload landed, and record what actually arrived.
 *
 * The client reports duration (it has the decoded media; the server would need
 * ffmpeg to find out) but the server reads SIZE from Storage rather than
 * trusting it — size is the one field a wrong value could be used to argue
 * about, and it costs one metadata call to get right. Duration is advisory: a
 * wrong value mis-draws a progress bar and nothing more.
 *
 * Marking `audioPath` only after the object is confirmed present is what stops a
 * failed upload leaving a publishable-looking draft behind.
 */
export async function finalizeRecording(input: FinalizeInput) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.recordings).doc(input.recordingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such recording.');

  const path = audioStoragePath(input.recordingId);
  const file = getStorage().bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError('failed-precondition', 'No audio found for that recording.');
  }
  const [meta] = await file.getMetadata();
  const sizeBytes = Number(meta.size ?? 0);
  if (sizeBytes > MAX_AUDIO_BYTES) {
    throw new HttpsError('failed-precondition', 'That audio file is too large.');
  }

  await ref.update({
    audioPath: path,
    sizeBytes,
    durationSec: input.durationSec,
    updatedAt: Date.now(),
  });
  return { recordingId: input.recordingId, audioPath: path, sizeBytes };
}

export const finalizeRecordingUpload = auditedCall('finalizeRecordingUpload', async (req, audit) => {
  const input = validateFinalize(req.data);
  const rec = await getFirestore().collection(COLLECTIONS.recordings).doc(input.recordingId).get();
  if (!rec.exists) throw new HttpsError('not-found', 'No such recording.');
  const classId = (rec.data() as RecordingDoc).classId;
  await requireClassScope(req, classId);
  audit.classId = classId;
  return finalizeRecording(input);
});

// ---------------------------------------------------------------- update --

export interface UpdateRecordingInput {
  recordingId: string;
  title?: string;
  notes?: string;
  dueDate?: string | null;
  recordedAt?: number | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function validateUpdateRecording(data: unknown): UpdateRecordingInput {
  const d = data as Partial<UpdateRecordingInput> | null;
  if (typeof d?.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  const out: UpdateRecordingInput = { recordingId: d.recordingId };
  if (d.title !== undefined) {
    const title = typeof d.title === 'string' ? d.title.trim() : '';
    if (!title) throw new HttpsError('invalid-argument', 'A title cannot be empty.');
    out.title = title;
  }
  if (d.notes !== undefined) {
    if (typeof d.notes !== 'string') {
      throw new HttpsError('invalid-argument', 'notes must be text.');
    }
    out.notes = d.notes;
  }
  if (d.dueDate !== undefined) {
    if (d.dueDate !== null && (typeof d.dueDate !== 'string' || !DATE_ONLY.test(d.dueDate))) {
      // Date-only by design: due dates are a day, not an instant, so storing a
      // timestamp would invite a timezone bug that only shows up near midnight.
      throw new HttpsError('invalid-argument', 'dueDate must be YYYY-MM-DD or null.');
    }
    out.dueDate = d.dueDate;
  }
  if (d.recordedAt !== undefined) {
    if (d.recordedAt !== null && typeof d.recordedAt !== 'number') {
      throw new HttpsError('invalid-argument', 'recordedAt must be epoch ms or null.');
    }
    out.recordedAt = d.recordedAt;
  }
  if (Object.keys(out).length === 1) {
    throw new HttpsError('invalid-argument', 'Nothing to change.');
  }
  return out;
}

export async function applyRecordingUpdate(input: UpdateRecordingInput) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.recordings).doc(input.recordingId);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'No such recording.');

  const { recordingId: _id, ...fields } = input;
  await ref.update({ ...fields, updatedAt: Date.now() });
  return { recordingId: input.recordingId, ...fields };
}

export const updateRecording = auditedCall('updateRecording', async (req, audit) => {
  const input = validateUpdateRecording(req.data);
  const rec = await getFirestore().collection(COLLECTIONS.recordings).doc(input.recordingId).get();
  if (!rec.exists) throw new HttpsError('not-found', 'No such recording.');
  const classId = (rec.data() as RecordingDoc).classId;
  await requireClassScope(req, classId);
  audit.classId = classId;
  return applyRecordingUpdate(input);
});

// ---------------------------------------------------------------- status --

export interface SetStatusInput {
  recordingId: string;
  status: RecordingStatus;
  attentionReason?: string;
}

const STATUSES: RecordingStatus[] = [
  'draft',
  'published',
  'archived',
  'unpublished',
  'needsAttention',
];

export function validateSetStatus(data: unknown): SetStatusInput {
  const d = data as Partial<SetStatusInput> | null;
  if (typeof d?.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  if (!STATUSES.includes(d.status as RecordingStatus)) {
    throw new HttpsError('invalid-argument', 'Unknown status.');
  }
  return {
    recordingId: d.recordingId,
    status: d.status as RecordingStatus,
    attentionReason: typeof d.attentionReason === 'string' ? d.attentionReason : undefined,
  };
}

/**
 * Move a recording through its lifecycle, refusing anything the state machine
 * does not draw — and refusing to publish something that is not ready.
 *
 * Both checks live here rather than in the UI, because the UI hiding a button is
 * convenience and this is the boundary.
 */
export async function applyRecordingStatus(input: SetStatusInput) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.recordings).doc(input.recordingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such recording.');
  const current = snap.data() as RecordingDoc;

  if (!canTransition(current.status, input.status)) {
    throw new HttpsError(
      'failed-precondition',
      `A ${current.status} recording cannot become ${input.status}.`,
    );
  }

  if (input.status === 'published') {
    const blockers = publishBlockers({ ...current, status: current.status });
    if (blockers.length > 0) {
      throw new HttpsError('failed-precondition', `Not ready to publish: ${blockers.join(', ')}.`);
    }
  }

  const update: Record<string, unknown> = { status: input.status, updatedAt: Date.now() };
  if (input.status === 'published' && !current.publishedAt) update.publishedAt = Date.now();
  if (input.status === 'needsAttention') update.attentionReason = input.attentionReason ?? '';
  await ref.update(update);
  return { recordingId: input.recordingId, status: input.status };
}

export const setRecordingStatus = auditedCall('setRecordingStatus', async (req, audit) => {
  const input = validateSetStatus(req.data);
  const rec = await getFirestore().collection(COLLECTIONS.recordings).doc(input.recordingId).get();
  if (!rec.exists) throw new HttpsError('not-found', 'No such recording.');
  const classId = (rec.data() as RecordingDoc).classId;
  await requireClassScope(req, classId);
  audit.classId = classId;
  audit.detail = { status: input.status };
  return applyRecordingStatus(input);
});

// ----------------------------------------------------------- clear audio --

/**
 * Delete a recording's audio so it can be re-uploaded.
 *
 * The Storage rule makes the object write-once, which is what stops a published
 * recording's audio being swapped underneath students who have already listened
 * to it. Replacing bad audio therefore has to come through here, and only while
 * the recording is not live.
 */
export async function clearAudio(recordingId: string) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.recordings).doc(recordingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such recording.');
  const current = snap.data() as RecordingDoc;

  if (current.status !== 'draft' && current.status !== 'needsAttention') {
    throw new HttpsError(
      'failed-precondition',
      'Audio can only be replaced while a recording is a draft. Unpublish it first.',
    );
  }

  await getStorage()
    .bucket()
    .file(audioStoragePath(recordingId))
    .delete({ ignoreNotFound: true });
  await ref.update({ audioPath: null, sizeBytes: null, durationSec: null, updatedAt: Date.now() });
  return { recordingId };
}

export const clearRecordingAudio = auditedCall('clearRecordingAudio', async (req, audit) => {
  const d = req.data as { recordingId?: unknown };
  if (typeof d?.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  const rec = await getFirestore().collection(COLLECTIONS.recordings).doc(d.recordingId).get();
  if (!rec.exists) throw new HttpsError('not-found', 'No such recording.');
  const classId = (rec.data() as RecordingDoc).classId;
  await requireClassScope(req, classId);
  audit.classId = classId;
  return clearAudio(d.recordingId);
});
