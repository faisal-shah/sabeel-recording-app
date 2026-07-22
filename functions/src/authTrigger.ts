import './setup';
import * as functionsV1 from 'firebase-functions/v1';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, REGION, type StaffUserDoc } from '@sabeel/shared';
import { decideProvision } from './provision';

/**
 * Server-side account provisioning and domain enforcement, for every new
 * Firebase Auth user. The decision is in `provision.ts`; this performs it.
 *
 * Gen-1 auth trigger: `beforeUserCreated` (a blocking function) would reject
 * before the auth user exists at all, but it requires upgrading the project to
 * Identity Platform. Worth doing if stray sign-ups become a nuisance — the
 * window it would close is not exploitable today, because an account this
 * trigger rejects has no custom claims, and every rule gates on
 * `status == 'active'` defaulting to `''`.
 *
 * Deleting a rejected account rather than marking it `rejected` keeps
 * `staffUsers` meaningful: everything in it is someone who legitimately reached
 * the approval queue, so the admin's list is never padded with junk that has to
 * be mentally filtered.
 */
export const onUserCreate = functionsV1
  .region(REGION)
  .auth.user()
  .onCreate(async (user) => {
    const decision = decideProvision({
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoURL: user.photoURL,
      providerIds: user.providerData.map((p) => p.providerId),
    });

    if (decision.action === 'ignore') {
      // A student, created by the createStudent callable, which sets its own
      // claims and document. Touching it here would race that callable.
      return;
    }

    if (decision.action === 'reject') {
      functionsV1.logger.warn('Rejected sign-up', {
        uid: user.uid,
        email: decision.email,
        reason: decision.reason,
      });
      await getAuth().deleteUser(user.uid);
      return;
    }

    const { claims, profile } = decision;

    // Claims BEFORE the mirror document. The token is what rules trust, so if
    // the second write failed we would have a user who can do nothing (pending
    // grants nothing) rather than one with a document but no claims — which the
    // client would misread as approved-but-broken.
    await getAuth().setCustomUserClaims(user.uid, claims);

    const doc: StaffUserDoc = {
      displayName: profile.displayName,
      email: profile.email,
      photoUrl: profile.photoUrl,
      role: 'manager',
      status: 'pending',
      createdAt: Date.now(),
    };
    await getFirestore().collection(COLLECTIONS.staffUsers).doc(user.uid).set(doc);

    functionsV1.logger.info('Provisioned pending staff account', {
      uid: user.uid,
      email: profile.email,
    });
  });
