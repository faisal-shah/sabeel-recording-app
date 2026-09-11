import { getAuth } from 'firebase-admin/auth';

/**
 * A REAL ID token from the Auth emulator for a uid, the way a callable receives
 * one — so a hand-built `CallableRequest` carries a `rawToken` that
 * `assertAccountLive` can check against the user record, which every wrapper
 * now does before its handler runs. The user is created if it does not exist;
 * the decoded claims a test puts in `auth.token` are still its own to choose.
 *
 * Minted fresh every time, not cached: suites clear the Auth emulator between
 * tests, and a token remembered from before that clear names a user who no
 * longer exists.
 */
export async function idTokenFor(uid: string): Promise<string> {
  // WITH AN EMAIL AND NO PASSWORD — the shape `onUserCreate` reads as
  // Admin-SDK provisioned and leaves alone. The trigger runs in the emulator
  // too, and a user with no email at all is one it deletes; created that way,
  // the deletion sometimes landed between the mint and the wrapper's check.
  await getAuth()
    .getUser(uid)
    .catch(() => getAuth().createUser({ uid, email: `${uid}@example.com` }));
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
