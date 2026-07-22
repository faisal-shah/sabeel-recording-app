import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS, EMULATOR_PROJECT_ID, enrollmentId } from '@sabeel/shared';

/**
 * Rules for cohorts, classes and enrollments.
 *
 * The two failure modes this phase introduces are "a manager sees another
 * manager's class" and "a student sees another student's enrolment", so both are
 * asserted in both directions. The scale test at the bottom exists because those
 * rules involve a cross-document get() whose cost depends on the query shape —
 * a correctness property that only shows up above a certain row count.
 */

let testEnv: RulesTestEnvironment;

function hostPort(envValue: string | undefined, fallbackPort: number) {
  const [host, port] = (envValue ?? `127.0.0.1:${fallbackPort}`).split(':');
  return { host: host || '127.0.0.1', port: Number(port) };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      ...hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080),
      rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const ADMIN = 'admin1';
const MINE = 'mgrMine';
const THEIRS = 'mgrTheirs';
const STU_A = 'stuA';
const STU_B = 'stuB';
const CLASS_MINE = 'classMine';
const CLASS_THEIRS = 'classTheirs';
const COHORT = 'cohort1';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, COLLECTIONS.cohorts, COHORT), {
      name: 'Autumn',
      archived: false,
      createdAt: 1,
      createdBy: ADMIN,
    });
    const cls = (id: string, managerUids: string[]) =>
      setDoc(doc(db, COLLECTIONS.classes, id), {
        cohortId: COHORT,
        name: id,
        archived: false,
        effectiveActive: true,
        archivedAccess: false,
        managerUids,
        createdAt: 1,
        createdBy: ADMIN,
      });
    const enrol = (studentUid: string, classId: string) =>
      setDoc(doc(db, COLLECTIONS.enrollments, enrollmentId(studentUid, classId)), {
        studentUid,
        classId,
        cohortId: COHORT,
        active: true,
        enrolledAt: 1,
        enrolledBy: ADMIN,
      });
    await Promise.all([
      cls(CLASS_MINE, [MINE]),
      cls(CLASS_THEIRS, [THEIRS]),
      enrol(STU_A, CLASS_MINE),
      enrol(STU_B, CLASS_THEIRS),
    ]);
  });
});

const ctx = (uid: string, role: string) =>
  testEnv.authenticatedContext(uid, { role, status: 'active' }).firestore();
const admin = () => ctx(ADMIN, 'admin');
const mine = () => ctx(MINE, 'manager');
const theirs = () => ctx(THEIRS, 'manager');
const studentA = () => ctx(STU_A, 'student');

describe('cohorts', () => {
  it('are readable by any staff, and by nobody else', async () => {
    await assertSucceeds(getDocs(collection(admin(), COLLECTIONS.cohorts)));
    await assertSucceeds(getDocs(collection(mine(), COLLECTIONS.cohorts)));
    await assertFails(getDocs(collection(studentA(), COLLECTIONS.cohorts)));
  });

  it('cannot be written by anyone, including an admin', async () => {
    await assertFails(updateDoc(doc(admin(), COLLECTIONS.cohorts, COHORT), { archived: true }));
  });
});

describe('classes', () => {
  it('let an admin list everything, unconstrained', async () => {
    await assertSucceeds(getDocs(collection(admin(), COLLECTIONS.classes)));
  });

  it('let a manager list ONLY with the array-contains constraint', async () => {
    // The unconstrained list must fail. This is the whole reason the rule reads
    // resource.data rather than merely documenting the expected query shape.
    await assertFails(getDocs(collection(mine(), COLLECTIONS.classes)));
    await assertSucceeds(
      getDocs(
        query(
          collection(mine(), COLLECTIONS.classes),
          where('managerUids', 'array-contains', MINE),
        ),
      ),
    );
  });

  it('do not let a manager read a class they do not run', async () => {
    await assertSucceeds(getDoc(doc(mine(), COLLECTIONS.classes, CLASS_MINE)));
    await assertFails(getDoc(doc(mine(), COLLECTIONS.classes, CLASS_THEIRS)));
    await assertFails(getDoc(doc(theirs(), COLLECTIONS.classes, CLASS_MINE)));
  });

  it('do not let a manager query their way into someone else\'s class', async () => {
    // Asking for the other manager's rows while claiming your own constraint.
    await assertFails(
      getDocs(
        query(
          collection(mine(), COLLECTIONS.classes),
          where('managerUids', 'array-contains', THEIRS),
        ),
      ),
    );
  });

  it('let an enrolled student read their class, but not another', async () => {
    await assertSucceeds(getDoc(doc(studentA(), COLLECTIONS.classes, CLASS_MINE)));
    await assertFails(getDoc(doc(studentA(), COLLECTIONS.classes, CLASS_THEIRS)));
  });

  it('never let a student LIST classes', async () => {
    await assertFails(getDocs(collection(studentA(), COLLECTIONS.classes)));
  });

  it('are write-denied to everyone', async () => {
    await assertFails(updateDoc(doc(admin(), COLLECTIONS.classes, CLASS_MINE), { name: 'x' }));
    await assertFails(
      updateDoc(doc(mine(), COLLECTIONS.classes, CLASS_MINE), { managerUids: [MINE, THEIRS] }),
    );
  });
});

