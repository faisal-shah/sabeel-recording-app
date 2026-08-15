import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  INSTITUTE_TIMEZONE,
  todayInZone,
  type AttendanceStatus,
  type CourseDoc,
  type EnrollmentDoc,
  type SessionDoc,
} from '@sabeel/shared';
import { auditedCall } from './audited';
import { requireCourseScope } from './guards';
import { applyDeleteRecording } from './recordings';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ATTENDANCE: AttendanceStatus[] = ['present', 'absent', 'excused'];

/**
 * A session's due date is the day the excused lose access, so it is required and
 * can never be WRITTEN in the past. It may only BECOME past by the passage of
 * time — which is how a recording closes — but nothing may create a deadline
 * that has already gone, because that is an obligation born unfulfillable.
 *
 * `today` is a parameter rather than a hidden `Date.now()` so the validators
 * stay pure and testable at the day boundary, same discipline as `@sabeel/shared`.
 */
function validateDueDate(value: unknown, today: string): string {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    throw new HttpsError('invalid-argument', 'A due date is required, as YYYY-MM-DD.');
  }
  if (value < today) {
    throw new HttpsError('invalid-argument', 'A due date cannot be in the past.');
  }
  return value;
}

// ---------------------------------------------------------------- create --

export interface CreateSessionInput {
  courseId: string;
  date: string;
  title: string;
  dueDate: string;
  notes: string;
}

export function validateCreateSession(
  data: unknown,
  today: string = todayInZone(INSTITUTE_TIMEZONE),
): CreateSessionInput {
  const d = data as Partial<CreateSessionInput> | null;
  if (typeof d?.courseId !== 'string' || !d.courseId) {
    throw new HttpsError('invalid-argument', 'courseId is required.');
  }
  if (typeof d.date !== 'string' || !DATE_ONLY.test(d.date)) {
    throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD.');
  }
  const title = typeof d.title === 'string' ? d.title.trim() : '';
  if (!title) throw new HttpsError('invalid-argument', 'A title is required.');
  if (title.length > 200) throw new HttpsError('invalid-argument', 'That title is too long.');
  const dueDate = validateDueDate(d.dueDate, today);
  const notes = typeof d.notes === 'string' ? d.notes : '';
  return { courseId: d.courseId, date: d.date, title, dueDate, notes };
}

export async function createSessionRecord(callerUid: string, input: CreateSessionInput) {
  const db = getFirestore();
  const courseSnap = await db.collection(COLLECTIONS.courses).doc(input.courseId).get();
  if (!courseSnap.exists) throw new HttpsError('not-found', 'No such course.');
  const doc: SessionDoc = {
    courseId: input.courseId,
    cohortId: (courseSnap.data() as CourseDoc).cohortId,
    date: input.date,
    title: input.title,
    dueDate: input.dueDate,
    notes: input.notes,
    recordingId: null,
    attendance: {},
    attendanceSubmittedAt: null,
    archived: false,
    createdAt: Date.now(),
    createdBy: callerUid,
    updatedAt: Date.now(),
  };
  const ref = await db.collection(COLLECTIONS.sessions).add(doc);
  return { id: ref.id };
}

export const createSession = auditedCall('createSession', async (req, audit) => {
  const input = validateCreateSession(req.data);
  const uid = await requireCourseScope(req, input.courseId);
  audit.courseId = input.courseId;
  const res = await createSessionRecord(uid, input);
  audit.targets = { sessionId: res.id };
  return res;
});

// ---------------------------------------------------------------- update --

export interface UpdateSessionInput {
  sessionId: string;
  date?: string;
  title?: string;
  dueDate?: string;
  notes?: string;
}

export function validateUpdateSession(
  data: unknown,
  today: string = todayInZone(INSTITUTE_TIMEZONE),
): UpdateSessionInput {
  const d = data as Partial<UpdateSessionInput> | null;
  if (typeof d?.sessionId !== 'string' || !d.sessionId) {
    throw new HttpsError('invalid-argument', 'sessionId is required.');
  }
  const out: UpdateSessionInput = { sessionId: d.sessionId };
  if (d.date !== undefined) {
    if (typeof d.date !== 'string' || !DATE_ONLY.test(d.date)) {
      throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD.');
    }
    out.date = d.date;
  }
  if (d.title !== undefined) {
    const title = typeof d.title === 'string' ? d.title.trim() : '';
    if (!title) throw new HttpsError('invalid-argument', 'A title cannot be empty.');
    out.title = title;
  }
  if (d.dueDate !== undefined) {
    // Moving the deadline FORWARD is the documented way to reopen a session that
    // has closed, so this is the recovery valve as well as a validator.
    out.dueDate = validateDueDate(d.dueDate, today);
  }
  if (d.notes !== undefined) {
    if (typeof d.notes !== 'string') throw new HttpsError('invalid-argument', 'notes must be text.');
    out.notes = d.notes;
  }
  if (Object.keys(out).length === 1) throw new HttpsError('invalid-argument', 'Nothing to change.');
  return out;
}

