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
  type SessionDoc,
} from '@sabeel/shared';
import { createCohortRecord } from '../../src/cohorts';
import { createCourseRecord } from '../../src/courses';
import { createSessionRecord } from '../../src/sessions';
import { readFileSync } from 'node:fs';
import {
  MAX_AUDIO_BYTES,
  applyDeleteRecording,
  applyRecordingStatus,
  clearAudio,
  createRecordingDraft,
  finalizeRecording,
  validateCreateRecording,
  validateFinalize,
  validateSetStatus,
} from '../../src/recordings';

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: EMULATOR_PROJECT_ID, storageBucket: EMULATOR_STORAGE_BUCKET });
  }
});

const ADMIN = 'admin-uid';

async function clearAll() {
  const db = getFirestore();
  for (const c of [COLLECTIONS.cohorts, COLLECTIONS.courses, COLLECTIONS.sessions, COLLECTIONS.recordings]) {
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

const rec = async (id: string) =>
  (await getFirestore().collection(COLLECTIONS.recordings).doc(id).get()).data() as RecordingDoc;
const session = async (id: string) =>
  (await getFirestore().collection(COLLECTIONS.sessions).doc(id).get()).data() as SessionDoc;

async function newSession(): Promise<string> {
  const { id } = await createSessionRecord(ADMIN, {
    courseId,
    date: '2026-07-06',
    title: 'Session 1',
    dueDate: null,
    notes: '',
  });
  return id;
}

/** A draft recording under a fresh session. Returns both ids. */
async function newDraft(): Promise<{ id: string; sessionId: string }> {
  const sessionId = await newSession();
  const { id } = await createRecordingDraft(ADMIN, { sessionId });
  return { id, sessionId };
}

async function putAudio(recordingId: string, bytes = 2048) {
  await getStorage()
    .bucket()
    .file(audioStoragePath(recordingId))
    .save(Buffer.alloc(bytes), { contentType: 'audio/mp4' });
}

async function ready(): Promise<string> {
  const { id } = await newDraft();
  await putAudio(id);
  await finalizeRecording({ recordingId: id, durationSec: 60 });
  return id;
}

describe('createRecordingDraft', () => {
  it('creates a draft with NO audio, inherits course/cohort, and links the session', async () => {
    const sessionId = await newSession();
    const { id, audioPath } = await createRecordingDraft(ADMIN, { sessionId });
    const d = await rec(id);
    expect(d).toMatchObject({ sessionId, courseId, status: 'draft', source: 'manual' });
    expect(d.audioPath).toBeNull(); // stays null until the upload is CONFIRMED
    expect(d.cohortId).toBeTruthy();
    expect(audioPath).toBe(audioStoragePath(id));
    // The session points back at its recording (0..1).
    expect((await session(sessionId)).recordingId).toBe(id);
  });

  it('rejects an unknown session', async () => {
    await expect(createRecordingDraft(ADMIN, { sessionId: 'nope' })).rejects.toThrow();
  });

  it('refuses a session that already has a recording', async () => {
    const sessionId = await newSession();
    await createRecordingDraft(ADMIN, { sessionId });
    await expect(createRecordingDraft(ADMIN, { sessionId })).rejects.toThrow(/already/i);
  });
});

describe('finalizeRecording', () => {
  it('reads size from Storage rather than trusting the client', async () => {
    const { id } = await newDraft();
    await putAudio(id, 4096);
    const res = await finalizeRecording({ recordingId: id, durationSec: 720 });
    expect(res.sizeBytes).toBe(4096);
    const d = await rec(id);
    expect(d.audioPath).toBe(audioStoragePath(id));
    expect(d.durationSec).toBe(720);
  });

  it('refuses when no audio actually landed', async () => {
    const { id } = await newDraft();
    await expect(finalizeRecording({ recordingId: id, durationSec: 1 })).rejects.toThrow(/No audio/);
    expect((await rec(id)).audioPath).toBeNull();
  });

  it('accepts a null duration', async () => {
    const { id } = await newDraft();
    await putAudio(id);
    await finalizeRecording({ recordingId: id, durationSec: null });
    expect((await rec(id)).durationSec).toBeNull();
  });
});

describe('publishing', () => {
  it('publishes a complete draft and stamps publishedAt', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    const d = await rec(id);
    expect(d.status).toBe('published');
    expect(typeof d.publishedAt).toBe('number');
  });

  it('REFUSES to publish a draft with no audio', async () => {
    const { id } = await newDraft();
    await expect(applyRecordingStatus({ recordingId: id, status: 'published' })).rejects.toThrow(
      /audio/,
    );
    expect((await rec(id)).status).toBe('draft');
  });

  it('refuses a transition the state machine does not draw', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    await applyRecordingStatus({ recordingId: id, status: 'unpublished' });
    await expect(applyRecordingStatus({ recordingId: id, status: 'published' })).rejects.toThrow(
      /cannot become/,
    );
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
    const id = await ready();
    await clearAudio(id);
    const [exists] = await getStorage().bucket().file(audioStoragePath(id)).exists();
    expect(exists).toBe(false);
    const d = await rec(id);
    expect(d.audioPath).toBeNull();
    expect(d.sizeBytes).toBeNull();
  });

  it('REFUSES while the recording is live', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    await expect(clearAudio(id)).rejects.toThrow(/draft/i);
    const [exists] = await getStorage().bucket().file(audioStoragePath(id)).exists();
    expect(exists).toBe(true);
  });
});

