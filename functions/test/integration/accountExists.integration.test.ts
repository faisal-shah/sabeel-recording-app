import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';
import { checkAccountExists } from '../../src/accountExists';

/**
 * The gate that keeps this app off the hook for in-app account deletion.
 *
 * WHAT IS BEING ASSERTED IS AN ABSENCE. The claim made to both stores is not
 * "the app shows no sign-up screen" — it is that no account comes into existence
 * from the app, ever. So the assertion that matters in every case below is the
 * user COUNT afterwards, not the boolean returned: a version of this that
 * answered `exists: false` while quietly minting an Auth record would pass a
 * test on the return value and fail the only promise anybody cares about.
 *
 * Before this gate, a stranger's Google sign-in created a record and relied on
 * the auth trigger to delete it again. That is account creation followed by
 * cleanup, which is not what the exemption asks for.
 *
 * The emulator branch of `verifiedEmail` takes a JSON payload where a real
 * Google ID token would go — the Auth emulator's own dialect, the same one
 * `devSignIn.ts` speaks — because nothing here can mint a Google-signed token.
 */

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

/** A stand-in for a Google ID token, in the shape the emulator branch reads. */
const token = (email: string, verified = true) =>
  JSON.stringify({ email, email_verified: verified });

async function userCount(): Promise<number> {
  return (await getAuth().listUsers()).users.length;
}

async function clearUsers() {
  const users = await getAuth().listUsers();
  await Promise.all(users.users.map((u) => getAuth().deleteUser(u.uid)));
}

beforeEach(clearUsers);

describe('accountExists', () => {
  it('says no for an address with no account, and creates nothing', async () => {
    expect(await checkAccountExists(token('stranger@gmail.com'))).toEqual({ exists: false });
    expect(await userCount()).toBe(0);
  });

  it('says no for a colleague who has never signed in on the web', async () => {
    // The realistic refusal: a real Workspace address, on the allowed domain,
    // whose account simply does not exist yet. The domain is not what is being
    // asked about — existence is — so this must be refused exactly like any
    // other stranger, and must not be pre-provisioned as a convenience.
    expect(await checkAccountExists(token('newteacher@oursabeel.com'))).toEqual({
      exists: false,
    });
    expect(await userCount()).toBe(0);
  });

  it('says yes for staff who already have an account', async () => {
    await getAuth().createUser({ uid: 'staff-1', email: 'teacher@oursabeel.com' });
    expect(await checkAccountExists(token('teacher@oursabeel.com'))).toEqual({ exists: true });
    expect(await userCount()).toBe(1);
  });

  it('says yes for a student account too', async () => {
    // Both populations live in the same Auth project, and the question is about
    // an identity rather than a role.
    await getAuth().createUser({ uid: 'stu-1', email: 'student@example.com' });
    expect(await checkAccountExists(token('student@example.com'))).toEqual({ exists: true });
    expect(await userCount()).toBe(1);
  });

  it('refuses an unverified address, even when an account has that email', async () => {
    // An unverified address proves nothing about who is holding the token, so
    // matching it against a real account would hand that account to whoever
    // claimed the address.
    await getAuth().createUser({ uid: 'staff-2', email: 'teacher@oursabeel.com' });
    expect(await checkAccountExists(token('teacher@oursabeel.com', false))).toEqual({
      exists: false,
    });
    expect(await userCount()).toBe(1);
  });

  it('rejects an unreadable token rather than answering about it', async () => {
    await expect(checkAccountExists('not-a-token')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(await userCount()).toBe(0);
  });

  it('rejects a missing or empty token', async () => {
    await expect(checkAccountExists(undefined)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(checkAccountExists('')).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(await userCount()).toBe(0);
  });
});
