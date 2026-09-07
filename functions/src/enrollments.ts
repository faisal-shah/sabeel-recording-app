import { HttpsError } from 'firebase-functions/v2/https';
import { auditedCall } from './audited';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  enrollmentId,
  type CourseDoc,
  type EnrollmentDoc,
  type StudentDoc,
} from '@sabeel/shared';
import { requireCourseScope } from './guards';
import { deactivateStudentAssignmentsInCourse } from './assignmentsFanout';

export interface EnrollmentInput {
  studentUid: string;
  courseId: string;
}

export function validateEnrollment(data: unknown): EnrollmentInput {
  const d = data as { studentUid?: unknown; courseId?: unknown } | null;
  if (typeof d?.studentUid !== 'string' || !d.studentUid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }
  if (typeof d.courseId !== 'string' || !d.courseId) {
    throw new HttpsError('invalid-argument', 'courseId is required.');
  }
  return { studentUid: d.studentUid, courseId: d.courseId };
}

/**
 * Enrol a student into a course, or reactivate a previous enrolment.
 *
 * The document id is `${studentUid}_${courseId}`, so re-enrolling is a `set`
 * over the SAME document rather than a second row — which keeps the listening
 * history attached to one enrolment record over time.
 *
 * No obligations are created here: accountability is attendance-driven and
 * starts from enrollment onward. A newly enrolled student simply appears in the
 * roster the teacher marks at the NEXT session; nothing retroactive is assigned.
 */
export async function createEnrollmentRecord(callerUid: string, input: EnrollmentInput) {
  const db = getFirestore();

  const [courseSnap, studentSnap] = await Promise.all([
    db.collection(COLLECTIONS.courses).doc(input.courseId).get(),
    db.collection(COLLECTIONS.students).doc(input.studentUid).get(),
  ]);
  if (!courseSnap.exists) throw new HttpsError('not-found', 'No such course.');
  if (!studentSnap.exists) throw new HttpsError('not-found', 'No such student.');
  if ((studentSnap.data() as StudentDoc).status === 'disabled') {
    throw new HttpsError('failed-precondition', 'That student account is disabled.');
  }

  const id = enrollmentId(input.studentUid, input.courseId);
  const ref = db.collection(COLLECTIONS.enrollments).doc(id);
  const existing = await ref.get();

  if (existing.exists && (existing.data() as EnrollmentDoc).active) {
    throw new HttpsError('already-exists', 'That student is already in this course.');
  }

  const doc: EnrollmentDoc = {
    studentUid: input.studentUid,
    courseId: input.courseId,
    cohortId: (courseSnap.data() as CourseDoc).cohortId,
    active: true,
    // Preserve the original enrolment date across a re-enrolment.
    enrolledAt: existing.exists ? (existing.data() as EnrollmentDoc).enrolledAt : Date.now(),
    enrolledBy: callerUid,
  };
  await ref.set(doc);
  return { id, ...doc };
}

export const createEnrollment = auditedCall('createEnrollment', async (req, audit) => {
  const input = validateEnrollment(req.data);
  const uid = await requireCourseScope(req, input.courseId);
  audit.courseId = input.courseId;
  return createEnrollmentRecord(uid, input);
});

export interface SetEnrollmentActiveInput extends EnrollmentInput {
  active: boolean;
}

export function validateSetEnrollmentActive(data: unknown): SetEnrollmentActiveInput {
  const base = validateEnrollment(data);
  const active = (data as { active?: unknown }).active;
  if (typeof active !== 'boolean') {
    throw new HttpsError('invalid-argument', 'active must be a boolean.');
  }
  return { ...base, active };
}

/**
 * Unenrol (or re-enrol) without deleting anything.
 *
 * `active: false` is what removal means here — the row, and everything hanging
 * off it, stays for the accountability record. Unenrolling turns this student's
 * obligations in the course off (history kept).
 *
 * AND THE FAN-OUT KEEPS THEM OFF: `reconcileSessionAssignments` filters its
 * target set by active enrolment, so a later edit to any session in the course
 * cannot switch them back on. Without that filter it did — the attendance
 * snapshot keeps a student's mark for ever, and the reconcile rebuilt the grants
 * from it alone.
 *
 * RE-ENROLLING restores them, the next time anything reconciles that session —
 * which is what the manual and the recording ledger both promise staff on
 * screen ("re-enrolling them or republishing restores it"). An earlier note here
 * claimed the opposite ("accountability starts fresh from the next session
 * marked"); it was the odd one out, and the reconcile being stateless means the
 * ledger's version is what the code has always done. `TODO.md` asks Faisal to
 * confirm the policy rather than leaving three statements to drift again.
 */
export async function applyEnrollmentActive(input: SetEnrollmentActiveInput) {
  const db = getFirestore();
  const ref = db
    .collection(COLLECTIONS.enrollments)
    .doc(enrollmentId(input.studentUid, input.courseId));
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'No such enrolment.');

  const update: Record<string, unknown> = { active: input.active };
  if (!input.active) update.unenrolledAt = Date.now();
  await ref.update(update);

  if (!input.active) {
    await deactivateStudentAssignmentsInCourse(db, input.courseId, input.studentUid);
  }
  return { studentUid: input.studentUid, courseId: input.courseId, active: input.active };
}

export const setEnrollmentActive = auditedCall('setEnrollmentActive', async (req, audit) => {
  const input = validateSetEnrollmentActive(req.data);
  await requireCourseScope(req, input.courseId);
  audit.courseId = input.courseId;
  return applyEnrollmentActive(input);
});
