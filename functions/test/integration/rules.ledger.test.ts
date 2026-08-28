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

const MINE = 'mgrMine';
const THEIRS = 'mgrTheirs';
const STUDENT = 'stu1';
const OUTSIDER = 'stu2';
const CLASS_MINE = 'classMine';
const CLASS_THEIRS = 'classTheirs';
const REC = 'rec1';

// Every ledger-read collection shares the same shape: a `courseId` and a
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
    await setDoc(doc(db, COLLECTIONS.courses, CLASS_MINE), { cohortId: 'c1', managerUids: [MINE] });
    await setDoc(doc(db, COLLECTIONS.courses, CLASS_THEIRS), { cohortId: 'c1', managerUids: [THEIRS] });
    for (const name of LEDGER_COLLECTIONS) {
      await setDoc(doc(db, name, `${STUDENT}_${REC}`), {
        studentUid: STUDENT,
        recordingId: REC,
        courseId: CLASS_MINE,
        completed: true,
        actor: 'student',
      });
      await setDoc(doc(db, name, `${OUTSIDER}_${REC}`), {
        studentUid: OUTSIDER,
        recordingId: REC,
        courseId: CLASS_THEIRS,
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
          getDocs(query(collection(mgrMine().firestore(), name), where('courseId', '==', CLASS_MINE))),
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
          getDocs(query(collection(mgrMine().firestore(), name), where('courseId', '==', CLASS_THEIRS))),
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
          courseId: CLASS_MINE,
          completed: true,
          reason: 'forged',
          overriddenBy: 'x',
          at: 1,
        }),
      );
    }
  });
});
