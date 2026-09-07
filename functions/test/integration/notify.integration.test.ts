import { describe, it, beforeAll, beforeEach, afterEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  assignmentId,
  type AssignmentDoc,
  type CourseDoc,
  type PushMessage,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';
import { setSender, resetSender, type SendOutcome } from '../../src/messaging';
import { notifyAttendanceMissing, notifyLastDay, notifyRecordingReady } from '../../src/notifyJobs';

/**
 * Everything about notifications EXCEPT delivery.
 *
 * There is no FCM emulator — none exists — so the send is stubbed and what is
 * asserted is who would have been messaged, with what, and how many times. That
 * is the whole of the logic; the transport is one function in `messaging.ts` and
 * only a real device can prove it.
 */

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

const db = () => getFirestore();
const ADMIN = 'admin-uid';
const COURSE = 'c-notify';
const COHORT = 'coh-notify';

/** Every message the stubbed sender was asked to deliver, in order. */
let outbox: { tokens: string[]; message: PushMessage }[] = [];
let staleTokens: string[] = [];

/*
 * NEW SESSION AND RECORDING IDS EACH TEST.
 *
 * `recursiveDelete` clears this file's recordings and sessions, and each
 * deletion fires `onRecordingWritten` / `onSessionWritten`, which reconcile
 * against a document that is now gone and deactivate every assignment on it.
 * The Functions emulator delivers those on its own schedule, so one could land
 * after the next test had re-seeded `assignments/s1_r1` with `active: true` —
 * and the `lastDay` cases then find nothing to notify about. Same shape as the
 * flakes already fixed in three sibling files; production never reuses an id
 * either. The test bodies keep saying `'r1'` and `'sess1'`; the helpers
 * namespace.
 */
let testRun = 0;
const ns = (id: string) => `${id}-run${testRun}`;

beforeEach(async () => {
  testRun += 1;
  outbox = [];
  staleTokens = [];
  setSender(async (tokens, message): Promise<SendOutcome> => {
    outbox.push({ tokens, message });
    return { stale: staleTokens, sent: tokens.length - staleTokens.length };
  });

  // recursiveDelete, not a get-and-delete loop: a person who has devices but has
  // never opened the settings screen has NO `notifications/{uid}` document, so
  // listing the collection does not return them and their subcollections
  // survive into the next test. That leftover made the `sent` marker look
  // already-claimed and every send silently return false.
  for (const c of [
    COLLECTIONS.notifications,
    COLLECTIONS.sessions,
    COLLECTIONS.recordings,
    COLLECTIONS.assignments,
    COLLECTIONS.completions,
    COLLECTIONS.courses,
  ]) {
    await db().recursiveDelete(db().collection(c));
  }

  const course: CourseDoc = {
    cohortId: COHORT,
    name: 'Hikam Foundations',
    archived: false,
    effectiveActive: true,
    archivedAccess: false,
    managerUids: ['mgr1'],
    createdAt: 1,
    createdBy: ADMIN,
  };
  await db().collection(COLLECTIONS.courses).doc(COURSE).set(course);
});

afterEach(() => {
  resetSender();
});

/*
 * A fresh `registeredAt` per call, like the app's own `registerThisDevice`.
 *
 * A `set` whose content is byte-identical to what is already there does not
 * reach the trigger, so a fixture that re-registered with a fixed timestamp was
 * testing a write the app never makes — and made a re-registration look like
 * something the sweep ignores.
 */
let registrationClock = 1;

async function withDevice(uid: string, token = `tok-${uid}`, registeredAt = (registrationClock += 1)) {
  await db()
    .collection(COLLECTIONS.notifications)
    .doc(uid)
    .collection('devices')
    .doc(token)
    .set({ token, platform: 'web', registeredAt });
}

async function seedRecording(id: string, sessionId: string, status: RecordingDoc['status']) {
  const rec: RecordingDoc = {
    sessionId: ns(sessionId),
    courseId: COURSE,
    cohortId: COHORT,
    title: 'Session 3 — Patience',
    notes: '',
    date: '2026-08-10',
    status,
    source: 'manual',
    audioPath: `recordings/${id}/audio.m4a`,
    durationSec: 720,
    sizeBytes: 1,
    createdAt: 1,
    createdBy: ADMIN,
    updatedAt: 1,
  };
  await db().collection(COLLECTIONS.recordings).doc(ns(id)).set(rec);
}

function grant(studentUid: string, recordingId: string, dueDate = '2026-08-20'): AssignmentDoc {
  return {
    studentUid,
    recordingId: ns(recordingId),
    sessionId: ns('sess1'),
    courseId: COURSE,
    cohortId: COHORT,
    dueDate,
    active: true,
    assignedAt: 1,
    assignedBy: 'system',
  };
}

async function seedSession(id: string, fields: Partial<SessionDoc>) {
  const s: SessionDoc = {
    courseId: COURSE,
    cohortId: COHORT,
    date: '2026-08-10',
    title: 'Session 3 — Patience',
    dueDate: '2026-08-20',
    notes: '',
    recordingId: null,
    attendance: {},
    attendanceSubmittedAt: null,
    archived: false,
    createdAt: 1,
    createdBy: ADMIN,
    updatedAt: 1,
    ...fields,
  };
  await db().collection(COLLECTIONS.sessions).doc(ns(id)).set(s);
}

describe('recordingReady', () => {
  it('tells the excused student, naming the class and the deadline', async () => {
    await withDevice('s1');
    await seedRecording('r1', 'sess1', 'published');
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(true);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].tokens).toEqual(['tok-s1']);
    expect(outbox[0].message.title).toContain('Hikam Foundations');
    expect(outbox[0].message.body).toContain('2026-08-20');
  });

  it('sends ONCE however many times the reconcile runs', async () => {
    // Every attendance correction rewrites every grant on the session, so this
    // is the normal case, not an edge one.
    await withDevice('s1');
    await seedRecording('r1', 'sess1', 'published');
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(true);
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(false);
    expect(outbox).toHaveLength(1);
  });

  it('says nothing about a recording that is not published', async () => {
    await withDevice('s1');
    await seedRecording('r1', 'sess1', 'draft');
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(false);
    expect(outbox).toHaveLength(0);
  });

  it('respects the switch being off', async () => {
    await withDevice('s1');
    await db().collection(COLLECTIONS.notifications).doc('s1').set({ recordingReady: false });
    await seedRecording('r1', 'sess1', 'published');
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(false);
    expect(outbox).toHaveLength(0);
  });

  it('notifies someone who has never opened the settings screen', async () => {
    // A missing preferences document means ON. The other way round, nobody would
    // ever be notified until they visited a screen for turning it off.
    await withDevice('s1');
    await seedRecording('r1', 'sess1', 'published');
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(true);
  });

  it('does not spend the one delivery on a student with no device yet', async () => {
    // The marker is the whole of "once", so claiming it for someone unreachable
    // would mean they are never told about this recording — registering a device
    // an hour later would find the notification already marked as sent.
    await seedRecording('r1', 'sess1', 'published');
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(false);
    const claimed = await db()
      .collection(COLLECTIONS.notifications)
      .doc('s1')
      .collection('sent')
      .get();
    expect(claimed.empty).toBe(true);

    await withDevice('s1');
    expect(await notifyRecordingReady(db(), grant('s1', 'r1'))).toBe(true);
    expect(outbox).toHaveLength(1);
  });

  it('prunes a token the transport rejects, and keeps the rest', async () => {
    await withDevice('s1', 'tok-dead');
    await withDevice('s1', 'tok-live');
    staleTokens = ['tok-dead'];
    await seedRecording('r1', 'sess1', 'published');
    await notifyRecordingReady(db(), grant('s1', 'r1'));
    const left = await db()
      .collection(COLLECTIONS.notifications)
      .doc('s1')
      .collection('devices')
      .get();
    expect(left.docs.map((d) => d.id)).toEqual(['tok-live']);
  });
});

