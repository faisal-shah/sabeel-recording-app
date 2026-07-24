import { type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  accountableUids,
  assignmentId,
  type AssignmentDoc,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';

/**
 * The one place assignment documents are written.
 *
 * Obligations are attendance-driven: a student owes a session's recording iff the
 * recording is published, attendance has been submitted, and they were marked
 * absent or excused. This module reconciles the `assignments` collection to that
 * truth. All of it runs in the Admin SDK, so it bypasses security rules —
 * assignments are server-owned and `firestore.rules` denies every client write.
 *
 * Firestore batches cap at 500 writes; a course roster is far smaller, but the
 * helpers chunk at 400 so a pathologically large roster cannot throw.
 */

const CHUNK = 400;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Upsert an active obligation for each uid; idempotent on the deterministic id. */
async function assignToStudents(
  db: Firestore,
  session: SessionDoc,
  sessionId: string,
  recordingId: string,
  studentUids: string[],
  assignedBy: string,
): Promise<void> {
  if (studentUids.length === 0) return;
  const now = Date.now();
  for (const group of chunked(studentUids)) {
    const refs = group.map((uid) =>
      db.collection(COLLECTIONS.assignments).doc(assignmentId(uid, recordingId)),
    );
    const existing = await db.getAll(...refs);
    const batch = db.batch();
    group.forEach((uid, i) => {
      const prior = existing[i].data() as AssignmentDoc | undefined;
      const doc: AssignmentDoc = {
        studentUid: uid,
        recordingId,
        sessionId,
        courseId: session.courseId,
        cohortId: session.cohortId,
        dueDate: session.dueDate,
        active: true,
        assignedAt: prior?.assignedAt ?? now,
        assignedBy: prior?.assignedBy ?? assignedBy,
      };
      batch.set(refs[i], doc);
    });
    await batch.commit();
  }
}

/** Deactivate active obligations for a recording whose student is NOT in `keep`. */
async function deactivateExcept(
  db: Firestore,
  recordingId: string,
  keep: Set<string>,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.assignments)
    .where('recordingId', '==', recordingId)
    .where('active', '==', true)
    .get();
  const stale = snap.docs.filter((d) => !keep.has((d.data() as AssignmentDoc).studentUid));
  for (const group of chunked(stale)) {
    const batch = db.batch();
    for (const d of group) batch.update(d.ref, { active: false });
    await batch.commit();
  }
}

/** Turn accountability off for every assignment of a recording, keeping history. */
async function deactivateAssignmentsForRecording(
  db: Firestore,
  recordingId: string,
): Promise<void> {
  await deactivateExcept(db, recordingId, new Set());
}

/**
 * Reconcile a session's recording obligations to its attendance.
 *
 * The single decision point, shared by the recording trigger and the session
 * (attendance) trigger. Target = absent ∪ excused from the submitted attendance,
 * but only once the recording is published AND attendance has been submitted;
 * otherwise nobody is accountable. `dueDate` follows the session, so a due-date
 * edit re-flows here. Idempotent — deterministic ids plus a deactivate of the
 * complement — so it is safe on every write.
 */
export async function reconcileSessionAssignments(
  db: Firestore,
  sessionId: string,
  session: SessionDoc | undefined,
  recording: RecordingDoc | undefined,
): Promise<void> {
  const recId = session?.recordingId ?? null;
  if (!session || !recId) return; // no session or no recording — nothing to own

  const rec =
    recording && recording.status
      ? recording
      : ((await db.collection(COLLECTIONS.recordings).doc(recId).get()).data() as
          | RecordingDoc
          | undefined);

  const ready = !!rec && rec.status === 'published' && !!session.attendanceSubmittedAt;
  const target = ready ? accountableUids(session.attendance) : [];

  await assignToStudents(db, session, sessionId, recId, target, 'system');
  await deactivateExcept(db, recId, new Set(target));
}

/**
 * React to a recording write: reconcile its session's obligations. A deleted
 * recording deactivates everything pointing at it.
 */
export async function applyRecordingFanout(
  db: Firestore,
  recordingId: string,
  _before: RecordingDoc | undefined,
  after: RecordingDoc | undefined,
): Promise<void> {
  if (!after || !after.sessionId) {
    // Deleted, or a malformed recording with no session — nothing to reconcile.
    await deactivateAssignmentsForRecording(db, recordingId);
    return;
  }
  const session = (
    await db.collection(COLLECTIONS.sessions).doc(after.sessionId).get()
  ).data() as SessionDoc | undefined;
  await reconcileSessionAssignments(db, after.sessionId, session, after);
}

/**
 * React to a session write (attendance / due-date change): reconcile its
 * recording's obligations.
 */
export async function applySessionFanout(
  db: Firestore,
  sessionId: string,
  _before: SessionDoc | undefined,
  after: SessionDoc | undefined,
): Promise<void> {
  if (!after) return; // a deleted session cascades its assignments in the delete callable
  const recId = after.recordingId;
  const rec = recId
    ? ((await db.collection(COLLECTIONS.recordings).doc(recId).get()).data() as
        | RecordingDoc
        | undefined)
    : undefined;
  await reconcileSessionAssignments(db, sessionId, after, rec);
}

/** Turn off a student's obligations in a course (unenrolment), keeping history. */
export async function deactivateStudentAssignmentsInCourse(
  db: Firestore,
  courseId: string,
  studentUid: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.assignments)
    .where('studentUid', '==', studentUid)
    .where('courseId', '==', courseId)
    .get();
  for (const group of chunked(snap.docs)) {
    const batch = db.batch();
    for (const d of group) batch.update(d.ref, { active: false });
    await batch.commit();
  }
}
