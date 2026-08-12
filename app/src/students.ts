import { collection, doc, orderBy, query } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type StudentDoc, type UserStatus } from '@sabeel/shared';
import { auth, db, functions } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';

export interface StudentRow extends StudentDoc {
  uid: string;
}

/**
 * One student, live. The whole staff directory is readable by any staff member
 * (a deliberate privacy call recorded on the `students` rule), so this needs no
 * scoping — but it is a document listener so the student's own screen could use
 * the same hook, where a list would be denied.
 */
export function useStudent(uid: string | null): StudentRow | null {
  return useLiveDoc<StudentRow | null>(
    () => (uid ? doc(db, COLLECTIONS.students, uid) : null),
    [uid],
    {
      label: 'student',
      map: (snap) => ({ uid: snap.id, ...(snap.data() as StudentDoc) }),
      empty: null,
    },
  );
}

export function useStudents(enabled: boolean): StudentRow[] {
  return useLiveQuery<StudentRow[]>(
    () =>
      enabled
        ? query(collection(db, COLLECTIONS.students), orderBy('displayName', 'asc'))
        : null,
    [enabled],
    {
      label: 'students',
      map: (snap) => snap.docs.map((d) => ({ uid: d.id, ...(d.data() as StudentDoc) })),
      empty: [],
    },
  );
}

/**
 * Create a student and send them a link to set their own password.
 *
 * The account is created server-side with no password at all, then Firebase's
 * own password-reset email carries the set-password link — no email service,
 * no template hosting, nothing to operate. The console template is reworded
 * from "reset" to "set" so it reads correctly for someone who never had a
 * password (TODO.md).
 *
 * If the email fails to send, the account still exists and staff can resend —
 * so the failure is reported rather than rolled back, and the returned flag
 * lets the UI say which of the two things happened.
 */
export async function createStudent(input: {
  displayName: string;
  email: string;
  courseId?: string;
}): Promise<{ uid: string; emailSent: boolean }> {
  const res = await httpsCallable<typeof input, { uid: string; email: string }>(
    functions,
    'createStudent',
  )(input);
  try {
    await sendPasswordResetEmail(auth, res.data.email);
    return { uid: res.data.uid, emailSent: true };
  } catch {
    return { uid: res.data.uid, emailSent: false };
  }
}

/** Resend the set-password link for an existing student. */
export async function resendPasswordSetup(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email);
}

export async function setStudentAccess(input: {
  uid: string;
  status: Extract<UserStatus, 'active' | 'disabled'>;
}): Promise<void> {
  await httpsCallable(functions, 'setStudentAccess')(input);
}
