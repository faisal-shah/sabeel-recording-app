import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { COLLECTIONS, EMULATOR_PROJECT_ID, assignmentId, completionId } from '@sabeel/shared';

let testEnv: RulesTestEnvironment;

/**
 * `host:port` from the emulator env var the CLI exports.
 *
 * NO fallback port, deliberately. `emulators:exec` always sets these
 * (`firebase-tools/lib/emulator/env.js`), so an unset var means the suite is
 * running outside the wrapper — and a hardcoded default does not rescue that,
 * it points at whatever happens to be on that port. On a machine where three
 * checkouts run emulators, that is a SIBLING's: it reads and writes happily and
 * turns a rules suite green against the wrong database. Failing loudly is the
 * only safe behaviour.
 */
function hostPort(envName: string) {
  const value = process.env[envName];
  if (!value) throw new Error(`${envName} is unset — run via npm run test:emulator`);
  const [host, port] = value.split(':');
  // Literal 127.0.0.1, never 'localhost': the emulators bind IPv4 only, while
  // 'localhost' can resolve to IPv6 ::1 first and fail at connect.
  return { host: host || '127.0.0.1', port: Number(port) };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      ...hostPort('FIRESTORE_EMULATOR_HOST'),
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
const STUDENT = 'stu1';
const OUTSIDER = 'stu2';
const CLASS_MINE = 'classMine';
const CLASS_THEIRS = 'classTheirs';
const REC = 'rec1';
const THEIR_REC = 'recTheirs';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const cls = (id: string, managerUids: string[]) =>
      setDoc(doc(db, COLLECTIONS.courses, id), { cohortId: 'c1', managerUids });
    const assignment = (studentUid: string, recordingId: string, courseId: string) =>
      setDoc(doc(db, COLLECTIONS.assignments, assignmentId(studentUid, recordingId)), {
        studentUid,
        recordingId,
        courseId,
        cohortId: 'c1',
        dueDate: null,
        source: 'publish',
        active: true,
        assignedAt: 1,
        assignedBy: 'system',
      });
    const completion = (studentUid: string, recordingId: string) =>
      setDoc(doc(db, COLLECTIONS.completions, completionId(studentUid, recordingId)), {
        studentUid,
        recordingId,
        courseId: CLASS_MINE,
        completed: true,
        completedAt: 1,
        updatedAt: 1,
      });
    await Promise.all([
      cls(CLASS_MINE, [MINE]),
      cls(CLASS_THEIRS, [THEIRS]),
      assignment(STUDENT, REC, CLASS_MINE),
      assignment(OUTSIDER, THEIR_REC, CLASS_THEIRS),
      completion(STUDENT, REC),
    ]);
  });
});

const ctx = (uid: string, role: string) =>
  testEnv.authenticatedContext(uid, { role, status: 'active' });
const admin = () => ctx(ADMIN, 'admin');
const mgrMine = () => ctx(MINE, 'manager');
const mgrTheirs = () => ctx(THEIRS, 'manager');
const student = () => ctx(STUDENT, 'student');
const outsider = () => ctx(OUTSIDER, 'student');

// ------------------------------------------------------------- assignments --

describe('assignments: reads', () => {
  it('a student lists their OWN obligations', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(student().firestore(), COLLECTIONS.assignments),
          where('studentUid', '==', STUDENT),
        ),
      ),
    );
  });

  it('a student cannot list assignments unconstrained (would expose others)', async () => {
    await assertFails(getDocs(collection(student().firestore(), COLLECTIONS.assignments)));
  });

  it("a student cannot read another student's obligation", async () => {
    await assertFails(
      getDoc(doc(outsider().firestore(), COLLECTIONS.assignments, assignmentId(STUDENT, REC))),
    );
  });

  it('an admin lists everything', async () => {
    await assertSucceeds(getDocs(collection(admin().firestore(), COLLECTIONS.assignments)));
  });

  it("a manager reads their class's assignments", async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(mgrMine().firestore(), COLLECTIONS.assignments),
          where('courseId', '==', CLASS_MINE),
        ),
      ),
    );
  });

  it('a manager cannot read a class they do not run', async () => {
    await assertFails(
      getDoc(doc(mgrTheirs().firestore(), COLLECTIONS.assignments, assignmentId(STUDENT, REC))),
    );
  });
});