describe('enrollments', () => {
  it('let a student list their OWN, and nothing else', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(studentA(), COLLECTIONS.enrollments),
          where('studentUid', '==', STU_A),
        ),
      ),
    );
    // Unconstrained, or constrained to somebody else: both denied.
    await assertFails(getDocs(collection(studentA(), COLLECTIONS.enrollments)));
    await assertFails(
      getDocs(
        query(
          collection(studentA(), COLLECTIONS.enrollments),
          where('studentUid', '==', STU_B),
        ),
      ),
    );
  });

  it('do not let a student read another student\'s enrolment directly', async () => {
    await assertSucceeds(
      getDoc(doc(studentA(), COLLECTIONS.enrollments, enrollmentId(STU_A, CLASS_MINE))),
    );
    await assertFails(
      getDoc(doc(studentA(), COLLECTIONS.enrollments, enrollmentId(STU_B, CLASS_THEIRS))),
    );
  });

  it('let a scoped manager read their class roster', async () => {
    await assertSucceeds(
      getDocs(
        query(collection(mine(), COLLECTIONS.enrollments), where('classId', '==', CLASS_MINE)),
      ),
    );
  });

  it('do not let a manager read another class\'s roster', async () => {
    await assertFails(
      getDocs(
        query(collection(mine(), COLLECTIONS.enrollments), where('classId', '==', CLASS_THEIRS)),
      ),
    );
    await assertFails(
      getDoc(doc(mine(), COLLECTIONS.enrollments, enrollmentId(STU_B, CLASS_THEIRS))),
    );
  });

  it('are write-denied to everyone', async () => {
    await assertFails(
      updateDoc(doc(admin(), COLLECTIONS.enrollments, enrollmentId(STU_A, CLASS_MINE)), {
        active: false,
      }),
    );
  });
});

describe('query cost: the arm-ordering property', () => {
  /**
   * These two are the reason the enrollments rule is ordered the way it is.
   *
   * Firestore caps document-access calls per query. The staff arm resolves a
   * class get() from each row's data, so it is only affordable when every row
   * shares one classId — which a roster query guarantees and a student's
   * cross-class query does not. If the zero-read student arm were not first,
   * the second test here would fail once a student is in enough classes.
   *
   * Both are sized past the limit deliberately: at three rows they pass either
   * way, which is exactly how this ships broken.
   */
  const BIG = 25;

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const writes: Promise<unknown>[] = [];
      for (let i = 0; i < BIG; i++) {
        const uid = `bulk${i}`;
        writes.push(
          setDoc(doc(db, COLLECTIONS.enrollments, enrollmentId(uid, CLASS_MINE)), {
            studentUid: uid,
            classId: CLASS_MINE,
            cohortId: COHORT,
            active: true,
            enrolledAt: 1,
            enrolledBy: ADMIN,
          }),
        );
        // …and put student A into many classes, each a DIFFERENT class id.
        const otherClass = `extra${i}`;
        writes.push(
          setDoc(doc(db, COLLECTIONS.classes, otherClass), {
            cohortId: COHORT,
            name: otherClass,
            archived: false,
            effectiveActive: true,
            archivedAccess: false,
            managerUids: [THEIRS],
            createdAt: 1,
            createdBy: ADMIN,
          }),
        );
        writes.push(
          setDoc(doc(db, COLLECTIONS.enrollments, enrollmentId(STU_A, otherClass)), {
            studentUid: STU_A,
            classId: otherClass,
            cohortId: COHORT,
            active: true,
            enrolledAt: 1,
            enrolledBy: ADMIN,
          }),
        );
      }
      await Promise.all(writes);
    });
  });

  it(`a manager reads a ${BIG}-student roster in one query`, async () => {
    const snap = await assertSucceeds(
      getDocs(
        query(collection(mine(), COLLECTIONS.enrollments), where('classId', '==', CLASS_MINE)),
      ),
    );
    expect(snap.size).toBeGreaterThanOrEqual(BIG);
  });

  it(`a student reads their own ${BIG}+ enrollments spanning many classes`, async () => {
    // Every row here has a different classId. This only works because the
    // student arm is satisfied with zero document reads.
    const snap = await assertSucceeds(
      getDocs(
        query(collection(studentA(), COLLECTIONS.enrollments), where('studentUid', '==', STU_A)),
      ),
    );
    expect(snap.size).toBeGreaterThan(BIG);
  });
});
