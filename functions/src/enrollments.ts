import { HttpsError } from 'firebase-functions/v2/https';
import { auditedCall } from './audited';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  INSTITUTE_TIMEZONE,
  enrollmentId,
  todayInZone,
  type ClassDoc,
  type EnrollmentDoc,
  type StudentDoc,
} from '@sabeel/shared';
import { requireClassScope } from './guards';
import {
  assignPublishedRecordingsToStudent,
  deactivateStudentAssignmentsInClass,
} from './assignmentsFanout';

export interface EnrollmentInput {
  studentUid: string;
  classId: string;
}

export function validateEnrollment(data: unknown): EnrollmentInput {
  const d = data as { studentUid?: unknown; classId?: unknown } | null;
  if (typeof d?.studentUid !== 'string' || !d.studentUid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }
  if (typeof d.classId !== 'string' || !d.classId) {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }
  return { studentUid: d.studentUid, classId: d.classId };
}

/**
 * Enrol a student into a class, or reactivate a previous enrolment.
 *
 * The document id is `${studentUid}_${classId}`, so re-enrolling is a `set`
 * with merge over the SAME document rather than a second row — which is what
 * keeps the listening history attached to one enrolment record over time.
 */
export async function createEnrollmentRecord(callerUid: string, input: EnrollmentInput) {
  const db = getFirestore();

  const [classSnap, studentSnap] = await Promise.all([
    db.collection(COLLECTIONS.classes).doc(input.classId).get(),
    db.collection(COLLECTIONS.students).doc(input.studentUid).get(),
  ]);
  if (!classSnap.exists) throw new HttpsError('not-found', 'No such class.');
  if (!studentSnap.exists) throw new HttpsError('not-found', 'No such student.');
  if ((studentSnap.data() as StudentDoc).status === 'disabled') {
    throw new HttpsError('failed-precondition', 'That student account is disabled.');
  }

  const id = enrollmentId(input.studentUid, input.classId);
  const ref = db.collection(COLLECTIONS.enrollments).doc(id);
  const existing = await ref.get();

  if (existing.exists && (existing.data() as EnrollmentDoc).active) {
    throw new HttpsError('already-exists', 'That student is already in this class.');
  }

  const doc: EnrollmentDoc = {
    studentUid: input.studentUid,
    classId: input.classId,
    cohortId: (classSnap.data() as ClassDoc).cohortId,
    active: true,
    // Preserve the original enrolment date across a re-enrolment.
    enrolledAt: existing.exists
      ? (existing.data() as EnrollmentDoc).enrolledAt
      : Date.now(),
    enrolledBy: callerUid,
  };
  await ref.set(doc);

  // Late-enrollment default (brief § Late enrollment): a newly enrolled or
  // re-enrolled student becomes accountable for the class's published recordings
  // whose due date has NOT passed. Earlier ones are catch-up, done explicitly.
  await assignPublishedRecordingsToStudent(
    db,
    input.classId,
    input.studentUid,
    todayInZone(INSTITUTE_TIMEZONE),
    callerUid,
  );
  return { id, ...doc };
}

export const createEnrollment = auditedCall('createEnrollment', async (req, audit) => {
  const input = validateEnrollment(req.data);
  const uid = await requireClassScope(req, input.classId);
  audit.classId = input.classId;
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
 * off it, stays for the accountability record.
 */
export async function applyEnrollmentActive(input: SetEnrollmentActiveInput) {
  const db = getFirestore();
  const ref = db
    .collection(COLLECTIONS.enrollments)
    .doc(enrollmentId(input.studentUid, input.classId));
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'No such enrolment.');

  const update: Record<string, unknown> = { active: input.active };
  if (!input.active) update.unenrolledAt = Date.now();
  await ref.update(update);

  // Accountability follows membership: unenrolling turns this student's
  // obligations in the class off (history kept); re-enrolling re-applies the
  // late-enrollment default.
  if (input.active) {
    await assignPublishedRecordingsToStudent(
      db,
      input.classId,
      input.studentUid,
      todayInZone(INSTITUTE_TIMEZONE),
      'system',
    );
  } else {
    await deactivateStudentAssignmentsInClass(db, input.classId, input.studentUid);
  }
  return { studentUid: input.studentUid, classId: input.classId, active: input.active };
}

export const setEnrollmentActive = auditedCall('setEnrollmentActive', async (req, audit) => {
  const input = validateSetEnrollmentActive(req.data);
  await requireClassScope(req, input.classId);
  audit.classId = input.classId;
  return applyEnrollmentActive(input);
});