describe('assignments: writes are server-only', () => {
  it('a student cannot create their own obligation', async () => {
    await assertFails(
      setDoc(doc(student().firestore(), COLLECTIONS.assignments, assignmentId(STUDENT, 'new')), {
        studentUid: STUDENT,
        recordingId: 'new',
        courseId: CLASS_MINE,
        cohortId: 'c1',
        dueDate: null,
        source: 'publish',
        active: true,
        assignedAt: 1,
        assignedBy: STUDENT,
      }),
    );
  });

  it('a student cannot flip their own obligation inactive to dodge accountability', async () => {
    await assertFails(
      updateDoc(doc(student().firestore(), COLLECTIONS.assignments, assignmentId(STUDENT, REC)), {
        active: false,
      }),
    );
  });
});

// ------------------------------------------------------------- completions --

describe('completions: self-only client writes', () => {
  it('a student reads their own completion', async () => {
    await assertSucceeds(
      getDoc(doc(student().firestore(), COLLECTIONS.completions, completionId(STUDENT, REC))),
    );
  });

  it("a student cannot read another student's completion", async () => {
    await assertFails(
      getDoc(doc(outsider().firestore(), COLLECTIONS.completions, completionId(STUDENT, REC))),
    );
  });

  it('a student creates their own completion', async () => {
    await assertSucceeds(
      setDoc(doc(student().firestore(), COLLECTIONS.completions, completionId(STUDENT, 'rNew')), {
        studentUid: STUDENT,
        recordingId: 'rNew',
        courseId: CLASS_MINE,
        completed: true,
        completedAt: 2,
        updatedAt: 2,
      }),
    );
  });

  it('a student cannot forge a completion in someone else’s name', async () => {
    await assertFails(
      setDoc(doc(outsider().firestore(), COLLECTIONS.completions, completionId(STUDENT, 'rNew')), {
        studentUid: STUDENT,
        recordingId: 'rNew',
        courseId: CLASS_MINE,
        completed: true,
        completedAt: 2,
        updatedAt: 2,
      }),
    );
  });

  it('a student cannot delete a completion', async () => {
    // deletion denied outright — completion history is not erasable by the client
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(
      deleteDoc(doc(student().firestore(), COLLECTIONS.completions, completionId(STUDENT, REC))),
    );
  });
});

// -------------------------------------------------------- completion events --

describe('completionEvents: append-only', () => {
  const event = (actor: string, studentUid: string) => ({
    studentUid,
    recordingId: REC,
    courseId: CLASS_MINE,
    action: 'complete',
    actor,
    at: 5,
  });

  it('a student appends their own event', async () => {
    await assertSucceeds(
      setDoc(doc(student().firestore(), COLLECTIONS.completionEvents, 'e1'), event('student', STUDENT)),
    );
  });

  it('a student cannot forge an event for someone else', async () => {
    await assertFails(
      setDoc(doc(outsider().firestore(), COLLECTIONS.completionEvents, 'e2'), event('student', STUDENT)),
    );
  });

  it('a student cannot masquerade as a staff actor', async () => {
    await assertFails(
      setDoc(doc(student().firestore(), COLLECTIONS.completionEvents, 'e3'), event('staff', STUDENT)),
    );
  });

  it('an appended event cannot be updated or deleted (history is immutable)', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), COLLECTIONS.completionEvents, 'seed'), event('student', STUDENT));
    });
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(student().firestore(), COLLECTIONS.completionEvents, 'seed'), { action: 'uncomplete' }),
    );
    await assertFails(
      deleteDoc(doc(student().firestore(), COLLECTIONS.completionEvents, 'seed')),
    );
  });
});
