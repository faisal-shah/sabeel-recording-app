import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { COLLECTIONS, EMULATOR_PROJECT_ID } from '@sabeel/shared';

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
const CLASS_MINE = 'classMine';
const CLASS_THEIRS = 'classTheirs';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const entry = (id: string, classId: string | null) =>
      setDoc(doc(db, COLLECTIONS.auditLog, id), {
        at: 1,
        actorUid: ADMIN,
        actorRole: 'admin',
        action: 'setRecordingStatus',
        classId,
        targets: {},
      });
    await Promise.all([
      setDoc(doc(db, COLLECTIONS.classes, CLASS_MINE), { cohortId: 'c1', managerUids: [MINE] }),
      setDoc(doc(db, COLLECTIONS.classes, CLASS_THEIRS), { cohortId: 'c1', managerUids: [THEIRS] }),
      entry('mine', CLASS_MINE),
      entry('theirs', CLASS_THEIRS),
      entry('global', null), // a class-less entry (cohort/staff change)
    ]);
  });
});

const ctx = (uid: string, role: string) =>
  testEnv.authenticatedContext(uid, { role, status: 'active' });
const admin = () => ctx(ADMIN, 'admin');
const mgrMine = () => ctx(MINE, 'manager');
const student = () => ctx('stu', 'student');

describe('auditLog reads', () => {
  it('an admin lists everything, including class-less entries', async () => {
    await assertSucceeds(getDocs(collection(admin().firestore(), COLLECTIONS.auditLog)));
  });

  it("a manager reads their class's entries", async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(mgrMine().firestore(), COLLECTIONS.auditLog),
          where('classId', '==', CLASS_MINE),
        ),
      ),
    );
  });

  it('a manager cannot read another class’s entry', async () => {
    await assertFails(
      getDoc(doc(mgrMine().firestore(), COLLECTIONS.auditLog, 'theirs')),
    );
  });

  it('a manager cannot read a class-less (admin-only) entry', async () => {
    await assertFails(getDoc(doc(mgrMine().firestore(), COLLECTIONS.auditLog, 'global')));
  });

  it('a manager cannot list unconstrained (would expose other classes + global)', async () => {
    await assertFails(getDocs(collection(mgrMine().firestore(), COLLECTIONS.auditLog)));
  });

  it('a student cannot read the audit log at all', async () => {
    await assertFails(getDoc(doc(student().firestore(), COLLECTIONS.auditLog, 'mine')));
  });
});

describe('auditLog is append-only from the server', () => {
  it('no client may write an entry', async () => {
    for (const c of [admin(), mgrMine(), student()]) {
      await assertFails(
        setDoc(doc(c.firestore(), COLLECTIONS.auditLog, 'forged'), {
          at: 1,
          actorUid: 'x',
          actorRole: 'admin',
          action: 'forged',
          classId: null,
          targets: {},
        }),
      );
    }
  });
});
