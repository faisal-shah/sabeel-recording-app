import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type TokenClaims } from '@sabeel/shared';

/**
 * Callable authorisation, read from the TOKEN — never from a user document.
 * The mirror documents exist for UI; a stale or tampered one must not grant
 * anything.
 */

function claims(req: CallableRequest): TokenClaims {
  return (req.auth?.token ?? {}) as TokenClaims;
}

function requireAuth(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  return req.auth.uid;
}

/** Signed in AND approved. Pending and disabled accounts get nothing. */
function requireActive(req: CallableRequest): string {
  const uid = requireAuth(req);
  if (claims(req).status !== 'active') {
    throw new HttpsError('permission-denied', 'Account is not active.');
  }
  return uid;
}

/** Any active staff member: manager or admin. */
export function requireStaff(req: CallableRequest): string {
  const uid = requireActive(req);
  const role = claims(req).role;
  if (role !== 'manager' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'Staff role required.');
  }
  return uid;
}

/** Admins alone approve staff, assign roles, and configure the platform. */
export function requireAdmin(req: CallableRequest): string {
  const uid = requireActive(req);
  if (claims(req).role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin required.');
  }
  return uid;
}

/**
 * Staff authorization for one class: an admin, or a manager assigned to it.
 *
 * Server-side, and deliberately not expressible in security rules — rules gate
 * *reads*, but every write in this app goes through a callable, so this is where
 * "may you touch this class's roster?" is actually decided. Reads the class
 * fresh rather than trusting anything the caller sent.
 */
export async function requireClassScope(
  req: CallableRequest,
  classId: string,
): Promise<string> {
  const uid = requireStaff(req);
  if (claims(req).role === 'admin') return uid;

  const snap = await getFirestore().collection(COLLECTIONS.classes).doc(classId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such class.');

  const managerUids = (snap.data() as { managerUids?: string[] }).managerUids ?? [];
  if (!managerUids.includes(uid)) {
    throw new HttpsError('permission-denied', 'You are not assigned to that class.');
  }
  return uid;
}
