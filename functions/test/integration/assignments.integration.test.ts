import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  assignmentId,
  type AssignmentDoc,
  type RecordingDoc,
  type StudentDoc,
} from '@sabeel/shared';
import { createCohortRecord } from '../../src/cohorts';
import { createCourseRecord } from '../../src/courses';
import {
  applyEnrollmentActive,
  createEnrollmentRecord,
} from '../../src/enrollments';
import { applyCatchup } from '../../src/assignments';
import { applyRecordingFanout } from '../../src/assignmentsFanout';

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
    COLLECTIONS.recordings,
    COLLECTIONS.assignments,
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

/** A recording written straight to Firestore — the fan-out only reads its
 *  courseId/cohortId/dueDate/status, so this bypasses the upload/finalize flow. */
async function seedRecording(
  id: string,
  fields: { courseId: string; cohortId: string; dueDate: string | null; status: RecordingDoc['status'] },
): Promise<RecordingDoc> {
  const doc: RecordingDoc = {
    cohortId: fields.cohortId,
    courseId: fields.courseId,
    title: id,
    status: fields.status,
    source: 'manual',
    recordedAt: 1,
    dueDate: fields.dueDate,
    notes: '',
    audioPath: `recordings/${id}/audio.m4a`,
    durationSec: 60,
    sizeBytes: 1,
    createdAt: 1,
    createdBy: ADMIN,
    updatedAt: 1,
  };
  await db().collection(COLLECTIONS.recordings).doc(id).set(doc);
  return doc;
}

const getAssignment = async (uid: string, recId: string) =>
  (await db().collection(COLLECTIONS.assignments).doc(assignmentId(uid, recId)).get()).data() as
    | AssignmentDoc
    | undefined;

const countActiveForRecording = async (recId: string) =>
  (
    await db()
      .collection(COLLECTIONS.assignments)
      .where('recordingId', '==', recId)
      .where('active', '==', true)
      .get()
  ).size;

let cohortId: string;
let courseId: string;

beforeEach(async () => {
  await clearAll();
  ({ id: cohortId } = await createCohortRecord(ADMIN, 'Autumn 2026'));
  ({ id: courseId } = await createCourseRecord(ADMIN, { cohortId, name: 'Hikam' }));
  for (const s of ['s1', 's2']) {
    await seedStudent(s);
    await createEnrollmentRecord(ADMIN, { studentUid: s, courseId });
  }
});

describe('publish fan-out', () => {
  it('creates one active assignment per enrolled student, and is idempotent', async () => {
    const draft = await seedRecording('r1', { courseId, cohortId, dueDate: '2026-08-01', status: 'draft' });
    const published: RecordingDoc = { ...draft, status: 'published' };
    await db().collection(COLLECTIONS.recordings).doc('r1').set(published);

    await applyRecordingFanout(db(), 'r1', draft, published);
    expect(await countActiveForRecording('r1')).toBe(2);
    const a = await getAssignment('s1', 'r1');
    expect(a).toMatchObject({ source: 'publish', active: true, dueDate: '2026-08-01', courseId });

    // Re-publish: no duplicates, still exactly two.
    await applyRecordingFanout(db(), 'r1', draft, published);
    expect(await countActiveForRecording('r1')).toBe(2);
  });

  it('unpublishing deactivates the obligations but keeps the rows', async () => {
    const published = await seedRecording('r1', { courseId, cohortId, dueDate: null, status: 'published' });
    await applyRecordingFanout(db(), 'r1', { ...published, status: 'draft' }, published);
    expect(await countActiveForRecording('r1')).toBe(2);

    const unpub: RecordingDoc = { ...published, status: 'unpublished' };
    await applyRecordingFanout(db(), 'r1', published, unpub);
    expect(await countActiveForRecording('r1')).toBe(0);
    expect(await getAssignment('s1', 'r1')).toMatchObject({ active: false }); // row kept
  });

  it('a due-date edit moves publish assignments but not a catch-up', async () => {
    const published = await seedRecording('r1', { courseId, cohortId, dueDate: '2026-08-01', status: 'published' });
    await applyRecordingFanout(db(), 'r1', { ...published, status: 'draft' }, published);

    // s2 additionally gets a catch-up with its OWN due date.
    await applyCatchup(ADMIN, { studentUid: 's2', recordingId: 'r1', dueDate: '2026-09-15' }, courseId);
    expect(await getAssignment('s2', 'r1')).toMatchObject({ source: 'catchup', dueDate: '2026-09-15' });

    const edited: RecordingDoc = { ...published, dueDate: '2026-08-10' };
    await applyRecordingFanout(db(), 'r1', published, edited);

    expect((await getAssignment('s1', 'r1'))?.dueDate).toBe('2026-08-10'); // publish follows
    expect((await getAssignment('s2', 'r1'))?.dueDate).toBe('2026-09-15'); // catch-up protected
  });

  it('moving to another class reassigns to the new roster', async () => {
    const { id: otherCourse } = await createCourseRecord(ADMIN, { cohortId, name: 'Arabic' });
    await seedStudent('s3');
    await createEnrollmentRecord(ADMIN, { studentUid: 's3', courseId: otherCourse });

    const published = await seedRecording('r1', { courseId, cohortId, dueDate: null, status: 'published' });
    await applyRecordingFanout(db(), 'r1', { ...published, status: 'draft' }, published);
    expect(await getAssignment('s1', 'r1')).toMatchObject({ active: true });

    const moved: RecordingDoc = { ...published, courseId: otherCourse };
    await db().collection(COLLECTIONS.recordings).doc('r1').set(moved);
    await applyRecordingFanout(db(), 'r1', published, moved);

    expect((await getAssignment('s1', 'r1'))?.active).toBe(false); // old roster off
    expect(await getAssignment('s3', 'r1')).toMatchObject({ active: true, courseId: otherCourse });
  });
});

