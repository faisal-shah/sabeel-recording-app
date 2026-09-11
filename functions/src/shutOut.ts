import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@sabeel/shared';

/**
 * Switch off everything that still reaches a disabled account.
 *
 * `status: 'disabled'` on the mirror and the claim is what the app and the
 * rules read; three things outlive it. The Auth user, which is what a sign-in
 * checks. The refresh tokens already out there — every callable re-checks the
 * account (`assertAccountLive`), and revocation is what makes a token issued
 * before this moment fail that check as well as the disabled flag. And the
 * device registrations under `notifications/{uid}/devices`: perfectly valid
 * FCM tokens, so a sweep that found them kept sending "last day to listen"
 * for audio the person could no longer open, to a phone that may no longer be
 * theirs to hold. A disabled account cannot stay signed in, and signing in
 * again re-registers the device (`session.ts`), so an account re-enabled loses
 * nothing by this. The preferences document stays: the switches are theirs.
 *
 * One function for both populations, so both keep the manual's one promise
 * for disabling — "switch off access while keeping their history".
 */
export async function shutOutAccount(uid: string): Promise<void> {
  await getAuth().updateUser(uid, { disabled: true });
  await getAuth().revokeRefreshTokens(uid);
  const devices = await getFirestore()
    .collection(COLLECTIONS.notifications)
    .doc(uid)
    .collection('devices')
    .get();
  await Promise.all(devices.docs.map((d) => d.ref.delete()));
}