export const updateSession = auditedCall('updateSession', async (req, audit) => {
  const input = validateUpdateSession(req.data);
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.sessions).doc(input.sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such session.');
  const session = snap.data() as SessionDoc;
  await requireCourseScope(req, session.courseId);
  audit.courseId = session.courseId;
  const { sessionId: _id, ...fields } = input;
  // A dueDate edit re-flows to obligations via the onSessionWritten trigger.
  await ref.update({ ...fields, updatedAt: Date.now() });

  // Keep the recording's student-facing display copy in sync with the session.
  if (session.recordingId) {
    const denorm: Record<string, unknown> = {};
    if (fields.title !== undefined) denorm.title = fields.title;
    if (fields.notes !== undefined) denorm.notes = fields.notes;
    if (fields.date !== undefined) denorm.date = fields.date;
    if (Object.keys(denorm).length > 0) {
      await db
        .collection(COLLECTIONS.recordings)
        .doc(session.recordingId)
        .update({ ...denorm, updatedAt: Date.now() });
    }
  }
  return { sessionId: input.sessionId };
});

// ------------------------------------------------------------- attendance --

/**
 * Submit attendance for a session (the explicit-submit step).
 *
 * Filtered to the ACTIVE roster so the snapshot only contains real, current
 * members — a student enrolled after this is simply absent from the map and
 * never granted anything (accountability starts at enrollment). Setting
 * `attendanceSubmittedAt` is what unlocks the grant; the onSessionWritten
 * trigger then reconciles the excused → obligations, and projects everyone's
 * mark onto their own attendanceRecords row.
 *
 * Refuses to mark anyone EXCUSED once the due date has passed: an excused mark
 * is the access grant, and granting access that expired yesterday produces a
 * recording nobody can open and a ledger row nobody can clear. Correcting an old
 * session to present/absent still works, so the attendance report stays
 * correctable; to excuse someone late, move the session's due date first.
 */
export const submitAttendance = auditedCall('submitAttendance', async (req, audit) => {
  const d = req.data as { sessionId?: unknown; attendance?: unknown };
  if (typeof d?.sessionId !== 'string' || !d.sessionId) {
    throw new HttpsError('invalid-argument', 'sessionId is required.');
  }
  if (typeof d.attendance !== 'object' || d.attendance === null || Array.isArray(d.attendance)) {
    throw new HttpsError('invalid-argument', 'attendance must be a { uid: status } map.');
  }
  const raw = d.attendance as Record<string, unknown>;
  for (const [, status] of Object.entries(raw)) {
    if (!ATTENDANCE.includes(status as AttendanceStatus)) {
      throw new HttpsError('invalid-argument', 'attendance values must be present/absent/excused.');
    }
  }

  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.sessions).doc(d.sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such session.');
  const session = snap.data() as SessionDoc;
  const uid = await requireCourseScope(req, session.courseId);
  audit.courseId = session.courseId;
  audit.targets = { sessionId: d.sessionId };

  const excusing = Object.values(raw).some((s) => s === 'excused');
  if (excusing && session.dueDate < todayInZone(INSTITUTE_TIMEZONE)) {
    throw new HttpsError(
      'failed-precondition',
      "This session's due date has passed. Move it before excusing anyone.",
    );
  }

  // Keep only active-enrolled students — the snapshot is the roster at submit time.
  const rosterSnap = await db
    .collection(COLLECTIONS.enrollments)
    .where('courseId', '==', session.courseId)
    .where('active', '==', true)
    .get();
  const roster = new Set(rosterSnap.docs.map((e) => (e.data() as EnrollmentDoc).studentUid));
  const attendance: Record<string, AttendanceStatus> = {};
  for (const [studentUid, status] of Object.entries(raw)) {
    if (roster.has(studentUid)) attendance[studentUid] = status as AttendanceStatus;
  }

  await ref.update({
    attendance,
    attendanceSubmittedAt: Date.now(),
    attendanceSubmittedBy: uid,
    updatedAt: Date.now(),
  });
  return { sessionId: d.sessionId, marked: Object.keys(attendance).length };
});

// --------------------------------------------------------- archive/delete --

/**
 * PERMANENTLY delete a session and its recording. Refuses a session whose
 * recording is published (unpublish/archive first) so a delete can never pull a
 * live recording out from under students. Cascades the recording (and its
 * assignments/completions/progress) then the session.
 */
export const deleteSession = auditedCall('deleteSession', async (req, audit) => {
  const d = req.data as { sessionId?: unknown };
  if (typeof d?.sessionId !== 'string' || !d.sessionId) {
    throw new HttpsError('invalid-argument', 'sessionId is required.');
  }
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.sessions).doc(d.sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such session.');
  const session = snap.data() as SessionDoc;
  await requireCourseScope(req, session.courseId);
  audit.courseId = session.courseId;

  if (session.recordingId) {
    // applyDeleteRecording refuses a published recording and cascades the rest.
    await applyDeleteRecording(session.recordingId);
  }
  await ref.delete();
  return { sessionId: d.sessionId };
});
