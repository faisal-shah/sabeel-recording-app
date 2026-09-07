import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  EMULATOR_STORAGE_BUCKET,
  assignmentId,
  audioStoragePath,
} from '@sabeel/shared';
import { getPlaybackUrl } from '../../src/playback';

/**
 * The one callable that hands out audio, driven end to end.
 *
 * `playback.test.ts` covers `playbackDenial` exhaustively and is the best test
 * in this repo — but it covers a pure function, and nothing drove the callable
 * that consults it. `if (denial) throw` deleted, or moved below the signing
 * call, mints a playing URL for any signed-in account and leaves every unit test
 * green. THE DEADLINE IS ENFORCED HERE AND NOWHERE ELSE — `firestore.rules`
 * deliberately does not know about it — so this callable is the whole of the
 * lock on a closed recording, and the whole of the lock on a classmate's.
 *
 * The URL that comes back is the emulator's own object URL, not a signed one:
 * the Storage emulator has no signing service, and `signedPlaybackUrl` says so
 * at length. What is asserted here is therefore WHO gets a URL at all — the
 * signing itself is held by `signedUrlContract.test.ts` next door, which is
 * static because the production branch cannot run anywhere but production.
 */
beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: EMULATOR_PROJECT_ID, storageBucket: EMULATOR_STORAGE_BUCKET });
  }
});

const db = () => getFirestore();
const COURSE = 'course-play';
const RECORDING = 'recording-play';
const STUDENT = 'student-play';
const OTHER_STUDENT = 'student-play-other';
const MANAGER = 'manager-play';

const req = (uid: string, role: string, status = 'active'): CallableRequest =>
  ({
    auth: { uid, token: { role, status } },
    data: { recordingId: RECORDING },
  }) as unknown as CallableRequest;

/** Today is well before the deadline unless a test moves the grant's due date. */
const FUTURE = '2099-01-01';
const PAST = '2020-01-01';

async function grant(uid: string, dueDate: string, active = true) {
  await db()
    .collection(COLLECTIONS.assignments)
    .doc(assignmentId(uid, RECORDING))
    .set({
      studentUid: uid,
      recordingId: RECORDING,
      sessionId: 'session-play',
      courseId: COURSE,
      cohortId: 'cohort-play',
      dueDate,
      active,
      assignedAt: 1,
      assignedBy: 'system',
    });
}

beforeEach(async () => {
  const d = db();
  for (const id of [STUDENT, OTHER_STUDENT]) {
    await d.collection(COLLECTIONS.assignments).doc(assignmentId(id, RECORDING)).delete();
  }
  await d.collection(COLLECTIONS.courses).doc(COURSE).set({
    cohortId: 'cohort-play',
    name: 'Playable',
    managerUids: [MANAGER],
    archived: false,
    effectiveActive: true,
    archivedAccess: false,
    createdAt: 1,
    createdBy: 'admin-uid',
  });
  await d.collection(COLLECTIONS.recordings).doc(RECORDING).set({
    sessionId: 'session-play',
    courseId: COURSE,
    cohortId: 'cohort-play',
    title: 'Playable',
    status: 'published',
    source: 'manual',
    audioPath: audioStoragePath(RECORDING),
    durationSec: 60,
    sizeBytes: 16,
    createdAt: 1,
    createdBy: 'admin-uid',
    updatedAt: 1,
  });
  // A real object: the emulator branch reads its metadata to mint a URL.
  await getStorage()
    .bucket()
    .file(audioStoragePath(RECORDING))
    .save(Buffer.alloc(16), { contentType: 'audio/mp4' });
});

const denialOf = async (r: CallableRequest): Promise<string | null> => {
  try {
    const res = (await getPlaybackUrl.run(r)) as { url: string };
    expect(res.url).toContain(RECORDING);
    return null;
  } catch (e) {
    return (e as { message?: string }).message ?? 'unknown';
  }
};

describe('getPlaybackUrl', () => {
  it('gives the excused student their audio', async () => {
    await grant(STUDENT, FUTURE);
    expect(await denialOf(req(STUDENT, 'student'))).toBeNull();
  });

  /*
   * THE DEADLINE, WHICH LIVES ONLY HERE. The grant is still active and the
   * student still reads the recording's metadata — that is the design, so their
   * Missed card and their listening record survive. The audio is what closes.
   */
  it('refuses the same student once their listen-by date has passed', async () => {
    await grant(STUDENT, PAST);
    expect(await denialOf(req(STUDENT, 'student'))).toMatch(/due date/i);
  });

  it('refuses a student with no grant, and one whose grant was withdrawn', async () => {
    expect(await denialOf(req(OTHER_STUDENT, 'student'))).toMatch(/not assigned/i);
    await grant(OTHER_STUDENT, FUTURE, false);
    expect(await denialOf(req(OTHER_STUDENT, 'student'))).toMatch(/not assigned/i);
  });

  it('refuses a student whose account is not active, grant or no grant', async () => {
    await grant(STUDENT, FUTURE);
    expect(await denialOf(req(STUDENT, 'student', 'disabled'))).toMatch(/not active/i);
    expect(await denialOf(req(STUDENT, 'student', 'pending'))).toMatch(/not active/i);
  });

  it('gives the class manager their audio, with no grant of their own', async () => {
    expect(await denialOf(req(MANAGER, 'manager'))).toBeNull();
  });

  it('refuses a manager who does not run the class', async () => {
    expect(await denialOf(req('manager-elsewhere', 'manager'))).toMatch(/not assigned to that class/i);
  });

  it('refuses an unauthenticated call', async () => {
    expect(await denialOf({ data: { recordingId: RECORDING } } as CallableRequest)).toMatch(
      /sign in/i,
    );
  });

  it('refuses a recording that does not exist, without leaking whether it might', async () => {
    const r = {
      auth: { uid: STUDENT, token: { role: 'student', status: 'active' } },
      data: { recordingId: 'no-such-recording' },
    } as unknown as CallableRequest;
    expect(await denialOf(r)).toMatch(/no such recording/i);
  });

  /*
   * A CLOSED CLASS — the other way access ends, and the one that is not a date.
   *
   * Asserted for the STUDENT only, deliberately. `playbackDenial` checks
   * `canPlayFromCourse` inside the student branch, so a class manager is still
   * served the audio; the app's `canPlayNow` checks it before the staff branch,
   * so the player draws no transport for them. The two disagree, and which is
   * right is a product question rather than a bug with an obvious side: staff
   * needing to hear an archived recording is what makes the student's own
   * message — "ask your teacher if you need access again" — a sentence anyone
   * can act on. Pinning either side here would settle it by accident, in a test,
   * which is how a defect becomes a specification.
   */
  it('refuses a student once their class is archived with listening off', async () => {
    await grant(STUDENT, FUTURE);
    await db()
      .collection(COLLECTIONS.courses)
      .doc(COURSE)
      .update({ archived: true, effectiveActive: false, archivedAccess: false });
    expect(await denialOf(req(STUDENT, 'student'))).toMatch(/archived/i);
  });
});
