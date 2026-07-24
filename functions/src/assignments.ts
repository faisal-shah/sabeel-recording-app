import { HttpsError } from 'firebase-functions/v2/https';
import { auditedCall } from './audited';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  assignmentId,
  enrollmentId,
  type AssignmentDoc,
  type EnrollmentDoc,
  type RecordingDoc,
} from '@sabeel/shared';
import { requireCourseScope } from './guards';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface CatchupInput {
  studentUid: string;
  recordingId: string;
  /** Staff-chosen deadline, or null for "required, no due date". Absent is
   *  treated as null (the callable client sends undefined as null). */
  dueDate: string | null;
}

export function validateAssignCatchup(data: unknown): CatchupInput {
  const d = data as Partial<CatchupInput> | null;
  if (typeof d?.studentUid !== 'string' || !d.studentUid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }
  if (typeof d.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  let dueDate: string | null = null;
  if (d.dueDate !== undefined && d.dueDate !== null) {
    if (typeof d.dueDate !== 'string' || !DATE_ONLY.test(d.dueDate)) {
      throw new HttpsError('invalid-argument', 'dueDate must be YYYY-MM-DD or null.');
    }
    dueDate = d.dueDate;
  }
  return { studentUid: d.studentUid, recordingId: d.recordingId, dueDate };
}

/**
 * Assign an earlier recording to a late-enrolled student as catch-up.
 *
 * `source: 'catchup'` is load-bearing: it is exactly what protects this
 * assignment's staff-chosen due date from being overwritten when the recording's
 * own due date is later edited (the fan-out only rewrites `publish` rows).
 *
 * The student must be an ACTIVE member of the recording's class — catch-up is a
 * membership-scoped action, and assigning across courses would break the "if a
 * student should not be accountable, do not enrol them" model.
 */
export async function applyCatchup(callerUid: string, input: CatchupInput, courseId: string) {
  const db = getFirestore();

  const enrolSnap = await db
    .collection(COLLECTIONS.enrollments)
    .doc(enrollmentId(input.studentUid, courseId))
    .get();
  const enrol = enrolSnap.data() as EnrollmentDoc | undefined;
  if (!enrol || !enrol.active) {
    throw new HttpsError('failed-precondition', 'That student is not in this class.');
  }

  const doc: AssignmentDoc = {
    studentUid: input.studentUid,
    recordingId: input.recordingId,
    courseId,
    cohortId: enrol.cohortId,
    dueDate: input.dueDate,
    source: 'catchup',
    active: true,
    assignedAt: Date.now(),
    assignedBy: callerUid,
  };
  await db
    .collection(COLLECTIONS.assignments)
    .doc(assignmentId(input.studentUid, input.recordingId))
    .set(doc);
  return { studentUid: input.studentUid, recordingId: input.recordingId };
}

export const assignCatchup = auditedCall('assignCatchup', async (req, audit) => {
  const input = validateAssignCatchup(req.data);
  const recSnap = await getFirestore()
    .collection(COLLECTIONS.recordings)
    .doc(input.recordingId)
    .get();
  if (!recSnap.exists) throw new HttpsError('not-found', 'No such recording.');
  const rec = recSnap.data() as RecordingDoc;
  // Only a published recording can be a catch-up obligation — an unpublished one
  // is not something a student can be answerable for.
  if (rec.status !== 'published') {
    throw new HttpsError('failed-precondition', 'That recording is not published.');
  }
  const uid = await requireCourseScope(req, rec.courseId);
  audit.courseId = rec.courseId;
  audit.detail = { dueDate: input.dueDate };
  return applyCatchup(uid, input, rec.courseId);
});
