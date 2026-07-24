import { HttpsError } from 'firebase-functions/v2/https';
import { auditedCall } from './audited';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  COLLECTIONS,
  audioStoragePath,
  canTransition,
  publishBlockers,
  type RecordingDoc,
  type RecordingSource,
  type RecordingStatus,
  type SessionDoc,
} from '@sabeel/shared';
import { requireAdmin, requireCourseScope } from './guards';

/** Max upload size, mirrored in storage.rules. A 2-hour 128 kbps M4A is ~115 MB;
 *  300 MB leaves room without letting a video file through by accident. */
export const MAX_AUDIO_BYTES = 300 * 1024 * 1024;

// ---------------------------------------------------------------- create --

export interface CreateRecordingInput {
  sessionId: string;
}

export function validateCreateRecording(data: unknown): CreateRecordingInput {
  const d = data as Partial<CreateRecordingInput> | null;
  if (typeof d?.sessionId !== 'string' || !d.sessionId) {
    throw new HttpsError('invalid-argument', 'sessionId is required.');
  }
  return { sessionId: d.sessionId };
}

/**
 * Create the draft recording for a session, BEFORE any audio exists.
 *
 * This ordering is what makes the upload safe: course scope is checked here,
 * server-side, and the client is handed an id it may then write audio to. The
 * meeting metadata (title/date/due/notes) lives on the session; the recording is
 * pure media. Refuses a session that already has a recording (0..1), and links
 * both directions (recording.sessionId + session.recordingId).
 */
export async function createRecordingDraft(
  callerUid: string,
  input: CreateRecordingInput,
  // Zoom import reuses this exact path but stamps its source + dedupe refs.
  origin: { source?: RecordingSource; zoomUuid?: string; zoomFileId?: string } = {},
) {
  const db = getFirestore();
  const sessionRef = db.collection(COLLECTIONS.sessions).doc(input.sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'No such session.');
  const session = sessionSnap.data() as SessionDoc;
  if (session.recordingId) {
    throw new HttpsError('failed-precondition', 'This session already has a recording.');
  }

  const doc: RecordingDoc = {
    sessionId: input.sessionId,
    courseId: session.courseId,
    cohortId: session.cohortId,
    status: 'draft',
    source: origin.source ?? 'manual',
    audioPath: null,
    durationSec: null,
    sizeBytes: null,
    createdAt: Date.now(),
    createdBy: callerUid,
    updatedAt: Date.now(),
    ...(origin.zoomUuid ? { zoomUuid: origin.zoomUuid } : {}),
    ...(origin.zoomFileId ? { zoomFileId: origin.zoomFileId } : {}),
  };
  const ref = await db.collection(COLLECTIONS.recordings).add(doc);
  await sessionRef.update({ recordingId: ref.id, updatedAt: Date.now() });
  return { id: ref.id, audioPath: audioStoragePath(ref.id) };
}

export const createRecording = auditedCall('createRecording', async (req, audit) => {
  const input = validateCreateRecording(req.data);
  const db = getFirestore();
  const sessionSnap = await db.collection(COLLECTIONS.sessions).doc(input.sessionId).get();
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'No such session.');
  const courseId = (sessionSnap.data() as SessionDoc).courseId;
  const uid = await requireCourseScope(req, courseId);
  audit.courseId = courseId;
  audit.targets = { sessionId: input.sessionId };
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
  const courseId = (rec.data() as RecordingDoc).courseId;
  await requireCourseScope(req, courseId);
  audit.courseId = courseId;
  return finalizeRecording(input);
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
  const courseId = (rec.data() as RecordingDoc).courseId;
  await requireCourseScope(req, courseId);
  audit.courseId = courseId;
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
  const courseId = (rec.data() as RecordingDoc).courseId;
  await requireCourseScope(req, courseId);
  audit.courseId = courseId;
  return clearAudio(d.recordingId);
});

// Everything that references a recording by id, so a permanent delete leaves no
// orphans. All are keyed on a `recordingId` field (single-field equality → no
// composite index needed).
const RECORDING_DEPENDENTS = [
  COLLECTIONS.assignments,
  COLLECTIONS.completions,
  COLLECTIONS.completionEvents,
  COLLECTIONS.listeningProgress,
  COLLECTIONS.completionOverrides,
] as const;

/**
 * PERMANENTLY delete a recording — the one destructive path (everything else is
 * archive/unpublish, which is reversible). Reclaiming storage is the only real
 * reason to reach for it. Refuses a live (published) recording: unpublish or
 * archive first, so a delete can never silently pull a recording out from under
 * students mid-term. Cascades so no assignment/completion/progress/override doc
 * is left pointing at a recording that no longer exists.
 */
export async function applyDeleteRecording(recordingId: string) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.recordings).doc(recordingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such recording.');
  const rec = snap.data() as RecordingDoc;
  if (rec.status === 'published') {
    throw new HttpsError(
      'failed-precondition',
      'Unpublish or archive a live recording before deleting it permanently.',
    );
  }

  // 1. Dependent docs, chunked under the 500-writes/batch cap (a roster is far
  //    smaller, but a recording old enough to delete could have accumulated a
  //    doc per student across several collections).
  const commits: Promise<unknown>[] = [];
  for (const coll of RECORDING_DEPENDENTS) {
    const q = await db.collection(coll).where('recordingId', '==', recordingId).get();
    for (let i = 0; i < q.docs.length; i += 400) {
      const batch = db.batch();
      for (const doc of q.docs.slice(i, i + 400)) batch.delete(doc.ref);
      commits.push(batch.commit());
    }
  }
  await Promise.all(commits);

  // 2. The audio object (draft recordings may have none).
  if (rec.audioPath) {
    await getStorage().bucket().file(rec.audioPath).delete({ ignoreNotFound: true });
  }

  // 3. The recording itself, and clear the session's pointer so a new recording
  //    can be added. The session may itself be mid-delete — a harmless no-op then.
  await ref.delete();
  await db
    .collection(COLLECTIONS.sessions)
    .doc(rec.sessionId)
    .update({ recordingId: null, updatedAt: Date.now() })
    .catch(() => undefined);
  return { recordingId, courseId: rec.courseId };
}

export const deleteRecording = auditedCall('deleteRecording', async (req, audit) => {
  requireAdmin(req); // permanent deletion is admin-only, always
  const d = req.data as { recordingId?: unknown };
  if (typeof d?.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  const res = await applyDeleteRecording(d.recordingId);
  audit.courseId = res.courseId; // recordingId target is auto-picked from req.data
  return { recordingId: res.recordingId };
});
