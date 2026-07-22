import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import type { TokenClaims } from '@sabeel/shared';

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
