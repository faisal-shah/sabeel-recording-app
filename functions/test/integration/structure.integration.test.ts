import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  enrollmentId,
  type ClassDoc,
  type EnrollmentDoc,
} from '@sabeel/shared';
import {
  applyCohortArchived,
  createCohortRecord,
  validateCohortName,
  validateSetCohortArchived,
} from '../../src/cohorts';
import {
  applyClassManagers,
  applyClassUpdate,
  createClassRecord,
  validateCreateClass,
  validateSetClassManagers,
  validateUpdateClass,
} from '../../src/classes';
import {
  applyEnrollmentActive,
  createEnrollmentRecord,
  validateEnrollment,
  validateSetEnrollmentActive,
} from '../../src/enrollments';
import { createStudentAccount } from '../../src/students';

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

const ADMIN = 'admin-uid';
const MGR = 'mgr-uid';

async function clearAll() {
  const db = getFirestore();
  for (const c of [
    COLLECTIONS.staffUsers,
    COLLECTIONS.students,
    COLLECTIONS.cohorts,
    COLLECTIONS.classes,
    COLLECTIONS.enrollments,
  ]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const users = await getAuth().listUsers();
  await Promise.all(users.users.map((u) => getAuth().deleteUser(u.uid)));
}

async function seedStaff(uid: string, role: 'admin' | 'manager', status = 'active') {
  await getFirestore().collection(COLLECTIONS.staffUsers).doc(uid).set({
    displayName: uid,
    email: `${uid}@oursabeel.com`,
    photoUrl: null,
    role,
    status,
    createdAt: 1,
  });
}

beforeEach(async () => {
  await clearAll();
  await seedStaff(ADMIN, 'admin');
  await seedStaff(MGR, 'manager');
});

const classDoc = async (id: string) =>
  (await getFirestore().collection(COLLECTIONS.classes).doc(id).get()).data() as ClassDoc;

describe('cohort archive cascade', () => {
  it('deactivates every class, and restores each to its OWN state', async () => {
    // The round-trip structure.test.ts asserts on the pure function, now through
    // the real callable: reactivating a cohort must NOT switch every class back
    // on, only those that were not archived in their own right.
    const { id: cohortId } = await createCohortRecord(ADMIN, 'Autumn 2026');
    const { id: openId } = await createClassRecord(ADMIN, { cohortId, name: 'Open' });
    const { id: shutId } = await createClassRecord(ADMIN, { cohortId, name: 'Shut' });
    await applyClassUpdate({ classId: shutId, archived: true });

    expect((await classDoc(openId)).effectiveActive).toBe(true);
    expect((await classDoc(shutId)).effectiveActive).toBe(false);

    await applyCohortArchived({ cohortId, archived: true });
    expect((await classDoc(openId)).effectiveActive).toBe(false);
    expect((await classDoc(shutId)).effectiveActive).toBe(false);

    await applyCohortArchived({ cohortId, archived: false });
    expect((await classDoc(openId)).effectiveActive).toBe(true);
    // The one that was archived in its own right stays archived.
    expect((await classDoc(shutId)).effectiveActive).toBe(false);
    expect((await classDoc(shutId)).archived).toBe(true);
  });

  it('never writes the class\'s own archived flag', async () => {
    const { id: cohortId } = await createCohortRecord(ADMIN, 'C');
    const { id } = await createClassRecord(ADMIN, { cohortId, name: 'K' });
    await applyCohortArchived({ cohortId, archived: true });
    // If the cascade wrote `archived: true` here, the restore above could never
    // distinguish "archived because its cohort was" from "archived on purpose".
    expect((await classDoc(id)).archived).toBe(false);
  });

  it('seeds a class created inside an archived cohort as inactive', async () => {
    const { id: cohortId } = await createCohortRecord(ADMIN, 'Old');
    await applyCohortArchived({ cohortId, archived: true });
    const { id } = await createClassRecord(ADMIN, { cohortId, name: 'Late' });
    expect((await classDoc(id)).effectiveActive).toBe(false);
  });

  it('keeps a class inactive when it is archived inside an archived cohort', async () => {
    const { id: cohortId } = await createCohortRecord(ADMIN, 'X');
    const { id } = await createClassRecord(ADMIN, { cohortId, name: 'Y' });
    await applyCohortArchived({ cohortId, archived: true });
    // Unarchiving the CLASS alone must not resurrect it — the cohort is the
    // other half of the derivation.
    await applyClassUpdate({ classId: id, archived: false });
    expect((await classDoc(id)).effectiveActive).toBe(false);
  });

  it('rejects an unknown cohort', async () => {
    await expect(applyCohortArchived({ cohortId: 'nope', archived: true })).rejects.toThrow();
  });
});

describe('setClassManagers', () => {
  it('assigns an active staff member', async () => {
    const { id: cohortId } = await createCohortRecord(ADMIN, 'C');
    const { id } = await createClassRecord(ADMIN, { cohortId, name: 'K' });
    await applyClassManagers({ classId: id, managerUids: [MGR] });
    expect((await classDoc(id)).managerUids).toEqual([MGR]);
  });

  it('REFUSES a uid that is not an active staff member', async () => {
    // managerUids is read directly by the security rules, so writing an
    // invented or disabled uid into it is granting access, not mislabelling.
    const { id: cohortId } = await createCohortRecord(ADMIN, 'C');
    const { id } = await createClassRecord(ADMIN, { cohortId, name: 'K' });
    await expect(
      applyClassManagers({ classId: id, managerUids: ['ghost'] }),
    ).rejects.toThrow(/not an active staff member/);

    await seedStaff('sleeper', 'manager', 'pending');
    await expect(
      applyClassManagers({ classId: id, managerUids: ['sleeper'] }),
    ).rejects.toThrow(/not an active staff member/);

    await seedStaff('gone', 'manager', 'disabled');
    await expect(
      applyClassManagers({ classId: id, managerUids: ['gone'] }),
    ).rejects.toThrow(/not an active staff member/);

    expect((await classDoc(id)).managerUids).toEqual([]);
  });

  it('de-duplicates', () => {
    expect(
      validateSetClassManagers({ classId: 'c', managerUids: ['a', 'a', 'b'] }).managerUids,
    ).toEqual(['a', 'b']);
  });
});

describe('enrollments', () => {
  const setup = async () => {
    const { id: cohortId } = await createCohortRecord(ADMIN, 'C');
    const { id: classId } = await createClassRecord(ADMIN, { cohortId, name: 'K' });
    const student = await createStudentAccount(ADMIN, {
      displayName: 'Sara',
      email: 'sara@example.com',
    });
    return { cohortId, classId, studentUid: student.uid };
  };

  it('creates an active enrolment with the composite id', async () => {
    const { classId, studentUid, cohortId } = await setup();
    await createEnrollmentRecord(ADMIN, { studentUid, classId });
    const snap = await getFirestore()
      .collection(COLLECTIONS.enrollments)
      .doc(enrollmentId(studentUid, classId))
      .get();
    expect(snap.data()).toMatchObject({ studentUid, classId, cohortId, active: true });
  });

  it('unenrolling KEEPS the row, so history survives', async () => {
    const { classId, studentUid } = await setup();
    await createEnrollmentRecord(ADMIN, { studentUid, classId });
    await applyEnrollmentActive({ studentUid, classId, active: false });

    const snap = await getFirestore()
      .collection(COLLECTIONS.enrollments)
      .doc(enrollmentId(studentUid, classId))
      .get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.active).toBe(false);
    expect(typeof snap.data()?.unenrolledAt).toBe('number');
  });

  it('re-enrolling reuses the same row and preserves the original date', async () => {
    const { classId, studentUid } = await setup();
    const first = await createEnrollmentRecord(ADMIN, { studentUid, classId });
    await applyEnrollmentActive({ studentUid, classId, active: false });
    await createEnrollmentRecord(MGR, { studentUid, classId });

    const all = await getFirestore()
      .collection(COLLECTIONS.enrollments)
      .where('studentUid', '==', studentUid)
      .get();
    expect(all.size).toBe(1); // not a second row
    const doc = all.docs[0].data() as EnrollmentDoc;
    expect(doc.active).toBe(true);
    expect(doc.enrolledAt).toBe(first.enrolledAt);
  });

  it('refuses a duplicate active enrolment', async () => {
    const { classId, studentUid } = await setup();
    await createEnrollmentRecord(ADMIN, { studentUid, classId });
    await expect(createEnrollmentRecord(ADMIN, { studentUid, classId })).rejects.toThrow(/already/i);
  });

  it('refuses to enrol a disabled student', async () => {
    const { classId, studentUid } = await setup();
    await getFirestore()
      .collection(COLLECTIONS.students)
      .doc(studentUid)
      .update({ status: 'disabled' });
    await expect(createEnrollmentRecord(ADMIN, { studentUid, classId })).rejects.toThrow(/disabled/i);
  });

  it('rejects an unknown class or student', async () => {
    const { classId, studentUid } = await setup();
    await expect(createEnrollmentRecord(ADMIN, { studentUid, classId: 'nope' })).rejects.toThrow();
    await expect(createEnrollmentRecord(ADMIN, { studentUid: 'nope', classId })).rejects.toThrow();
  });

  it('validates input', () => {
    for (const bad of [null, {}, { studentUid: 's' }, { classId: 'c' }, { studentUid: '', classId: 'c' }]) {
      expect(() => validateEnrollment(bad)).toThrow();
    }
  });
});