describe('late enrollment', () => {
  it('assigns only not-yet-due published recordings', async () => {
    await seedRecording('past', { courseId, cohortId, dueDate: '2020-01-01', status: 'published' });
    await seedRecording('future', { courseId, cohortId, dueDate: '2999-01-01', status: 'published' });
    await seedRecording('nodue', { courseId, cohortId, dueDate: null, status: 'published' });
    await seedRecording('draft', { courseId, cohortId, dueDate: '2999-01-01', status: 'draft' });

    await seedStudent('late');
    await createEnrollmentRecord(ADMIN, { studentUid: 'late', courseId });

    expect(await getAssignment('late', 'past')).toBeUndefined(); // due passed → catch-up only
    expect(await getAssignment('late', 'future')).toMatchObject({ active: true });
    expect(await getAssignment('late', 'nodue')).toMatchObject({ active: true });
    expect(await getAssignment('late', 'draft')).toBeUndefined(); // not published
  });

  it('unenrolling deactivates the obligations, re-enrolling restores them', async () => {
    // s1 is enrolled from beforeEach but had no published recordings then; a
    // re-enroll (active:true) re-applies the late-enrollment default and picks
    // this one up.
    await seedRecording('r1', { courseId, cohortId, dueDate: '2999-01-01', status: 'published' });
    await applyEnrollmentActive({ studentUid: 's1', courseId, active: true });
    expect(await getAssignment('s1', 'r1')).toMatchObject({ active: true });

    await applyEnrollmentActive({ studentUid: 's1', courseId, active: false });
    expect((await getAssignment('s1', 'r1'))?.active).toBe(false);
  });
});

describe('catch-up', () => {
  it('assigns an earlier recording to an enrolled student as catchup', async () => {
    await seedRecording('old', { courseId, cohortId, dueDate: '2020-01-01', status: 'published' });
    await applyCatchup(ADMIN, { studentUid: 's1', recordingId: 'old', dueDate: null }, courseId);
    expect(await getAssignment('s1', 'old')).toMatchObject({ source: 'catchup', active: true, dueDate: null });
  });

  it('refuses a student who is not in the class', async () => {
    await seedRecording('old', { courseId, cohortId, dueDate: null, status: 'published' });
    await seedStudent('outsider');
    await expect(
      applyCatchup(ADMIN, { studentUid: 'outsider', recordingId: 'old', dueDate: null }, courseId),
    ).rejects.toThrow();
  });
});
