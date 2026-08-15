import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, EMULATOR_PROJECT_ID } from '@sabeel/shared';

/**
 * `notifications/{uid}` — the first document either population may write.
 *
 * Three owners under one id, and the assertions are about keeping them apart: a
 * person owns their switches and their device tokens, and NOBODY owns the record
 * of what was already sent, because a client that could create one would silence
 * its own notifications.
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

const STUDENT = 'stu1';
const OTHER = 'stu2';
const MANAGER = 'mgr1';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, COLLECTIONS.notifications, STUDENT), { lastDay: false, updatedAt: 1 });
    await setDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'devices', 'tok-a'), {
      token: 'tok-a',
      platform: 'web',
      registeredAt: 1,
    });
    await setDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'sent', 'recordingReady_rec1'), {
      kind: 'recordingReady',
      targetId: 'rec1',
      at: 1,
    });
  });
});

const ctx = (uid: string, role: string) =>
  testEnv.authenticatedContext(uid, { role, status: 'active' });
const student = () => ctx(STUDENT, 'student');
const other = () => ctx(OTHER, 'student');
const manager = () => ctx(MANAGER, 'manager');
const pending = () => testEnv.authenticatedContext(STUDENT, { role: 'student', status: 'pending' });

describe('notification preferences', () => {
  it('lets a person read and change their own switches', async () => {
    const db = student().firestore();
    await assertSucceeds(getDoc(doc(db, COLLECTIONS.notifications, STUDENT)));
    await assertSucceeds(
      updateDoc(doc(db, COLLECTIONS.notifications, STUDENT), { lastDay: true, updatedAt: 2 }),
    );
  });

  it('lets staff do the same — this is the first document they may write', async () => {
    await assertSucceeds(
      setDoc(doc(manager().firestore(), COLLECTIONS.notifications, MANAGER), {
        attendanceMissing: false,
        updatedAt: 1,
      }),
    );
  });

  it('does NOT let anyone touch someone else\'s switches', async () => {
    const db = other().firestore();
    await assertFails(getDoc(doc(db, COLLECTIONS.notifications, STUDENT)));
    await assertFails(
      updateDoc(doc(db, COLLECTIONS.notifications, STUDENT), { lastDay: true, updatedAt: 2 }),
    );
  });

  it('refuses keys outside the switch list, on create and on update', async () => {
    // Without hasOnly this document quietly becomes a place to store anything —
    // client-writable, per-user, and never re-audited.
    const db = student().firestore();
    await assertFails(
      updateDoc(doc(db, COLLECTIONS.notifications, STUDENT), { role: 'admin' }),
    );
    await assertFails(
      setDoc(doc(other().firestore(), COLLECTIONS.notifications, OTHER), {
        lastDay: true,
        somethingElse: 1,
      }),
    );
  });

  it('refuses a gated account, and refuses deletion outright', async () => {
    await assertFails(getDoc(doc(pending().firestore(), COLLECTIONS.notifications, STUDENT)));
    await assertFails(deleteDoc(doc(student().firestore(), COLLECTIONS.notifications, STUDENT)));
  });
});

describe('device tokens', () => {
  it('lets a person register and unregister their own devices', async () => {
    const db = student().firestore();
    await assertSucceeds(
      setDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'devices', 'tok-b'), {
        token: 'tok-b',
        platform: 'android',
        registeredAt: 2,
      }),
    );
    await assertSucceeds(getDocs(collection(db, COLLECTIONS.notifications, STUDENT, 'devices')));
    await assertSucceeds(
      deleteDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'devices', 'tok-a')),
    );
  });

  it('does NOT let anyone read or plant a token on someone else', async () => {
    const db = other().firestore();
    await assertFails(getDocs(collection(db, COLLECTIONS.notifications, STUDENT, 'devices')));
    await assertFails(
      setDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'devices', 'tok-evil'), {
        token: 'tok-evil',
        platform: 'web',
        registeredAt: 2,
      }),
    );
  });

  it('does NOT let a token be edited into another one', async () => {
    await assertFails(
      updateDoc(doc(student().firestore(), COLLECTIONS.notifications, STUDENT, 'devices', 'tok-a'), {
        token: 'tok-c',
      }),
    );
  });
});

describe('sent records', () => {
  it('are server-only in both directions', async () => {
    const db = student().firestore();
    // Reading teaches nothing the app asks; CREATING would let a student
    // pre-claim their own notifications and never hear from the app again.
    await assertFails(
      getDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'sent', 'recordingReady_rec1')),
    );
    await assertFails(
      setDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'sent', 'recordingReady_rec2'), {
        kind: 'recordingReady',
        targetId: 'rec2',
        at: 2,
      }),
    );
    await assertFails(
      deleteDoc(doc(db, COLLECTIONS.notifications, STUDENT, 'sent', 'recordingReady_rec1')),
    );
  });
});