describe('lastDay', () => {
  const TODAY = '2026-08-20';

  it('reminds only the people whose deadline is TODAY', async () => {
    await withDevice('s1');
    await withDevice('s2');
    await seedRecording('r1', 'sess1', 'published');
    await db()
      .collection(COLLECTIONS.assignments)
      .doc(assignmentId('s1', ns('r1')))
      .set(grant('s1', 'r1', TODAY));
    await db()
      .collection(COLLECTIONS.assignments)
      .doc(assignmentId('s2', ns('r1')))
      .set(grant('s2', 'r1', '2026-08-25'));

    expect(await notifyLastDay(db(), TODAY)).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].tokens).toEqual(['tok-s1']);
  });

  it('says nothing to someone who has already finished it', async () => {
    await withDevice('s1');
    await seedRecording('r1', 'sess1', 'published');
    await db()
      .collection(COLLECTIONS.assignments)
      .doc(assignmentId('s1', ns('r1')))
      .set(grant('s1', 'r1', TODAY));
    await db()
      .collection(COLLECTIONS.completions)
      .doc(assignmentId('s1', ns('r1')))
      .set({
        studentUid: 's1',
        recordingId: ns('r1'),
        courseId: COURSE,
        completed: true,
        completedAt: 1,
        updatedAt: 1,
      });
    expect(await notifyLastDay(db(), TODAY)).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it('runs a second morning without repeating itself', async () => {
    // The sweep fires every day regardless of whether yesterday's finished.
    await withDevice('s1');
    await seedRecording('r1', 'sess1', 'published');
    await db()
      .collection(COLLECTIONS.assignments)
      .doc(assignmentId('s1', ns('r1')))
      .set(grant('s1', 'r1', TODAY));
    expect(await notifyLastDay(db(), TODAY)).toBe(1);
    expect(await notifyLastDay(db(), TODAY)).toBe(0);
    expect(outbox).toHaveLength(1);
  });
});

