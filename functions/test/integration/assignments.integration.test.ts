import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  assignmentId,
  attendanceRecordId,
  type AssignmentDoc,
  type AttendanceRecordDoc,
  type AttendanceStatus,
  type RecordingDoc,
  type SessionDoc,
  type StudentDoc,
} from '@sabeel/shared';
import { createCohortRecord } from '../../src/cohorts';
import { createCourseRecord } from '../../src/courses';
import { createEnrollmentRecord } from '../../src/enrollments';
import {
  reconcileSessionAssignments,
  deactivateStudentAssignmentsInCourse,
} from '../../src/assignmentsFanout';
import { reconcileAttendanceRecords } from '../../src/attendanceMirror';

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

const ADMIN = 'admin-uid';
const db = () => getFirestore();

async function clearAll() {
  for (const c of [
    COLLECTIONS.students,
    COLLECTIONS.cohorts,
    COLLECTIONS.courses,
    COLLECTIONS.enrollments,
    COLLECTIONS.sessions,
    COLLECTIONS.recordings,
    COLLECTIONS.assignments,
    COLLECTIONS.attendanceRecords,
  ]) {
    const snap = await db().collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const users = await getAuth().listUsers();
  await Promise.all(users.users.map((u) => getAuth().deleteUser(u.uid)));
}

async function seedStudent(uid: string) {
  const doc: StudentDoc = {
    displayName: uid,
    email: `${uid}@example.com`,
    role: 'student',
    status: 'active',
    createdAt: 1,
    createdBy: ADMIN,
  };
  await db().collection(COLLECTIONS.students).doc(uid).set(doc);
}

/** A session written straight to Firestore (attendance snapshot + submit flag). */
async function seedSession(
  id: string,
  fields: {
    dueDate?: string;
    attendance: Record<string, AttendanceStatus>;
    submitted: boolean;
    recordingId?: string | null;
  },
): Promise<SessionDoc> {
  const doc: SessionDoc = {
    courseId,
    cohortId,
    date: '2026-07-06',
    title: id,
    dueDate: fields.dueDate ?? '2026-08-01',
    notes: '',
    recordingId: fields.recordingId ?? null,
    attendance: fields.attendance,
    attendanceSubmittedAt: fields.submitted ? 1 : null,
    archived: false,
    createdAt: 1,
    createdBy: ADMIN,
    updatedAt: 1,
  };
  await db().collection(COLLECTIONS.sessions).doc(id).set(doc);
  return doc;
}

/** A recording written straight to Firestore — reconcile only reads its status. */
async function seedRecording(id: string, sessionId: string, status: RecordingDoc['status']) {
  const doc: RecordingDoc = {
    sessionId,
    courseId,
    cohortId,
    title: id,
    notes: '',
    date: '2026-07-06',
    status,
    source: 'manual',
    audioPath: `recordings/${id}/audio.m4a`,
    durationSec: 60,
    sizeBytes: 1,
    createdAt: 1,
    createdBy: ADMIN,
    updatedAt: 1,
  };
  await db().collection(COLLECTIONS.recordings).doc(id).set(doc);
  await db().collection(COLLECTIONS.sessions).doc(sessionId).update({ recordingId: id });
  return doc;
}

const getAssignment = async (uid: string, recId: string) =>
  (await db().collection(COLLECTIONS.assignments).doc(assignmentId(uid, recId)).get()).data() as
    | AssignmentDoc
    | undefined;

const countActive = async (recId: string) =>
  (
    await db()
      .collection(COLLECTIONS.assignments)
      .where('recordingId', '==', recId)
      .where('active', '==', true)
      .get()
  ).size;

/** Reconcile a session by id, reading the current session + recording docs. */
async function reconcile(sessionId: string) {
  const session = (await db().collection(COLLECTIONS.sessions).doc(sessionId).get()).data() as
    | SessionDoc
    | undefined;
  const rec = session?.recordingId
    ? ((await db().collection(COLLECTIONS.recordings).doc(session.recordingId).get()).data() as
        | RecordingDoc
        | undefined)
    : undefined;
  await reconcileSessionAssignments(db(), sessionId, session, rec);
}

let cohortId: string;
let courseId: string;

beforeEach(async () => {
  await clearAll();
  ({ id: cohortId } = await createCohortRecord(ADMIN, 'Autumn 2026'));
  ({ id: courseId } = await createCourseRecord(ADMIN, { cohortId, name: 'Hikam' }));
  for (const s of ['s1', 's2', 's3']) {
    await seedStudent(s);
    await createEnrollmentRecord(ADMIN, { studentUid: s, courseId });
  }
});

describe('reconcileSessionAssignments', () => {
  it('grants the EXCUSED alone — present and absent get nothing', async () => {
    await seedSession('sess', {
      dueDate: '2026-08-01',
      attendance: { s1: 'absent', s2: 'present', s3: 'excused' },
      submitted: true,
    });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');

    expect(await getAssignment('s3', 'r1')).toMatchObject({ active: true, dueDate: '2026-08-01' });
    // An unexcused absence opens nothing: the student missed the class and has
    // no claim on the recording. This is the whole policy change in one line.
    expect(await getAssignment('s1', 'r1')).toBeUndefined();
    expect(await getAssignment('s2', 'r1')).toBeUndefined();
    expect(await countActive('r1')).toBe(1);
  });

  it('assigns nobody until BOTH published and attendance submitted', async () => {
    // Published recording, attendance not yet submitted.
    await seedSession('sess', { attendance: { s1: 'excused' }, submitted: false });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');
    expect(await countActive('r1')).toBe(0);

    // Submit attendance → now assigned.
    await db().collection(COLLECTIONS.sessions).doc('sess').update({ attendanceSubmittedAt: 1 });
    await reconcile('sess');
    expect(await getAssignment('s1', 'r1')).toMatchObject({ active: true });

    // A draft recording assigns nobody even with attendance submitted.
    await seedSession('sess2', { attendance: { s2: 'excused' }, submitted: true });
    await seedRecording('r2', 'sess2', 'draft');
    await reconcile('sess2');
    expect(await countActive('r2')).toBe(0);
  });

  it('re-submitting attendance withdraws a grant and keeps the history', async () => {
    await seedSession('sess', { attendance: { s1: 'excused', s2: 'excused' }, submitted: true });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');
    expect(await countActive('r1')).toBe(2);

    // s2 was actually present after all — the grant goes, the row stays.
    await db()
      .collection(COLLECTIONS.sessions)
      .doc('sess')
      .update({ attendance: { s1: 'excused', s2: 'present' } });
    await reconcile('sess');
    expect(await getAssignment('s1', 'r1')).toMatchObject({ active: true });
    expect((await getAssignment('s2', 'r1'))?.active).toBe(false); // deactivated, row kept
    expect(await countActive('r1')).toBe(1);
  });

  it('correcting excused to ABSENT withdraws the grant too', async () => {
    // Worth its own case: under the old rule absent kept the obligation, so this
    // is the assertion that would have silently kept passing.
    await seedSession('sess', { attendance: { s1: 'excused' }, submitted: true });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');
    expect(await countActive('r1')).toBe(1);

    await db()
      .collection(COLLECTIONS.sessions)
      .doc('sess')
      .update({ attendance: { s1: 'absent' } });
    await reconcile('sess');
    expect((await getAssignment('s1', 'r1'))?.active).toBe(false);
    expect(await countActive('r1')).toBe(0);
  });

  it('a student not in the attendance snapshot is never assigned (enrollment-onward)', async () => {
    // s3 is enrolled but was NOT marked (e.g. enrolled after this session).
    await seedSession('sess', {
      attendance: { s1: 'excused', s2: 'excused' },
      submitted: true,
    });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');
    expect(await getAssignment('s3', 'r1')).toBeUndefined();
    expect(await countActive('r1')).toBe(2);
  });

  it('unpublishing deactivates the obligations but keeps the rows', async () => {
    await seedSession('sess', { attendance: { s1: 'excused', s2: 'excused' }, submitted: true });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');
    expect(await countActive('r1')).toBe(2);

    await db().collection(COLLECTIONS.recordings).doc('r1').update({ status: 'unpublished' });
    await reconcile('sess');
    expect(await countActive('r1')).toBe(0);
    expect((await getAssignment('s1', 'r1'))?.active).toBe(false);
  });

  it('a due-date edit re-flows to the assignments', async () => {
    await seedSession('sess', {
      dueDate: '2026-08-01',
      attendance: { s1: 'excused' },
      submitted: true,
    });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');
    expect((await getAssignment('s1', 'r1'))?.dueDate).toBe('2026-08-01');

    await db().collection(COLLECTIONS.sessions).doc('sess').update({ dueDate: '2026-08-10' });
    await reconcile('sess');
    expect((await getAssignment('s1', 'r1'))?.dueDate).toBe('2026-08-10');
  });
});

describe('unenrolment', () => {
  it('deactivates a student obligations in the course, keeping history', async () => {
    await seedSession('sess', { attendance: { s1: 'excused', s2: 'excused' }, submitted: true });
    await seedRecording('r1', 'sess', 'published');
    await reconcile('sess');
    expect(await countActive('r1')).toBe(2);

    await deactivateStudentAssignmentsInCourse(db(), courseId, 's1');
    expect((await getAssignment('s1', 'r1'))?.active).toBe(false);
    expect((await getAssignment('s2', 'r1'))?.active).toBe(true);
  });
});

describe('reconcileAttendanceRecords — the student-visible projection', () => {
  const mirror = async (uid: string, sessionId: string) =>
    (
      await db()
        .collection(COLLECTIONS.attendanceRecords)
        .doc(attendanceRecordId(uid, sessionId))
        .get()
    ).data() as AttendanceRecordDoc | undefined;

  const project = async (sessionId: string) => {
    const session = (await db().collection(COLLECTIONS.sessions).doc(sessionId).get()).data() as
      | SessionDoc
      | undefined;
    await reconcileAttendanceRecords(db(), sessionId, session);
  };

  it('projects EVERY mark, not just the granted ones', async () => {
    // A student needs to see that they were marked present just as much as
    // excused — the whole point of the screen is their own record.
    await seedSession('sess', {
      attendance: { s1: 'present', s2: 'absent', s3: 'excused' },
      submitted: true,
    });
    await project('sess');

    expect(await mirror('s1', 'sess')).toMatchObject({ status: 'present', courseId });
    expect(await mirror('s2', 'sess')).toMatchObject({ status: 'absent' });
    expect(await mirror('s3', 'sess')).toMatchObject({ status: 'excused' });
  });

  it('denormalises the date and title, because students cannot read the session', async () => {
    await seedSession('sess', { attendance: { s1: 'present' }, submitted: true });
    await project('sess');
    expect(await mirror('s1', 'sess')).toMatchObject({
      date: '2026-07-06',
      title: 'sess',
      submittedAt: 1,
    });
  });

  it('projects nothing until attendance is SUBMITTED', async () => {
    // Marks being edited are not a record yet; the same gate the fan-out uses.
    await seedSession('sess', { attendance: { s1: 'excused' }, submitted: false });
    await project('sess');
    expect(await mirror('s1', 'sess')).toBeUndefined();

    await db().collection(COLLECTIONS.sessions).doc('sess').update({ attendanceSubmittedAt: 1 });
    await project('sess');
    expect(await mirror('s1', 'sess')).toMatchObject({ status: 'excused' });
  });

  it('follows a correction, and DELETES a row dropped from the snapshot', async () => {
    await seedSession('sess', { attendance: { s1: 'excused', s2: 'present' }, submitted: true });
    await project('sess');
    expect(await mirror('s2', 'sess')).toMatchObject({ status: 'present' });

    await db()
      .collection(COLLECTIONS.sessions)
      .doc('sess')
      .update({ attendance: { s1: 'present' } });
    await project('sess');
    expect(await mirror('s1', 'sess')).toMatchObject({ status: 'present' });
    // Unlike an assignment, a mark carries no history worth keeping once the
    // session says it never happened — a stale row would contradict the report.
    expect(await mirror('s2', 'sess')).toBeUndefined();
  });

  it('drops every row when the session is deleted', async () => {
    await seedSession('sess', { attendance: { s1: 'excused' }, submitted: true });
    await project('sess');
    await db().collection(COLLECTIONS.sessions).doc('sess').delete();
    await project('sess');
    expect(await mirror('s1', 'sess')).toBeUndefined();
  });

  it('is idempotent — running twice changes nothing', async () => {
    await seedSession('sess', { attendance: { s1: 'excused', s2: 'absent' }, submitted: true });
    await project('sess');
    await project('sess');
    const all = await db()
      .collection(COLLECTIONS.attendanceRecords)
      .where('sessionId', '==', 'sess')
      .get();
    expect(all.size).toBe(2);
  });
});
