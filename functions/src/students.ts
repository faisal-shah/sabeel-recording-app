import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  NEW_STUDENT_ACCESS,
  type StudentDoc,
  type UserStatus,
} from '@sabeel/shared';
import { requireAdmin, requireStaff } from './guards';

export interface CreateStudentInput {
  displayName: string;
  email: string;
}

export function validateCreateStudent(data: unknown): CreateStudentInput {
  const d = data as Partial<CreateStudentInput> | null;
  const displayName = typeof d?.displayName === 'string' ? d.displayName.trim() : '';
  const email = typeof d?.email === 'string' ? d.email.trim().toLowerCase() : '';
  if (!displayName) throw new HttpsError('invalid-argument', 'Full name is required.');
  // Deliberately loose: Firebase Auth is the real validator and rejects a
  // malformed address on creation. Duplicating its rules here would only add a
  // second, subtly different definition of "valid email".
  if (!email.includes('@')) throw new HttpsError('invalid-argument', 'A valid email is required.');
  return { displayName, email };
}

/**
 * Creates a student account: Auth user, claims, and the mirror document.
 *
 * Students arrive ACTIVE — staff creating them is the approval. There is no
 * pending state and no separate email verification: the address was asserted by
 * staff, and completing the set-password link is itself proof of mailbox
 * control.
 *
 * The auth-create trigger deliberately ignores password accounts (see
 * provision.ts) so it cannot race this function.
 */
export async function createStudentAccount(callerUid: string, input: CreateStudentInput) {
  const auth = getAuth();
  const db = getFirestore();

  let user;
  try {
    user = await auth.createUser({
      email: input.email,
      displayName: input.displayName,
      // No password: the student sets their own from the emailed link. Inventing
      // a temporary one would mean a working credential nobody intended to exist.
      emailVerified: false,
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'That email already has an account.');
    }
    if (code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'That email address is not valid.');
    }
    throw e;
  }

  // Claims before the document, for the same reason as the auth trigger: rules
  // trust the token, so a half-completed create leaves an account that can do
  // nothing rather than one that looks authorised but is not.
  await auth.setCustomUserClaims(user.uid, { ...NEW_STUDENT_ACCESS });

  const doc: StudentDoc = {
    displayName: input.displayName,
    email: input.email,
    role: 'student',
    status: 'active',
    createdAt: Date.now(),
    createdBy: callerUid,
  };
  await db.collection(COLLECTIONS.students).doc(user.uid).set(doc);

  return { uid: user.uid, email: input.email };
}

export const createStudent = onCall(async (req) => {
  const callerUid = requireStaff(req);
  return createStudentAccount(callerUid, validateCreateStudent(req.data));
});

export interface StudentAccessInput {
  uid: string;
  status: Extract<UserStatus, 'active' | 'disabled'>;
}

export function validateStudentAccess(data: unknown): StudentAccessInput {
  const d = data as Partial<StudentAccessInput> | null;
  if (!d || typeof d.uid !== 'string' || !d.uid) {
    throw new HttpsError('invalid-argument', 'uid is required.');
  }
  if (d.status !== 'active' && d.status !== 'disabled') {
    throw new HttpsError('invalid-argument', 'status must be active or disabled.');
  }
  return { uid: d.uid, status: d.status };
}

/**
 * Enable or disable a student.
 *
 * Disabling preserves all history, enrollments and ledger entries — the brief is
 * explicit that normal operations never delete. It also disables the Auth user,
 * so an already-signed-in session cannot simply keep working off a cached token.
 */
export async function applyStudentAccess(input: StudentAccessInput) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.students).doc(input.uid);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'No such student.');

  await getAuth().updateUser(input.uid, { disabled: input.status === 'disabled' });
  await getAuth().setCustomUserClaims(input.uid, { role: 'student', status: input.status });
  await ref.update({ status: input.status });
  return { uid: input.uid, status: input.status };
}

export const setStudentAccess = onCall(async (req) => {
  requireAdmin(req);
  return applyStudentAccess(validateStudentAccess(req.data));
});