describe('attendanceMissing', () => {
  const TODAY = '2026-08-20';

  it('tells the course managers about a meeting nobody marked', async () => {
    await withDevice('mgr1');
    await seedSession('sess1', { date: '2026-08-10', attendanceSubmittedAt: null });
    expect(await notifyAttendanceMissing(db(), TODAY)).toBe(1);
    expect(outbox[0].tokens).toEqual(['tok-mgr1']);
    expect(outbox[0].message.body).toContain('2026-08-10');
  });

  it('leaves a teacher alone for the first couple of days', async () => {
    // Attendance taken the next morning is normal, not a lapse.
    await withDevice('mgr1');
    await seedSession('sess1', { date: TODAY, attendanceSubmittedAt: null });
    expect(await notifyAttendanceMissing(db(), TODAY)).toBe(0);
  });

  it('says nothing once attendance has been submitted', async () => {
    await withDevice('mgr1');
    await seedSession('sess1', { date: '2026-08-10', attendanceSubmittedAt: 1 });
    expect(await notifyAttendanceMissing(db(), TODAY)).toBe(0);
  });

  it('says nothing about a course that has finished', async () => {
    await withDevice('mgr1');
    await db().collection(COLLECTIONS.courses).doc(COURSE).update({ effectiveActive: false });
    await seedSession('sess1', { date: '2026-08-10', attendanceSubmittedAt: null });
    expect(await notifyAttendanceMissing(db(), TODAY)).toBe(0);
  });

  it('does not nag every morning about the same session', async () => {
    await withDevice('mgr1');
    await seedSession('sess1', { date: '2026-08-10', attendanceSubmittedAt: null });
    expect(await notifyAttendanceMissing(db(), TODAY)).toBe(1);
    expect(await notifyAttendanceMissing(db(), '2026-08-21')).toBe(0);
  });
});

