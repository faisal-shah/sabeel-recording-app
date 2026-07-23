import { HttpsError } from 'firebase-functions/v2/https';
import { auditedCall } from './audited';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Role, type UserStatus } from '@sabeel/shared';
import { requireAdmin } from './guards';

export interface StaffAccessInput {
  uid: string;
  status?: Extract<UserStatus, 'active' | 'disabled'>;
  role?: Extract<Role, 'admin' | 'manager'>;
}

export function validateStaffAccess(data: unknown): StaffAccessInput {
  const d = data as Partial<StaffAccessInput> | null;
  if (!d || typeof d.uid !== 'string' || d.uid.length === 0) {
    throw new HttpsError('invalid-argument', 'uid is required.');
  }
  if (d.status !== undefined && d.status !== 'active' && d.status !== 'disabled') {
    throw new HttpsError('invalid-argument', 'status must be active or disabled.');
  }
  if (d.role !== undefined && d.role !== 'admin' && d.role !== 'manager') {
    throw new HttpsError('invalid-argument', 'role must be admin or manager.');
  }
  if (d.status === undefined && d.role === undefined) {
    throw new HttpsError('invalid-argument', 'Nothing to change.');
  }
  return { uid: d.uid, status: d.status, role: d.role };
}

/**
 * Core of setStaffAccess, callable-independent so integration tests can drive it
 * directly against the emulators.
 *
 * Merges the requested changes into the staff document and mirrors
 * { role, status } into custom claims. The document is for UI; the claims are
 * what security rules trust.
 */
export async function applyStaffAccess(callerUid: string, input: StaffAccessInput) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.staffUsers).doc(input.uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such staff member.');

  const current = snap.data() as { role: Role; status: UserStatus };

  // An admin may not demote or disable themselves. Without this the last admin
  // can lock the institute out of its own user management, with no way back in
  // that does not involve redeploying a bootstrap function.
  if (input.uid === callerUid && (input.role === 'manager' || input.status === 'disabled')) {
    throw new HttpsError('failed-precondition', 'You cannot demote or disable yourself.');
  }

  const next = {
    role: (input.role ?? current.role) as Extract<Role, 'admin' | 'manager'>,
    status: input.status ?? current.status,
  };

  await getAuth().setCustomUserClaims(input.uid, next);

  const update: Record<string, unknown> = { ...next };
  if (current.status === 'pending' && next.status === 'active') {
    update.approvedAt = Date.now();
    update.approvedBy = callerUid;
  }
  await ref.update(update);

  return next;
}

/** Only admins approve staff, change roles, or disable accounts. */
// Staff access changes are platform-level (not class-scoped) → admin-only audit.
export const setStaffAccess = auditedCall('setStaffAccess', async (req, audit) => {
  const callerUid = requireAdmin(req);
  const input = validateStaffAccess(req.data);
  audit.detail = { role: input.role, status: input.status };
  return applyStaffAccess(callerUid, input);
});