describe('applyDeleteRecording', () => {
  const DEPS = [
    COLLECTIONS.assignments,
    COLLECTIONS.completions,
    COLLECTIONS.completionEvents,
    COLLECTIONS.listeningProgress,
    COLLECTIONS.completionOverrides,
  ];
  async function seedDeps(recordingId: string) {
    const db = getFirestore();
    const s = 'stu-1';
    await Promise.all(
      DEPS.map((c) =>
        db.collection(c).doc(`${s}_${recordingId}`).set({ recordingId, studentUid: s, courseId }),
      ),
    );
  }
  async function depCount(recordingId: string) {
    const db = getFirestore();
    const sizes = await Promise.all(
      DEPS.map((c) => db.collection(c).where('recordingId', '==', recordingId).get().then((q) => q.size)),
    );
    return sizes.reduce((a, b) => a + b, 0);
  }
  const recExists = async (id: string) =>
    (await getFirestore().collection(COLLECTIONS.recordings).doc(id).get()).exists;
  const audioExists = async (id: string) =>
    (await getStorage().bucket().file(audioStoragePath(id)).exists())[0];

  it('cascades: audio, doc, every dependent record, AND clears the session pointer', async () => {
    const sessionId = await newSession();
    const { id } = await createRecordingDraft(ADMIN, { sessionId });
    await putAudio(id);
    await finalizeRecording({ recordingId: id, durationSec: 5 });
    await seedDeps(id);
    expect(await depCount(id)).toBe(DEPS.length);

    await applyDeleteRecording(id);

    expect(await audioExists(id)).toBe(false);
    expect(await recExists(id)).toBe(false);
    expect(await depCount(id)).toBe(0);
    expect((await session(sessionId)).recordingId).toBeNull(); // session freed for a new recording
  });

  it('REFUSES a published recording and removes nothing (unpublish/archive first)', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    await seedDeps(id);
    await expect(applyDeleteRecording(id)).rejects.toThrow(/publish/i);
    expect(await audioExists(id)).toBe(true);
    expect(await recExists(id)).toBe(true);
    expect(await depCount(id)).toBe(DEPS.length);
  });

  it('deletes an ARCHIVED recording — the space-reclaim path', async () => {
    const id = await ready();
    await applyRecordingStatus({ recordingId: id, status: 'published' });
    await applyRecordingStatus({ recordingId: id, status: 'archived' });
    await applyDeleteRecording(id);
    expect(await recExists(id)).toBe(false);
  });

  it('deletes a draft that never had audio', async () => {
    const { id } = await newDraft();
    await applyDeleteRecording(id);
    expect(await recExists(id)).toBe(false);
  });
});

describe('the size limit is stated in two places and must not drift', () => {
  it('matches the number enforced in storage.rules', () => {
    const rules = readFileSync(new URL('../../../storage.rules', import.meta.url), 'utf8');
    const m = rules.match(/request\.resource\.size\s*<\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(m, 'no size limit found in storage.rules').toBeTruthy();
    expect(Number(m![1]) * 1024 * 1024).toBe(MAX_AUDIO_BYTES);
  });
});

describe('validators', () => {
  it('require a session on create', () => {
    for (const bad of [null, {}, { sessionId: '' }]) {
      expect(() => validateCreateRecording(bad)).toThrow();
    }
    expect(validateCreateRecording({ sessionId: 's1' })).toEqual({ sessionId: 's1' });
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
