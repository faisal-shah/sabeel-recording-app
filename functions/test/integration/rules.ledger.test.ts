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

const MINE = 'mgrMine';
const THEIRS = 'mgrTheirs';
const STUDENT = 'stu1';
const OUTSIDER = 'stu2';
const CLASS_MINE = 'classMine';
const CLASS_THEIRS = 'classTheirs';
const REC = 'rec1';

// Every ledger-read collection shares the same shape: a `classId` and a
// `studentUid`. Seed one of each in "my" class and one in "theirs".
const LEDGER_COLLECTIONS = [
  COLLECTIONS.completions,
  COLLECTIONS.listeningProgress,
  COLLECTIONS.completionEvents,
  COLLECTIONS.completionOverrides,
];

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, COLLECTIONS.classes, CLASS_MINE), { cohortId: 'c1', managerUids: [MINE] });
    await setDoc(doc(db, COLLECTIONS.classes, CLASS_THEIRS), { cohortId: 'c1', managerUids: [THEIRS] });
    for (const name of LEDGER_COLLECTIONS) {
      await setDoc(doc(db, name, `${STUDENT}_${REC}`), {
        studentUid: STUDENT,
        recordingId: REC,
        classId: CLASS_MINE,
        completed: true,
        actor: 'student',
      });
      await setDoc(doc(db, name, `${OUTSIDER}_${REC}`), {
        studentUid: OUTSIDER,
        recordingId: REC,
        classId: CLASS_THEIRS,
        completed: true,
        actor: 'student',
      });
    }
  });
});

const ctx = (uid: string, role: string) =>
  testEnv.authenticatedContext(uid, { role, status: 'active' });
const mgrMine = () => ctx(MINE, 'manager');
const mgrTheirs = () => ctx(THEIRS, 'manager');
const admin = () => ctx('admin1', 'admin');
const student = () => ctx(STUDENT, 'student');

describe('Phase 5 staff ledger reads', () => {
  for (const name of LEDGER_COLLECTIONS) {
    describe(name, () => {
      it('a manager lists their own class, scoped', async () => {
        await assertSucceeds(
          getDocs(query(collection(mgrMine().firestore(), name), where('classId', '==', CLASS_MINE))),
        );
      });

      it('an admin lists everything', async () => {
        await assertSucceeds(getDocs(collection(admin().firestore(), name)));
      });

      it('a manager cannot read another class’s row', async () => {
        await assertFails(getDoc(doc(mgrTheirs().firestore(), name, `${STUDENT}_${REC}`)));
      });

      it('a manager cannot list another class', async () => {
        await assertFails(
          getDocs(query(collection(mgrMine().firestore(), name), where('classId', '==', CLASS_THEIRS))),
        );
      });
    });
  }
});

describe('completionOverrides', () => {
  it('a student reads their OWN override (their accountability details)', async () => {
    await assertSucceeds(
      getDoc(doc(student().firestore(), COLLECTIONS.completionOverrides, `${STUDENT}_${REC}`)),
    );
  });

  it("a student cannot read another student's override", async () => {
    await assertFails(
      getDoc(doc(student().firestore(), COLLECTIONS.completionOverrides, `${OUTSIDER}_${REC}`)),
    );
  });

  it('no client may write an override (server-only)', async () => {
    for (const c of [mgrMine(), admin(), student()]) {
      await assertFails(
        setDoc(doc(c.firestore(), COLLECTIONS.completionOverrides, `${STUDENT}_${REC}`), {
          studentUid: STUDENT,
          recordingId: REC,
          classId: CLASS_MINE,
          completed: true,
          reason: 'forged',
          overriddenBy: 'x',
          at: 1,
        }),
      );
    }
  });
});
