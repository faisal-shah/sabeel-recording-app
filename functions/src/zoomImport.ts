import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  audioStoragePath,
  type CourseDoc,
  type CohortDoc,
  type RecordingDoc,
  type ZoomImportRow,
} from '@sabeel/shared';
import { auditedCall } from './audited';
import { reportedCall } from './reported';
import { requireCourseScope, requireStaff } from './guards';
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
  input: { meetingUuid: string; fileId: string; courseId: string; dueDate: string | null },
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
    { courseId: input.courseId, title, recordedAt },
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
  const byUuid = new Map<string, { recordingId: string; courseId: string; cohortId: string }>();
  for (const doc of imported.docs) {
    const data = doc.data() as RecordingDoc;
    if (data.zoomUuid) {
      byUuid.set(data.zoomUuid, { recordingId: doc.id, courseId: data.courseId, cohortId: data.cohortId });
    }
  }

  // Resolve the class + cohort names for the recordings actually referenced, so
  // an already-imported row can name its class and be tapped through to it.
  const db = getFirestore();
  const courseNames = new Map<string, string>();
  const cohortNames = new Map<string, string>();
  const courseIds = new Set([...byUuid.values()].map((v) => v.courseId));
  const cohortIds = new Set([...byUuid.values()].map((v) => v.cohortId));
  await Promise.all([
    ...[...courseIds].map(async (id) => {
      const s = await db.collection(COLLECTIONS.courses).doc(id).get();
      if (s.exists) courseNames.set(id, (s.data() as CourseDoc).name);
    }),
    ...[...cohortIds].map(async (id) => {
      const s = await db.collection(COLLECTIONS.cohorts).doc(id).get();
      if (s.exists) cohortNames.set(id, (s.data() as CohortDoc).name);
    }),
  ]);

  const rows: ZoomImportRow[] = recs.map((r) => {
    const imp = byUuid.get(r.meetingUuid);
    return {
      ...r,
      alreadyImported: imp?.recordingId ?? null,
      importedCourseId: imp?.courseId ?? null,
      importedCourseName: imp ? (courseNames.get(imp.courseId) ?? null) : null,
      importedCohortName: imp ? (cohortNames.get(imp.cohortId) ?? null) : null,
    };
  });
  return rows;
}, ZOOM_SECRETS);

export const importZoomRecording = auditedCall(
  'importZoomRecording',
  async (req, audit) => {
    const d = req.data as {
      meetingUuid?: unknown;
      fileId?: unknown;
      courseId?: unknown;
      dueDate?: unknown;
    };
    if (typeof d?.meetingUuid !== 'string' || !d.meetingUuid) {
      throw new HttpsError('invalid-argument', 'meetingUuid is required.');
    }
    if (typeof d?.fileId !== 'string' || !d.fileId) {
      throw new HttpsError('invalid-argument', 'fileId is required.');
    }
    if (typeof d?.courseId !== 'string' || !d.courseId) {
      throw new HttpsError('invalid-argument', 'courseId is required.');
    }
    const dueDate = typeof d.dueDate === 'string' && DATE_ONLY.test(d.dueDate) ? d.dueDate : null;
    const uid = await requireCourseScope(req, d.courseId);
    audit.courseId = d.courseId;
    const res = await applyImportZoomRecording(
      uid,
      { meetingUuid: d.meetingUuid, fileId: d.fileId, courseId: d.courseId, dueDate },
      zoomClient,
    );
    audit.targets = { recordingId: res.recordingId, courseId: d.courseId };
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
    const courseId = (snap.data() as RecordingDoc).courseId;
    await requireCourseScope(req, courseId);
    audit.courseId = courseId;
    return applyRetryZoomImport(d.recordingId, zoomClient);
  },
  ZOOM_SECRETS,
);