describe('createStudent with a class', () => {
  it('writes the student and the enrolment together', async () => {
    const { id: cohortId } = await createCohortRecord(ADMIN, 'C');
    const { id: classId } = await createClassRecord(ADMIN, { cohortId, name: 'K' });
    const res = await createStudentAccount(ADMIN, {
      displayName: 'Bilal',
      email: 'bilal@example.com',
      classId,
    });

    const db = getFirestore();
    expect((await db.collection(COLLECTIONS.students).doc(res.uid).get()).exists).toBe(true);
    const enr = await db
      .collection(COLLECTIONS.enrollments)
      .doc(enrollmentId(res.uid, classId))
      .get();
    expect(enr.data()).toMatchObject({ classId, cohortId, active: true });
  });

  it('rejects an unknown class', async () => {
    await expect(
      createStudentAccount(ADMIN, { displayName: 'X', email: 'x@example.com', classId: 'nope' }),
    ).rejects.toThrow();
  });
});

describe('validators', () => {
  it('cohort names are trimmed and required', () => {
    expect(validateCohortName({ name: '  Autumn  ' })).toBe('Autumn');
    for (const bad of [null, {}, { name: '   ' }, { name: 'x'.repeat(200) }]) {
      expect(() => validateCohortName(bad)).toThrow();
    }
  });

  it('class updates reject an empty change set', () => {
    expect(() => validateUpdateClass({ classId: 'c' })).toThrow(/Nothing to change/);
    expect(validateUpdateClass({ classId: 'c', archived: true })).toEqual({
      classId: 'c',
      archived: true,
    });
  });

  it('class updates reject a blank rename', () => {
    // An empty name would leave a class with no label anywhere in the UI.
    expect(() => validateUpdateClass({ classId: 'c', name: '   ' })).toThrow();
    expect(validateUpdateClass({ classId: 'c', name: '  K  ' }).name).toBe('K');
  });

  it('createClass requires a cohort and a name', () => {
    for (const bad of [null, {}, { cohortId: 'c' }, { name: 'K' }, { cohortId: 'c', name: ' ' }]) {
      expect(() => validateCreateClass(bad)).toThrow();
    }
    expect(validateCreateClass({ cohortId: 'c', name: ' K ' })).toEqual({
      cohortId: 'c',
      name: 'K',
    });
  });

  it('cohort archive requires an explicit boolean', () => {
    // Not truthiness: `archived: "false"` must be rejected outright rather than
    // silently archiving a cohort and every class in it.
    for (const bad of [null, {}, { cohortId: 'c' }, { cohortId: 'c', archived: 'false' }]) {
      expect(() => validateSetCohortArchived(bad)).toThrow();
    }
    expect(validateSetCohortArchived({ cohortId: 'c', archived: false })).toEqual({
      cohortId: 'c',
      archived: false,
    });
  });

  it('enrollment activation requires an explicit boolean', () => {
    for (const bad of [
      { studentUid: 's', classId: 'c' },
      { studentUid: 's', classId: 'c', active: 'yes' },
    ]) {
      expect(() => validateSetEnrollmentActive(bad)).toThrow();
    }
    expect(validateSetEnrollmentActive({ studentUid: 's', classId: 'c', active: false })).toEqual({
      studentUid: 's',
      classId: 'c',
      active: false,
    });
  });
});
