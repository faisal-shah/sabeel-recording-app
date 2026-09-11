import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { COLLECTIONS, EMULATOR_PROJECT_ID } from '@sabeel/shared';
import { assertAccountLive, requireAdmin, requireCourseScope, requireStaff } from '../../src/guards';

/**
 * The write side of authorization — which `firestore.rules` cannot cover at all.
 *
 * THE RULES DENY EVERY CLIENT WRITE TO THE STRUCTURAL COLLECTIONS, so the rules
 * suites can only ever prove that. Every staff mutation in this product goes
 * through a callable, and `requireCourseScope` decides "may you touch this
 * class?" for sixteen of them — the only gate on fourteen, and the floor under
 * the two permanent deletions, which add `requireAdmin` on top. It had no test
 * of any kind: deleting the membership check left every suite in the repo green
 * while any manager could act on any class in the institute.
 *
 * A `CallableRequest` here is the two fields the guards read. Building it by
 * hand is the point — the guards must be judged on the TOKEN and on the class
 * document, and on nothing else. Firestore is real (the emulator), because
 * `requireCourseScope` reads `managerUids` fresh and the whole question is
 * whether it does.
 */
beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

const ADMIN = 'admin-uid';
const MINE = 'mgr-mine';
const THEIRS = 'mgr-theirs';
const CLASS = 'class-1';

const req = (uid: string, role: string, status = 'active'): CallableRequest =>
  ({ auth: { uid, token: { role, status } } }) as unknown as CallableRequest;

/** No `auth` at all — an unauthenticated call, which reaches the callable. */
const anonymous = () => ({}) as CallableRequest;

beforeEach(async () => {
  const db = getFirestore();
  await db.collection(COLLECTIONS.courses).doc(CLASS).set({ cohortId: 'c1', managerUids: [MINE] });
});

async function refused(fn: () => unknown | Promise<unknown>, code: string) {
  await expect(Promise.resolve().then(fn)).rejects.toMatchObject({ code });
}

describe('requireStaff', () => {
  it('admits a manager and an admin', () => {
    expect(requireStaff(req(MINE, 'manager'))).toBe(MINE);
    expect(requireStaff(req(ADMIN, 'admin'))).toBe(ADMIN);
  });

  it('refuses a student, an unauthenticated call and a role of nothing', async () => {
    await refused(() => requireStaff(req('stu', 'student')), 'permission-denied');
    await refused(() => requireStaff(anonymous()), 'unauthenticated');
    await refused(() => requireStaff(req('nobody', '')), 'permission-denied');
  });

  /*
   * PENDING AND DISABLED ARE THE POINT OF `requireActive`. A staff account
   * awaiting approval already holds a token saying `role: 'manager'` — the role
   * is set when the account is created and the status is what an admin changes
   * — so a guard that read the role alone would let an unapproved account write.
   */
  it('refuses an account whose status is not active, whatever its role', async () => {
    await refused(() => requireStaff(req(MINE, 'manager', 'pending')), 'permission-denied');
    await refused(() => requireStaff(req(ADMIN, 'admin', 'disabled')), 'permission-denied');
  });
});

describe('requireAdmin', () => {
  it('admits an admin and refuses a manager', async () => {
    expect(requireAdmin(req(ADMIN, 'admin'))).toBe(ADMIN);
    await refused(() => requireAdmin(req(MINE, 'manager')), 'permission-denied');
  });

  it('refuses an admin whose account is not active', async () => {
    await refused(() => requireAdmin(req(ADMIN, 'admin', 'pending')), 'permission-denied');
  });
});

