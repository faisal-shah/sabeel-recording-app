import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  enrollmentId,
  overrideId,
  type CompletionOverrideDoc,
  type EnrollmentDoc,
  type RecordingDoc,
} from '@sabeel/shared';
import { auditedCall } from './audited';
import { requireClassScope } from './guards';

export interface OverrideInput {
  studentUid: string;
  recordingId: string;
  completed: boolean;
  reason: string;
}

export function validateOverride(data: unknown): OverrideInput {
  const d = data as Partial<OverrideInput> | null;
  if (typeof d?.studentUid !== 'string' || !d.studentUid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }
  if (typeof d.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  if (typeof d.completed !== 'boolean') {
    throw new HttpsError('invalid-argument', 'completed must be a boolean.');
  }
  // The reason is the whole point of an override — the brief permits one ONLY
  // with a recorded reason. An empty/whitespace reason is rejected.
  const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required to override.');
  if (reason.length > 500) throw new HttpsError('invalid-argument', 'That reason is too long.');
  return { studentUid: d.studentUid, recordingId: d.recordingId, completed: d.completed, reason };
}

async function recordingClassId(recordingId: string): Promise<string> {
  const snap = await getFirestore().collection(COLLECTIONS.recordings).doc(recordingId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such recording.');
  return (snap.data() as RecordingDoc).classId;
}

async function requireEnrolled(studentUid: string, classId: string): Promise<void> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.enrollments)
    .doc(enrollmentId(studentUid, classId))
    .get();
  const enrol = snap.data() as EnrollmentDoc | undefined;
  if (!enrol || !enrol.active) {
    throw new HttpsError('failed-precondition', 'That student is not in this class.');
  }
}

/**
 * Write the override doc. SEPARATE from the student's completion, so the student
 * can never clobber it and the ledger reads override ?? student.
 */
export async function applyOverride(callerUid: string, input: OverrideInput, classId: string) {
  const doc: CompletionOverrideDoc = {
    studentUid: input.studentUid,
    recordingId: input.recordingId,
    classId,
    completed: input.completed,
    reason: input.reason,
    overriddenBy: callerUid,
    at: Date.now(),
  };
  await getFirestore()
    .collection(COLLECTIONS.completionOverrides)
    .doc(overrideId(input.studentUid, input.recordingId))
    .set(doc);
  return { studentUid: input.studentUid, recordingId: input.recordingId, completed: input.completed };
}

/** Remove an override — effective status falls back to the student's own. */
export async function clearOverride(studentUid: string, recordingId: string) {
  await getFirestore()
    .collection(COLLECTIONS.completionOverrides)
    .doc(overrideId(studentUid, recordingId))
    .delete();
  return { studentUid, recordingId };
}

/**
 * Staff override of a student's completion, with a required reason. Class-scoped
 * and enrolment-checked; the reason lands in the audit entry's `detail`.
 */
export const overrideCompletion = auditedCall('overrideCompletion', async (req, audit) => {
  const input = validateOverride(req.data);
  const classId = await recordingClassId(input.recordingId);
  const uid = await requireClassScope(req, classId);
  await requireEnrolled(input.studentUid, classId);
  audit.classId = classId;
  audit.detail = { completed: input.completed, reason: input.reason };
  return applyOverride(uid, input, classId);
});

export const clearCompletionOverride = auditedCall('clearCompletionOverride', async (req, audit) => {
  const d = req.data as { studentUid?: unknown; recordingId?: unknown; reason?: unknown };
  if (typeof d?.studentUid !== 'string' || !d.studentUid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }
  if (typeof d.recordingId !== 'string' || !d.recordingId) {
    throw new HttpsError('invalid-argument', 'recordingId is required.');
  }
  const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
  if (!reason) throw new HttpsError('invalid-argument', 'A reason is required.');
  const classId = await recordingClassId(d.recordingId);
  await requireClassScope(req, classId);
  audit.classId = classId;
  audit.detail = { reason };
  return clearOverride(d.studentUid, d.recordingId);
});