/**
 * A device belongs to one account at a time.
 *
 * The trigger is what actually enforces it, so this drives the emulator's real
 * trigger rather than a function call: sign-out's own unregister is bounded (it
 * must be, or the button hangs offline and somebody stays signed in on a shared
 * device), and a delete that was never acknowledged before the credential
 * dropped is never sent. The registration left behind is a perfectly valid
 * token, so `notifyOnce`'s stale-token pruning never touches it — the previous
 * student's "a recording is ready" arrives on the phone the next student is
 * holding.
 */
describe('a token registered to a new account leaves the old one', () => {
  const TOKEN = 'shared-device-token';
  const devices = (uid: string) =>
    db().collection(COLLECTIONS.notifications).doc(uid).collection('devices');

  /** The trigger runs out of band; wait for it rather than guessing a delay. */
  async function settled(uid: string, present: boolean) {
    for (let i = 0; i < 60; i += 1) {
      if ((await devices(uid).doc(TOKEN).get()).exists === present) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`devices/${TOKEN} under ${uid} never became ${present ? 'present' : 'absent'}`);
  }

  it('removes the same token from every other account', async () => {
    await withDevice('student-a', TOKEN);
    await settled('student-a', true);

    await withDevice('student-b', TOKEN);
    await settled('student-a', false);
    // And the account that just registered keeps it.
    expect((await devices('student-b').doc(TOKEN).get()).exists).toBe(true);
  });

  /*
   * TRIGGER DELIVERY IS NOT ORDERED, and a trigger that treats its own document
   * as the winner has each invocation delete the other's row — leaving the
   * device registered to NOBODY, which is worse than the leak it exists to
   * close. Both writes here land before either invocation can run, so the
   * claim is about convergence, not about which account wins.
   */
  it('converges on exactly one registration however the triggers interleave', async () => {
    await Promise.all([
      withDevice('student-a', TOKEN),
      withDevice('student-b', TOKEN),
    ]);
    const survivors = async () =>
      (
        await Promise.all(
          ['student-a', 'student-b'].map((uid) => devices(uid).doc(TOKEN).get()),
        )
      ).filter((d) => d.exists).length;

    for (let i = 0; i < 60 && (await survivors()) > 1; i += 1) {
      await new Promise((r) => setTimeout(r, 250));
    }
    // Settle, then confirm it stayed at one rather than passing through it.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await survivors()).toBe(1);
  });

  /*
   * NOTE ON WHAT IS NOT TESTED HERE.
   *
   * The trigger is `onDocumentWritten` rather than `onDocumentCreated`, so a
   * re-registration re-runs the sweep. That matters only for a duplicate the
   * sweep FAILED to clear — one invocation dying on a still-building index, say
   * — because while the sweep is working every registration finds the other row
   * already gone and is therefore a create. There is no way to stage that state
   * from a test: any row written here fires the sweep and is cleaned up.
   *
   * So the recovery path is asserted at the declaration instead, in
   * `functions/test/unit/deviceSweep.test.ts`. Writing a behavioural test that
   * passes under `onDocumentCreated` too would be worse than none.
   */

  it('leaves an unrelated device alone', async () => {
    await withDevice('student-a', 'a-different-phone');
    await withDevice('student-b', TOKEN);
    await settled('student-b', true);
    expect((await devices('student-a').doc('a-different-phone').get()).exists).toBe(true);
  });

  it('does not remove the registration it was fired for', async () => {
    // Re-registering under the SAME account — every sign-in does this — must not
    // race the trigger into deleting the row it just wrote.
    await withDevice('student-a', TOKEN);
    await settled('student-a', true);
    await withDevice('student-a', TOKEN);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await devices('student-a').doc(TOKEN).get()).exists).toBe(true);
  });
});