describe('requireCourseScope', () => {
  it('admits the manager the class actually names', async () => {
    await expect(requireCourseScope(req(MINE, 'manager'), CLASS)).resolves.toBe(MINE);
  });

  /*
   * THE ONE THAT MATTERS. Every other check here has a sibling somewhere; this
   * is the only thing standing between a manager and the whole institute.
   */
  it('refuses a manager the class does not name', async () => {
    await refused(() => requireCourseScope(req(THEIRS, 'manager'), CLASS), 'permission-denied');
  });

  it('lets an admin past without consulting the class at all', async () => {
    // Not merely "an admin is allowed": the id is one no document has, so this
    // fails if the admin arm ever starts reading the class first.
    await expect(requireCourseScope(req(ADMIN, 'admin'), 'no-such-class')).resolves.toBe(ADMIN);
  });

  it('refuses a manager against a class that does not exist', async () => {
    await refused(() => requireCourseScope(req(MINE, 'manager'), 'no-such-class'), 'not-found');
  });

  it('refuses a class with no managers at all', async () => {
    await getFirestore().collection(COLLECTIONS.courses).doc(CLASS).set({ cohortId: 'c1' });
    await refused(() => requireCourseScope(req(MINE, 'manager'), CLASS), 'permission-denied');
  });

  /*
   * READ FRESH, NEVER FROM THE TOKEN. Removing a manager from a class has to
   * bite immediately — custom claims only change when a token refreshes, which
   * is up to an hour, and a class list cached in one would keep them writing.
   */
  it('follows the class document, so removing a manager takes effect at once', async () => {
    const staff = req(MINE, 'manager');
    await expect(requireCourseScope(staff, CLASS)).resolves.toBe(MINE);
    await getFirestore()
      .collection(COLLECTIONS.courses)
      .doc(CLASS)
      .update({ managerUids: [THEIRS] });
    await refused(() => requireCourseScope(staff, CLASS), 'permission-denied');
  });

  it('refuses a student and an unauthenticated call before reading anything', async () => {
    await refused(() => requireCourseScope(req('stu', 'student'), CLASS), 'permission-denied');
    await refused(() => requireCourseScope(anonymous(), CLASS), 'unauthenticated');
  });
});

/**
 * THE ACCOUNT, NOT THE TOKEN. A real ID token from the Auth emulator, the way
 * a callable receives one, and the user record changed underneath it: the
 * platform would still accept the token for up to an hour, and this is the
 * check that refuses it the moment the account is disabled or its tokens are
 * revoked.
 */
describe('assertAccountLive', () => {
  const LIVE = 'live-uid';

  async function idTokenFor(uid: string): Promise<string> {
    const custom = await getAuth().createCustomToken(uid);
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const res = await fetch(
      `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: custom, returnSecureToken: true }),
      },
    );
    return ((await res.json()) as { idToken: string }).idToken;
  }
  const withToken = (uid: string, rawToken: string): CallableRequest =>
    ({ auth: { uid, token: { role: 'manager', status: 'active' }, rawToken } }) as unknown as CallableRequest;

  beforeEach(async () => {
    await getAuth().deleteUser(LIVE).catch(() => undefined);
    await getAuth().createUser({ uid: LIVE, email: 'live@oursabeel.com' });
  });

  it('lets a live account through, and an unauthenticated call past to the handler', async () => {
    const token = await idTokenFor(LIVE);
    await expect(assertAccountLive(withToken(LIVE, token))).resolves.toBeUndefined();
    await expect(assertAccountLive(anonymous())).resolves.toBeUndefined();
  });

  it('refuses a token whose account has since been disabled', async () => {
    const token = await idTokenFor(LIVE);
    await getAuth().updateUser(LIVE, { disabled: true });
    await refused(() => assertAccountLive(withToken(LIVE, token)), 'permission-denied');
  });

  it('refuses a token issued before its account\'s tokens were revoked', async () => {
    const token = await idTokenFor(LIVE);
    // Revocation is stamped to the second; a token minted in the same second
    // would read as issued after it.
    await new Promise((r) => setTimeout(r, 1100));
    await getAuth().revokeRefreshTokens(LIVE);
    await refused(() => assertAccountLive(withToken(LIVE, token)), 'permission-denied');
    // A token minted after the revocation is fine again.
    await new Promise((r) => setTimeout(r, 1100));
    await expect(assertAccountLive(withToken(LIVE, await idTokenFor(LIVE)))).resolves.toBeUndefined();
  });
});
