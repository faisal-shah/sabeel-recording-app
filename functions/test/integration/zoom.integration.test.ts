import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  EMULATOR_STORAGE_BUCKET,
  audioStoragePath,
  type RecordingDoc,
} from '@sabeel/shared';
import { createCohortRecord } from '../../src/cohorts';
import { createCourseRecord } from '../../src/courses';
import { MAX_AUDIO_BYTES } from '../../src/recordings';
import { applyImportZoomRecording, applyRetryZoomImport } from '../../src/zoomImport';
import type { ZoomAudioRecording, ZoomClient } from '../../src/zoom';

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: EMULATOR_PROJECT_ID, storageBucket: EMULATOR_STORAGE_BUCKET });
  }
});

const ADMIN = 'admin-uid';

async function clearAll() {
  const db = getFirestore();
  for (const c of [COLLECTIONS.cohorts, COLLECTIONS.courses, COLLECTIONS.recordings]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await getStorage().bucket().deleteFiles({ prefix: 'recordings/' }).catch(() => undefined);
}

let courseId = '';
beforeEach(async () => {
  await clearAll();
  const { id: cohortId } = await createCohortRecord(ADMIN, 'C');
  ({ id: courseId } = await createCourseRecord(ADMIN, { cohortId, name: 'K' }));
});

const REC: ZoomAudioRecording = {
  meetingUuid: 'uuid-1',
  topic: 'Zoom Session One',
  startTime: '2026-05-07T18:00:00Z',
  durationSec: 300,
  fileId: 'file-1',
  sizeBytes: 4096,
};

/** A ZoomClient that serves one recording and writes fake bytes on download. */
function fakeClient(rec: ZoomAudioRecording, opts: { fail?: boolean } = {}): ZoomClient {
  return {
    async listAudioRecordings() {
      return [rec];
    },
    async freshAudioFile(meetingUuid, fileId) {
      return { rec, downloadUrl: `fake://${meetingUuid}/${fileId}` };
    },
    async streamToStorage(_downloadUrl, storagePath) {
      if (opts.fail) throw new Error('network boom');
      await getStorage()
        .bucket()
        .file(storagePath)
        .save(Buffer.alloc(rec.sizeBytes || 4096), { contentType: 'audio/mp4' });
    },
  };
}

const rec = async (id: string) =>
  (await getFirestore().collection(COLLECTIONS.recordings).doc(id).get()).data() as RecordingDoc;
const countRecordings = async () =>
  (await getFirestore().collection(COLLECTIONS.recordings).get()).size;
const audioExists = async (id: string) =>
  (await getStorage().bucket().file(audioStoragePath(id)).exists())[0];

describe('applyImportZoomRecording', () => {
  it('creates a ready draft: source zoom, dedupe key, metadata, audio finalized', async () => {
    const res = await applyImportZoomRecording(
      ADMIN,
      { meetingUuid: 'uuid-1', fileId: 'file-1', courseId, dueDate: null },
      fakeClient(REC),
    );
    expect(res.alreadyExisted).toBe(false);
    const d = await rec(res.recordingId);
    expect(d).toMatchObject({
      courseId,
      source: 'zoom',
      status: 'draft',
      zoomUuid: 'uuid-1',
      zoomFileId: 'file-1',
      title: 'Zoom Session One',
      durationSec: 300,
    });
    expect(d.recordedAt).toBe(Date.parse('2026-05-07T18:00:00Z'));
    expect(d.audioPath).toBe(audioStoragePath(res.recordingId));
    expect(d.sizeBytes).toBe(4096); // read from Storage, not trusted from Zoom
    expect(await audioExists(res.recordingId)).toBe(true);
  });

  it('applies a due date when given', async () => {
    const res = await applyImportZoomRecording(
      ADMIN,
      { meetingUuid: 'uuid-1', fileId: 'file-1', courseId, dueDate: '2026-08-01' },
      fakeClient(REC),
    );
    expect((await rec(res.recordingId)).dueDate).toBe('2026-08-01');
  });

  it('is idempotent on the meeting UUID — a second import links, not duplicates', async () => {
    const first = await applyImportZoomRecording(
      ADMIN,
      { meetingUuid: 'uuid-1', fileId: 'file-1', courseId, dueDate: null },
      fakeClient(REC),
    );
    const again = await applyImportZoomRecording(
      ADMIN,
      { meetingUuid: 'uuid-1', fileId: 'file-1', courseId, dueDate: null },
      fakeClient(REC),
    );
    expect(again).toEqual({ recordingId: first.recordingId, alreadyExisted: true });
    expect(await countRecordings()).toBe(1);
  });

  it('refuses an oversize recording and creates NOTHING', async () => {
    await expect(
      applyImportZoomRecording(
        ADMIN,
        { meetingUuid: 'uuid-1', fileId: 'file-1', courseId, dueDate: null },
        fakeClient({ ...REC, sizeBytes: MAX_AUDIO_BYTES + 1 }),
      ),
    ).rejects.toThrow(/larger than/i);
    expect(await countRecordings()).toBe(0);
  });

  it('a download failure leaves the draft in needs-attention with a reason', async () => {
    await expect(
      applyImportZoomRecording(
        ADMIN,
        { meetingUuid: 'uuid-1', fileId: 'file-1', courseId, dueDate: null },
        fakeClient(REC, { fail: true }),
      ),
    ).rejects.toThrow(/import failed/i);
    // The draft exists (so it can be retried), in needs-attention, with no audio.
    const snap = await getFirestore()
      .collection(COLLECTIONS.recordings)
      .where('zoomUuid', '==', 'uuid-1')
      .get();
    expect(snap.size).toBe(1);
    const d = snap.docs[0].data() as RecordingDoc;
    expect(d.status).toBe('needsAttention');
    expect(d.attentionReason).toMatch(/import failed/i);
    expect(await audioExists(snap.docs[0].id)).toBe(false);
  });
});

describe('applyRetryZoomImport', () => {
  it('re-downloads a failed import and moves it back to a ready draft', async () => {
    // First, a failed import.
    await applyImportZoomRecording(
      ADMIN,
      { meetingUuid: 'uuid-1', fileId: 'file-1', courseId, dueDate: null },
      fakeClient(REC, { fail: true }),
    ).catch(() => undefined);
    const failed = (
      await getFirestore().collection(COLLECTIONS.recordings).where('zoomUuid', '==', 'uuid-1').get()
    ).docs[0];
    expect((failed.data() as RecordingDoc).status).toBe('needsAttention');

    // Retry with a working client.
    await applyRetryZoomImport(failed.id, fakeClient(REC));
    const d = await rec(failed.id);
    expect(d.status).toBe('draft');
    expect(d.attentionReason).toBeUndefined();
    expect(d.audioPath).toBe(audioStoragePath(failed.id));
    expect(await audioExists(failed.id)).toBe(true);
  });

  it('refuses to retry a non-Zoom recording', async () => {
    const ref = await getFirestore().collection(COLLECTIONS.recordings).add({
      courseId,
      source: 'manual',
      status: 'needsAttention',
    } as Partial<RecordingDoc> as RecordingDoc);
    await expect(applyRetryZoomImport(ref.id, fakeClient(REC))).rejects.toThrow(/not a Zoom import/i);
  });
});
