import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { COLLECTIONS, EMULATOR_PROJECT_ID, enrollmentId } from '@sabeel/shared';

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
const COURSE_MINE = 'courseMine';
const COURSE_THEIRS = 'courseTheirs';
const SESS_MINE = 'sessMine';
const SESS_THEIRS = 'sessTheirs';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const course = (id: string, managerUids: string[]) =>
      setDoc(doc(db, COLLECTIONS.courses, id), {
        cohortId: 'c1',
        name: id,
        archived: false,
        effectiveActive: true,
        archivedAccess: false,
        managerUids,
        createdAt: 1,
        createdBy: ADMIN,
      });
    const session = (id: string, courseId: string) =>
      setDoc(doc(db, COLLECTIONS.sessions, id), {
        courseId,
        cohortId: 'c1',
        date: '2026-07-06',
        title: id,
        dueDate: null,
        notes: '',
        recordingId: null,
        // The whole roster's attendance — the thing students must never see.
        attendance: { [STUDENT]: 'absent' },
        attendanceSubmittedAt: 1,
        archived: false,
        createdAt: 1,
        createdBy: ADMIN,
        updatedAt: 1,
      });
    await Promise.all([
      course(COURSE_MINE, [MINE]),
      course(COURSE_THEIRS, [THEIRS]),
      session(SESS_MINE, COURSE_MINE),
      session(SESS_THEIRS, COURSE_THEIRS),
      // A student enrolled in the course — still must NOT read the session.
      setDoc(doc(db, COLLECTIONS.enrollments, enrollmentId(STUDENT, COURSE_MINE)), {
        studentUid: STUDENT,
        courseId: COURSE_MINE,
        cohortId: 'c1',
        active: true,
        enrolledAt: 1,
        enrolledBy: ADMIN,
      }),
    ]);
  });
});

const ctx = (uid: string, role: string) =>
  testEnv.authenticatedContext(uid, { role, status: 'active' });
const admin = () => ctx(ADMIN, 'admin');
const mine = () => ctx(MINE, 'manager');
const student = () => ctx(STUDENT, 'student');

describe('sessions rules', () => {
  it('lets an admin read any session', async () => {
    await assertSucceeds(getDocs(collection(admin().firestore(), COLLECTIONS.sessions)));
  });

  it('lets a scoped manager query their own course sessions', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(mine().firestore(), COLLECTIONS.sessions),
          where('courseId', '==', COURSE_MINE),
        ),
      ),
    );
  });

  it('does NOT let a manager read another course session', async () => {
    await assertFails(getDoc(doc(mine().firestore(), COLLECTIONS.sessions, SESS_THEIRS)));
  });

  it('does NOT let an enrolled student read a session (attendance is private)', async () => {
    await assertFails(getDoc(doc(student().firestore(), COLLECTIONS.sessions, SESS_MINE)));
    await assertFails(getDocs(collection(student().firestore(), COLLECTIONS.sessions)));
  });

  it('denies every client write (sessions are callable-only)', async () => {
    await assertFails(
      setDoc(doc(mine().firestore(), COLLECTIONS.sessions, 'x'), {
        courseId: COURSE_MINE,
        attendanceSubmittedAt: 1,
      }),
    );
    await assertFails(
      setDoc(doc(admin().firestore(), COLLECTIONS.sessions, SESS_MINE), { title: 'hacked' }),
    );
  });
});
