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
import { createClassRecord } from '../../src/classes';
import { readFileSync } from 'node:fs';
import {
  MAX_AUDIO_BYTES,
  applyRecordingStatus,
  applyRecordingUpdate,
  clearAudio,
  createRecordingDraft,
  finalizeRecording,
  validateCreateRecording,
  validateFinalize,
  validateSetStatus,
  validateUpdateRecording,
} from '../../src/recordings';

beforeAll(() => {
  if (getApps().length === 0) {
    // Same constant the app and the functions use — a hardcoded name here is
    // how the client/server bucket mismatch stayed invisible to this suite.
    initializeApp({ projectId: EMULATOR_PROJECT_ID, storageBucket: EMULATOR_STORAGE_BUCKET });
  }
});

const ADMIN = 'admin-uid';

async function clearAll() {
  const db = getFirestore();
  for (const c of [COLLECTIONS.cohorts, COLLECTIONS.classes, COLLECTIONS.recordings]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  await getStorage().bucket().deleteFiles({ prefix: 'recordings/' }).catch(() => undefined);
}

let classId = '';
beforeEach(async () => {
  await clearAll();
  const { id: cohortId } = await createCohortRecord(ADMIN, 'C');
  ({ id: classId } = await createClassRecord(ADMIN, { cohortId, name: 'K' }));
});

const rec = async (id: string) =>
  (await getFirestore().collection(COLLECTIONS.recordings).doc(id).get()).data() as RecordingDoc;

/** Put bytes at the canonical path, bypassing rules — the client normally does
 *  this with the Storage SDK after createRecording hands out the id. */
async function putAudio(recordingId: string, bytes = 2048) {
  await getStorage()
    .bucket()
    .file(audioStoragePath(recordingId))
    .save(Buffer.alloc(bytes), { contentType: 'audio/mp4' });
}

describe('createRecordingDraft', () => {
  it('creates a draft with NO audio and inherits the cohort', async () => {
    const { id, audioPath } = await createRecordingDraft(ADMIN, {
      classId,
      title: 'Session 1',
      recordedAt: 1700000000000,
    });
    const d = await rec(id);
    expect(d).toMatchObject({ classId, title: 'Session 1', status: 'draft', source: 'manual' });
    // audioPath stays null until the upload is CONFIRMED — otherwise a failed
    // upload leaves a draft that looks publishable.
    expect(d.audioPath).toBeNull();
    expect(d.cohortId).toBeTruthy();
    expect(audioPath).toBe(audioStoragePath(id));
  });

  it('rejects an unknown class', async () => {
    await expect(
      createRecordingDraft(ADMIN, { classId: 'nope', title: 'x', recordedAt: null }),
    ).rejects.toThrow();
  });
});

describe('finalizeRecording', () => {
  it('reads size from Storage rather than trusting the client', async () => {
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await putAudio(id, 4096);
    const res = await finalizeRecording({ recordingId: id, durationSec: 720 });
    expect(res.sizeBytes).toBe(4096);
    const d = await rec(id);
    expect(d.audioPath).toBe(audioStoragePath(id));
    expect(d.durationSec).toBe(720);
  });

  it('refuses when no audio actually landed', async () => {
    // The upload can fail after the draft exists; without this check the draft
    // would be publishable with nothing behind it.
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await expect(finalizeRecording({ recordingId: id, durationSec: 1 })).rejects.toThrow(/No audio/);
    expect((await rec(id)).audioPath).toBeNull();
  });

  it('accepts a null duration', async () => {
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await putAudio(id);
    await finalizeRecording({ recordingId: id, durationSec: null });
    expect((await rec(id)).durationSec).toBeNull();
  });
});

describe('publishing', () => {
  const ready = async () => {
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await putAudio(id);
    await finalizeRecording({ recordingId: id, durationSec: 60 });
    return id;
  };

  it('publishes a complete draft and stamps publishedAt', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    const d = await rec(id);
    expect(d.status).toBe('published');
    expect(typeof d.publishedAt).toBe('number');
  });

  it('REFUSES to publish a draft with no audio', async () => {
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await expect(
      applyRecordingStatus({ recordingId: id, status: 'published' }),
    ).rejects.toThrow(/audio/);
    expect((await rec(id)).status).toBe('draft');
  });

  it('refuses a transition the state machine does not draw', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    await applyRecordingStatus({ recordingId: id, status: 'unpublished' });
    // unpublished must go back through draft, so the metadata gate reapplies.
    await expect(
      applyRecordingStatus({ recordingId: id, status: 'published' }),
    ).rejects.toThrow(/cannot become/);
    await applyRecordingStatus({ recordingId: id, status: 'draft' });
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    expect((await rec(id)).status).toBe('published');
  });

  it('does not re-stamp publishedAt on a re-publish', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    const first = (await rec(id)).publishedAt;
    await applyRecordingStatus({ recordingId: id, status: 'archived' });
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    expect((await rec(id)).publishedAt).toBe(first);
  });
});

