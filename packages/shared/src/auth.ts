/** The Workspace domain staff sign in from. */
export const ALLOWED_EMAIL_DOMAIN = 'oursabeel.com';

/**
 * Roles, in one claim.
 *
 * `admin` and `manager` are staff; `student` is a learner. Deliberately a single
 * string rather than the sibling time-tracker's role + separate `admin` boolean:
 * nobody here is a manager *and* separately an admin, so one field cannot get
 * into an inconsistent pair.
 */
export type Role = 'admin' | 'manager' | 'student';

export type UserStatus = 'pending' | 'active' | 'disabled';

/**
 * What security rules trust. Mirrored onto the user document for UI, but the
 * TOKEN is the authority — a stale or tampered mirror must never grant anything.
 */
export interface TokenClaims {
  role?: Role;
  status?: UserStatus;
}

/** Staff arriving via Google land here: signed in, permitted nothing. */
export const NEW_STAFF_ACCESS: { role: Role; status: UserStatus } = {
  role: 'manager',
  status: 'pending',
};

/**
 * Students are created by staff, so they arrive already approved — the approval
 * decision was the act of creating them.
 */
export const NEW_STUDENT_ACCESS: { role: Role; status: UserStatus } = {
  role: 'student',
  status: 'active',
};

/**
 * The staff domain gate.
 *
 * This must hold entirely on its own. The client `hd` parameter only filters the
 * Google account chooser and is trivially bypassed, and the OAuth consent screen
 * cannot be relied on either — "Internal" requires the project to belong to a
 * Cloud organization, which a personally-created project does not.
 *
 * `emailVerified` matters: an unverified address proves nothing about who owns
 * it, and Google will happily hand over an account with one.
 */
export function isAllowedStaffEmail(
  email: string | undefined | null,
  emailVerified: boolean,
): boolean {
  if (!email || !emailVerified) return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  return email.slice(at + 1).toLowerCase().trim() === ALLOWED_EMAIL_DOMAIN;
}

export function isStaffRole(role: Role | undefined): boolean {
  return role === 'admin' || role === 'manager';
}
