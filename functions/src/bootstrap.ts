import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ALLOWED_EMAIL_DOMAIN, COLLECTIONS, isAllowedStaffEmail } from '@sabeel/shared';

/**
 * ONE-SHOT: promotes the first admin, then must be deleted.
 *
 * The bootstrap deadlock: only an admin can approve anyone, and no admin exists
 * after a first deploy. The usual answer — an Admin SDK script — needs gcloud
 * ADC or a service-account key, which a fresh laptop often does not have.
 *
 * This is safe BY CONSTRUCTION rather than by secrecy, which is why it needs no
 * auth and no shared token (a token would have to be transmitted somewhere,
 * making things worse):
 *
 *   1. it can only ever promote ONE hardcoded address, so whoever calls it the
 *      outcome is identical and there is nothing to gain by racing;
 *   2. it REFUSES once any active admin exists, so it cannot be replayed after
 *      someone is demoted;
 *   3. it re-checks the domain rule, so it cannot be used to promote an
 *      outsider even if the constant were edited carelessly.
 *
 * Deploy → call once → delete. The success response says so, so the cleanup step
 * is hard to forget.
 */
const FIRST_ADMIN_EMAIL = `faisal@${ALLOWED_EMAIL_DOMAIN}`;

export const bootstrapAdmin = onRequest(async (_req, res) => {
  const db = getFirestore();

  const existing = await db
    .collection(COLLECTIONS.staffUsers)
    .where('role', '==', 'admin')
    .where('status', '==', 'active')
    .limit(1)
    .get();
  if (!existing.empty) {
    res.status(409).json({ ok: false, reason: 'An admin already exists; this is spent.' });
    return;
  }

  let user;
  try {
    user = await getAuth().getUserByEmail(FIRST_ADMIN_EMAIL);
  } catch {
    res.status(404).json({
      ok: false,
      reason: `${FIRST_ADMIN_EMAIL} has not signed in yet. Sign in with Google first, then call this again.`,
    });
    return;
  }

  if (!isAllowedStaffEmail(user.email, user.emailVerified)) {
    res.status(403).json({ ok: false, reason: 'Not a verified address on the org domain.' });
    return;
  }

  // Claims first: rules trust the token, so a failure between the two leaves a
  // working admin rather than a document claiming access the token does not grant.
  await getAuth().setCustomUserClaims(user.uid, { role: 'admin', status: 'active' });
  await db.collection(COLLECTIONS.staffUsers).doc(user.uid).set(
    {
      role: 'admin',
      status: 'active',
      approvedAt: Date.now(),
      approvedBy: 'bootstrap',
    },
    { merge: true },
  );

  res.json({
    ok: true,
    uid: user.uid,
    email: user.email,
    next: 'DELETE THIS FUNCTION NOW: firebase functions:delete bootstrapAdmin',
  });
});