describe('clearAudio', () => {
  it('deletes the object so a replacement can be uploaded', async () => {
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await putAudio(id);
    await finalizeRecording({ recordingId: id, durationSec: 5 });

    await clearAudio(id);
    const [exists] = await getStorage().bucket().file(audioStoragePath(id)).exists();
    expect(exists).toBe(false);
    const d = await rec(id);
    expect(d.audioPath).toBeNull();
    expect(d.sizeBytes).toBeNull();
  });

  it('REFUSES while the recording is live', async () => {
    // The Storage object is write-once, so this callable is the only way to
    // replace audio — which is exactly why it must not work on a published
    // recording students are already listening to.
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await putAudio(id);
    await finalizeRecording({ recordingId: id, durationSec: 5 });
    await applyRecordingStatus({ recordingId: id, status: 'published' });

    await expect(clearAudio(id)).rejects.toThrow(/draft/i);
    const [exists] = await getStorage().bucket().file(audioStoragePath(id)).exists();
    expect(exists).toBe(true);
  });
});

describe('applyRecordingUpdate', () => {
  it('updates metadata and touches updatedAt', async () => {
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    const before = (await rec(id)).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await applyRecordingUpdate({ recordingId: id, title: 'Better', dueDate: '2026-08-01' });
    const d = await rec(id);
    expect(d.title).toBe('Better');
    expect(d.dueDate).toBe('2026-08-01');
    expect(d.updatedAt).toBeGreaterThan(before);
  });

  it('allows clearing the due date', async () => {
    // Null is a real value here: required listening with no deadline, which the
    // brief says never becomes overdue.
    const { id } = await createRecordingDraft(ADMIN, { classId, title: 'T', recordedAt: null });
    await applyRecordingUpdate({ recordingId: id, dueDate: '2026-08-01' });
    await applyRecordingUpdate({ recordingId: id, dueDate: null });
    expect((await rec(id)).dueDate).toBeNull();
  });
});

describe('the size limit is stated in two places and must not drift', () => {
  it('matches the number enforced in storage.rules', () => {
    // The limit has to exist in the rule, because the upload goes straight to
    // Storage — a callable would only see it after the bytes were paid for. It
    // also has to exist in the callable, which re-checks what actually landed.
    // Two copies, so this asserts they agree.
    const rules = readFileSync(new URL('../../../storage.rules', import.meta.url), 'utf8');
    const m = rules.match(/request\.resource\.size\s*<\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(m, 'no size limit found in storage.rules').toBeTruthy();
    expect(Number(m![1]) * 1024 * 1024).toBe(MAX_AUDIO_BYTES);
  });
});

describe('validators', () => {
  it('require a class and a title on create', () => {
    for (const bad of [null, {}, { classId: 'c' }, { title: 'T' }, { classId: 'c', title: '  ' }]) {
      expect(() => validateCreateRecording(bad)).toThrow();
    }
    expect(validateCreateRecording({ classId: 'c', title: ' T ', recordedAt: null })).toEqual({
      classId: 'c',
      title: 'T',
      recordedAt: null,
    });
  });

  it('reject a due date that is not date-only', () => {
    // A timestamp here would invite a timezone bug that only appears near
    // midnight; due dates are a day, not an instant.
    for (const bad of ['2026-8-1', '2026-08-01T00:00:00Z', 'tomorrow', 1234]) {
      expect(() => validateUpdateRecording({ recordingId: 'r', dueDate: bad })).toThrow();
    }
    expect(validateUpdateRecording({ recordingId: 'r', dueDate: '2026-08-01' }).dueDate).toBe(
      '2026-08-01',
    );
  });

  it('reject an empty update', () => {
    expect(() => validateUpdateRecording({ recordingId: 'r' })).toThrow(/Nothing to change/);
  });

  it('reject an unknown status', () => {
    expect(() => validateSetStatus({ recordingId: 'r', status: 'live' })).toThrow();
    expect(validateSetStatus({ recordingId: 'r', status: 'archived' }).status).toBe('archived');
  });

  it('reject a nonsensical duration', () => {
    for (const bad of [0, -5, 'ten', NaN]) {
      expect(() => validateFinalize({ recordingId: 'r', durationSec: bad })).toThrow();
    }
    expect(validateFinalize({ recordingId: 'r', durationSec: null }).durationSec).toBeNull();
  });
});
