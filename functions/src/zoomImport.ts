import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  audioStoragePath,
  type RecordingDoc,
  type ZoomImportRow,
} from '@sabeel/shared';
import { auditedCall } from './audited';
import { reportedCall } from './reported';
import { requireClassScope, requireStaff } from './guards';
import { MAX_AUDIO_BYTES, createRecordingDraft, finalizeRecording } from './recordings';
import { ZOOM_SECRETS, zoomClient, type ZoomClient } from './zoom';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Stream the audio into a recording, finalize it, and settle its status.
 *
 * On success the recording is a ready draft (status draft, attentionReason
 * cleared — that also un-sticks a retried import). On failure the recording is
 * left in `needsAttention` with a reason, so staff can retry it rather than
 * losing the draft.
 */
async function downloadIntoRecording(
  recordingId: string,
  downloadUrl: string,
  durationSec: number,
  dueDate: string | null,
  client: ZoomClient,
): Promise<void> {
  const ref = getFirestore().collection(COLLECTIONS.recordings).doc(recordingId);
  try {
    await client.streamToStorage(downloadUrl, audioStoragePath(recordingId));
    await finalizeRecording({ recordingId, durationSec });
    await ref.update({
      status: 'draft',
      attentionReason: FieldValue.delete(),
      updatedAt: Date.now(),
      ...(dueDate ? { dueDate } : {}),
    });
  } catch (e) {
    const reason = `Zoom import failed: ${(e as Error).message}`.slice(0, 300);
    await ref.update({ status: 'needsAttention', attentionReason: reason, updatedAt: Date.now() });
    throw new HttpsError('internal', reason);
  }
}

/** Import one Zoom recording into a class as a draft. Idempotent on the meeting UUID. */
export async function applyImportZoomRecording(
  callerUid: string,
  input: { meetingUuid: string; fileId: string; classId: string; dueDate: string | null },
  client: ZoomClient,
): Promise<{ recordingId: string; alreadyExisted: boolean }> {
  const db = getFirestore();
  // Dedupe: one Zoom recording maps to at most one app recording.
  const dupe = await db
    .collection(COLLECTIONS.recordings)
    .where('zoomUuid', '==', input.meetingUuid)
    .limit(1)
    .get();
  if (!dupe.empty) return { recordingId: dupe.docs[0].id, alreadyExisted: true };

  // Re-read the meeting for a FRESH download URL + authoritative metadata.
  const { rec, downloadUrl } = await client.freshAudioFile(input.meetingUuid, input.fileId);
  if (rec.sizeBytes > MAX_AUDIO_BYTES) {
    const mb = Math.round(MAX_AUDIO_BYTES / 1024 / 1024);
    throw new HttpsError('failed-precondition', `That recording's audio is larger than the ${mb} MB limit.`);
  }

  const title = (rec.topic.trim() || 'Zoom recording').slice(0, 200);
  const parsed = Date.parse(rec.startTime);
  const recordedAt = Number.isFinite(parsed) ? parsed : null;
  const { id } = await createRecordingDraft(
    callerUid,
    { classId: input.classId, title, recordedAt },
    { source: 'zoom', zoomUuid: input.meetingUuid, zoomFileId: rec.fileId },
  );

  await downloadIntoRecording(id, downloadUrl, rec.durationSec, input.dueDate, client);
  return { recordingId: id, alreadyExisted: false };
}

/** Retry a failed Zoom import using the refs stored on the recording. */
export async function applyRetryZoomImport(
  recordingId: string,
  client: ZoomClient,
): Promise<{ recordingId: string }> {
  const snap = await getFirestore().collection(COLLECTIONS.recordings).doc(recordingId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such recording.');
  const rec = snap.data() as RecordingDoc;
  if (rec.source !== 'zoom' || !rec.zoomUuid || !rec.zoomFileId) {
    throw new HttpsError('failed-precondition', 'That recording is not a Zoom import.');
  }
  const { rec: fresh, downloadUrl } = await client.freshAudioFile(rec.zoomUuid, rec.zoomFileId);
  await downloadIntoRecording(recordingId, downloadUrl, fresh.durationSec, null, client);
  return { recordingId };
}

// ---------------------------------------------------------------- callables --

export const listZoomRecordings = reportedCall(async (req) => {
  requireStaff(req); // the central list is not class-specific
  const d = req.data as { from?: unknown; to?: unknown };
  const from = typeof d?.from === 'string' ? d.from : '';
  const to = typeof d?.to === 'string' ? d.to : '';
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
    throw new HttpsError('invalid-argument', 'from and to must be YYYY-MM-DD.');
  }
  const recs = await zoomClient.listAudioRecordings(from, to);

  // Annotate already-imported by loading every zoom-sourced recording once.
  const imported = await getFirestore()
    .collection(COLLECTIONS.recordings)
    .where('source', '==', 'zoom')
    .get();
  const byUuid = new Map<string, string>();
  for (const doc of imported.docs) {
    const z = (doc.data() as RecordingDoc).zoomUuid;
    if (z) byUuid.set(z, doc.id);
  }
  const rows: ZoomImportRow[] = recs.map((r) => ({ ...r, alreadyImported: byUuid.get(r.meetingUuid) ?? null }));
  return rows;
}, ZOOM_SECRETS);

export const importZoomRecording = auditedCall(
  'importZoomRecording',
  async (req, audit) => {
    const d = req.data as {
      meetingUuid?: unknown;
      fileId?: unknown;
      classId?: unknown;
      dueDate?: unknown;
    };
    if (typeof d?.meetingUuid !== 'string' || !d.meetingUuid) {
      throw new HttpsError('invalid-argument', 'meetingUuid is required.');
    }
    if (typeof d?.fileId !== 'string' || !d.fileId) {
      throw new HttpsError('invalid-argument', 'fileId is required.');
    }
    if (typeof d?.classId !== 'string' || !d.classId) {
      throw new HttpsError('invalid-argument', 'classId is required.');
    }
    const dueDate = typeof d.dueDate === 'string' && DATE_ONLY.test(d.dueDate) ? d.dueDate : null;
    const uid = await requireClassScope(req, d.classId);
    audit.classId = d.classId;
    const res = await applyImportZoomRecording(
      uid,
      { meetingUuid: d.meetingUuid, fileId: d.fileId, classId: d.classId, dueDate },
      zoomClient,
    );
    audit.targets = { recordingId: res.recordingId, classId: d.classId };
    return res;
  },
  ZOOM_SECRETS,
);

export const retryZoomImport = auditedCall(
  'retryZoomImport',
  async (req, audit) => {
    const d = req.data as { recordingId?: unknown };
    if (typeof d?.recordingId !== 'string' || !d.recordingId) {
      throw new HttpsError('invalid-argument', 'recordingId is required.');
    }
    const snap = await getFirestore().collection(COLLECTIONS.recordings).doc(d.recordingId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such recording.');
    const classId = (snap.data() as RecordingDoc).classId;
    await requireClassScope(req, classId);
    audit.classId = classId;
    return applyRetryZoomImport(d.recordingId, zoomClient);
  },
  ZOOM_SECRETS,
);
