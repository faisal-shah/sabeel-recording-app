import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, EMULATOR_PROJECT_ID } from '@sabeel/shared';

/**
 * Rules for the two auth populations.
 *
 * Every case here is about the TOKEN, because that is what the rules read. The
 * mirror documents are seeded with security rules disabled — a client can never
 * write them, which is itself one of the assertions.
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
    storage: {
      ...hostPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199),
      rules: readFileSync(new URL('../../../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const ADMIN = 'admin1';
const MANAGER = 'manager1';
const PENDING = 'pending1';
const DISABLED = 'disabled1';
const STUDENT = 'student1';
const OTHER_STUDENT = 'student2';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const staff = (uid: string, role: string, status: string) =>
      setDoc(doc(db, COLLECTIONS.staffUsers, uid), {
        displayName: uid,
        email: `${uid}@oursabeel.com`,
        photoUrl: null,
        role,
        status,
        createdAt: 1,
      });
    const student = (uid: string, status: string) =>
      setDoc(doc(db, COLLECTIONS.students, uid), {
        displayName: uid,
        email: `${uid}@example.com`,
        role: 'student',
        status,
        createdAt: 1,
        createdBy: ADMIN,
      });
    await Promise.all([
      staff(ADMIN, 'admin', 'active'),
      staff(MANAGER, 'manager', 'active'),
      staff(PENDING, 'manager', 'pending'),
      staff(DISABLED, 'manager', 'disabled'),
      student(STUDENT, 'active'),
      student(OTHER_STUDENT, 'active'),
    ]);
  });
});

const ctx = (uid: string, role: string, status: string) =>
  testEnv.authenticatedContext(uid, { role, status }).firestore();
const admin = () => ctx(ADMIN, 'admin', 'active');
const manager = () => ctx(MANAGER, 'manager', 'active');
const pending = () => ctx(PENDING, 'manager', 'pending');
const disabled = () => ctx(DISABLED, 'manager', 'disabled');
const student = () => ctx(STUDENT, 'student', 'active');
const anon = () => testEnv.unauthenticatedContext().firestore();

describe('staffUsers', () => {
  it('lets staff list the roster', async () => {
    await assertSucceeds(getDocs(collection(admin(), COLLECTIONS.staffUsers)));
    await assertSucceeds(getDocs(collection(manager(), COLLECTIONS.staffUsers)));
  });

  it('lets a PENDING user read their own document', async () => {
    // Load-bearing: the gate screen reads this to show status, and it is how
    // approval becomes visible without a sign-out.
    await assertSucceeds(getDoc(doc(pending(), COLLECTIONS.staffUsers, PENDING)));
  });

  it('does not let a pending user read anyone else, or list', async () => {
    await assertFails(getDoc(doc(pending(), COLLECTIONS.staffUsers, ADMIN)));
    await assertFails(getDocs(collection(pending(), COLLECTIONS.staffUsers)));
  });

  it('treats a disabled account like a stranger, apart from its own document', async () => {
    await assertSucceeds(getDoc(doc(disabled(), COLLECTIONS.staffUsers, DISABLED)));
    await assertFails(getDocs(collection(disabled(), COLLECTIONS.staffUsers)));
  });

  it('does not let students read staff', async () => {
    await assertFails(getDoc(doc(student(), COLLECTIONS.staffUsers, ADMIN)));
    await assertFails(getDocs(collection(student(), COLLECTIONS.staffUsers)));
  });

  it('denies anonymous access entirely', async () => {
    await assertFails(getDoc(doc(anon(), COLLECTIONS.staffUsers, ADMIN)));
  });

  it('lets NOBODY write — not even an admin, not even themselves', async () => {
    // Access changes go through the setStaffAccess callable, which re-checks the
    // caller. If clients could write here, self-promotion would be one
    // updateDoc away.
    await assertFails(updateDoc(doc(admin(), COLLECTIONS.staffUsers, MANAGER), { role: 'admin' }));
    await assertFails(updateDoc(doc(admin(), COLLECTIONS.staffUsers, ADMIN), { role: 'admin' }));
    await assertFails(
      updateDoc(doc(manager(), COLLECTIONS.staffUsers, MANAGER), { role: 'admin' }),
    );
    await assertFails(
      updateDoc(doc(pending(), COLLECTIONS.staffUsers, PENDING), { status: 'active' }),
    );
  });
});

describe('students', () => {
  it('lets staff list students', async () => {
    await assertSucceeds(getDocs(collection(admin(), COLLECTIONS.students)));
    await assertSucceeds(getDocs(collection(manager(), COLLECTIONS.students)));
  });

  it('lets a student read only their own record', async () => {
    await assertSucceeds(getDoc(doc(student(), COLLECTIONS.students, STUDENT)));
    await assertFails(getDoc(doc(student(), COLLECTIONS.students, OTHER_STUDENT)));
    await assertFails(getDocs(collection(student(), COLLECTIONS.students)));
  });

  it('does not let a student edit their own record', async () => {
    // Their name is part of the accountability record staff read.
    await assertFails(
      updateDoc(doc(student(), COLLECTIONS.students, STUDENT), { displayName: 'Someone Else' }),
    );
    await assertFails(
      updateDoc(doc(student(), COLLECTIONS.students, STUDENT), { status: 'active' }),
    );
  });

  it('does not let staff write students directly', async () => {
    await assertFails(
      updateDoc(doc(admin(), COLLECTIONS.students, STUDENT), { status: 'disabled' }),
    );
  });
});

describe('collections not yet opened', () => {
  it('stay denied even to an admin', async () => {
    // Each collection is opened by the phase that earns it, and gets its own
    // suite: cohorts/classes/enrollments in 1b (rules.structure.test.ts),
    // recordings in 3b, assignments in 4b, auditLog in 5a (rules.audit.test.ts).
    // What remains here has NO staff access yet — listeningProgress and
    // completions are student-only (staff reads are the Phase 5b ledger), and
    // completionEvents is student-append.
    for (const name of [
      COLLECTIONS.listeningProgress,
      COLLECTIONS.completions,
      COLLECTIONS.completionEvents,
    ]) {
      await assertFails(getDocs(collection(admin(), name)));
      await assertFails(setDoc(doc(admin(), name, 'x'), { any: 'thing' }));
    }
  });

  it('stay WRITE-denied on the collections opened for reading', async () => {
    // Opening a collection to reads must not have opened it to writes: every
    // mutation goes through a callable (or the fan-out trigger) that re-checks
    // scope. Assignments and the audit log are readable by an admin but still
    // server-written only.
    for (const name of [
      COLLECTIONS.cohorts,
      COLLECTIONS.classes,
      COLLECTIONS.enrollments,
      COLLECTIONS.recordings,
      COLLECTIONS.assignments,
      COLLECTIONS.auditLog,
    ]) {
      await assertFails(setDoc(doc(admin(), name, 'x'), { any: 'thing' }));
    }
  });
});
