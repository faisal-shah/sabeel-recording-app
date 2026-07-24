import { type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  assignmentId,
  isOverdue,
  type AssignmentDoc,
  type EnrollmentDoc,
  type RecordingDoc,
} from '@sabeel/shared';

/**
 * The one place assignment documents are written.
 *
 * Shared by the publish fan-out trigger (`assignmentsTrigger.ts`), the
 * enrollment callable (late enrolment / unenrolment), and the catch-up callable.
 * All of it runs in the Admin SDK, so it bypasses security rules — assignments
 * are server-owned and `firestore.rules` denies every client write to them.
 *
 * Firestore batches cap at 500 writes; a class roster is far smaller, but the
 * helpers chunk at 400 so a pathologically large class cannot throw.
 */

const CHUNK = 400;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Active enrollments (the roster that becomes accountable) for a class. */
async function activeRoster(db: Firestore, courseId: string): Promise<EnrollmentDoc[]> {
  const snap = await db
    .collection(COLLECTIONS.enrollments)
    .where('courseId', '==', courseId)
    .where('active', '==', true)
    .get();
  return snap.docs.map((d) => d.data() as EnrollmentDoc);
}

/**
 * Upsert a `publish` assignment for each of `studentUids`, WITHOUT clobbering a
 * `catchup` assignment a student may already hold.
 *
 * A caught-up student carries a staff-chosen due date; a re-publish of the same
 * recording must not silently overwrite it with the class default. So existing
 * rows are read first, and a `catchup` row is only re-activated, never rewritten.
 */
async function assignRecordingToStudents(
  db: Firestore,
  rec: { id: string; courseId: string; cohortId: string; dueDate: string | null },
  studentUids: string[],
  assignedBy: string,
): Promise<void> {
  if (studentUids.length === 0) return;
  const now = Date.now();

  for (const group of chunked(studentUids)) {
    const refs = group.map((uid) =>
      db.collection(COLLECTIONS.assignments).doc(assignmentId(uid, rec.id)),
    );
    const existing = await db.getAll(...refs);
    const batch = db.batch();

    group.forEach((uid, i) => {
      const prior = existing[i].data() as AssignmentDoc | undefined;
      if (prior?.source === 'catchup') {
        // Preserve the staff-chosen due date and source; just ensure it counts.
        batch.set(refs[i], { active: true }, { merge: true });
        return;
      }
      const doc: AssignmentDoc = {
        studentUid: uid,
        recordingId: rec.id,
        courseId: rec.courseId,
        cohortId: rec.cohortId,
        dueDate: rec.dueDate,
        source: 'publish',
        active: true,
        assignedAt: prior?.assignedAt ?? now,
        assignedBy: prior?.assignedBy ?? assignedBy,
      };
      batch.set(refs[i], doc);
    });
    await batch.commit();
  }
}

/** Publish the recording to its whole current active roster. */
async function assignRecordingToRoster(
  db: Firestore,
  rec: { id: string; courseId: string; cohortId: string; dueDate: string | null },
  assignedBy: string,
): Promise<void> {
  const roster = await activeRoster(db, rec.courseId);
  await assignRecordingToStudents(
    db,
    rec,
    roster.map((e) => e.studentUid),
    assignedBy,
  );
}

/** Turn accountability off for every assignment of a recording, keeping history. */
async function deactivateAssignmentsForRecording(
  db: Firestore,
  recordingId: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.assignments)
    .where('recordingId', '==', recordingId)
    .where('active', '==', true)
    .get();
  for (const group of chunked(snap.docs)) {
    const batch = db.batch();
    group.forEach((d) => batch.update(d.ref, { active: false }));
    await batch.commit();
  }
}

/** Move a due-date edit onto the recording's `publish` assignments (not catch-ups). */
async function updatePublishDueDates(
  db: Firestore,
  recordingId: string,
  dueDate: string | null,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.assignments)
    .where('recordingId', '==', recordingId)
    .where('source', '==', 'publish')
    .get();
  for (const group of chunked(snap.docs)) {
    const batch = db.batch();
    group.forEach((d) => batch.update(d.ref, { dueDate }));
    await batch.commit();
  }
}

/**
 * Assign a newly enrolled student the class's published recordings whose due
 * date has NOT passed (the brief's late-enrollment default). No-due recordings
 * are included — they are required, just never overdue.
 */
export async function assignPublishedRecordingsToStudent(
  db: Firestore,
  courseId: string,
  studentUid: string,
  today: string,
  assignedBy: string,
): Promise<void> {
  const snap = await db
    .collection(COLLECTIONS.recordings)
    .where('courseId', '==', courseId)
    .where('status', '==', 'published')
    .get();

  const now = Date.now();
  const due = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) }))
    .filter((r) => !isOverdue(r.dueDate, today));

  for (const group of chunked(due)) {
    const batch = db.batch();
    for (const r of group) {
      const ref = db.collection(COLLECTIONS.assignments).doc(assignmentId(studentUid, r.id));
      const doc: AssignmentDoc = {
        studentUid,
        recordingId: r.id,
        courseId,
        cohortId: r.cohortId,
        dueDate: r.dueDate,
        source: 'publish',
        active: true,
        assignedAt: now,
        assignedBy,
      };
      // merge:false is safe here — a brand-new student has no prior assignment,
      // and a re-enrolling one's rows were only deactivated, so overwriting with
      // a fresh active publish row is exactly right.
      batch.set(ref, doc);
    }
    await batch.commit();
  }
}

/** Turn off a student's obligations in a class (unenrolment), keeping history. */
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
    group.forEach((d) => batch.update(d.ref, { active: false }));
    await batch.commit();
  }
}

/**
 * Decide and apply the assignment fan-out for one recording write.
 *
 * Extracted from the trigger so it is testable directly against the emulator
 * with the Admin SDK — no dependence on the functions emulator having loaded and
 * fired a real Firestore trigger, which the integration harness does not
 * guarantee. The trigger (`assignmentsTrigger.ts`) is a thin wrapper over this;
 * the e2e proves the wrapper actually fires.
 *
 * `before`/`after` are the recording document before and after the write
 * (`after` undefined ⇒ deleted). Idempotent, because every helper it calls is.
 */
export async function applyRecordingFanout(
  db: Firestore,
  recordingId: string,
  before: RecordingDoc | undefined,
  after: RecordingDoc | undefined,
): Promise<void> {
  if (!after) {
    await deactivateAssignmentsForRecording(db, recordingId);
    return;
  }

  const wasPublished = before?.status === 'published';
  const isPublished = after.status === 'published';
  const rec = {
    id: recordingId,
    courseId: after.courseId,
    cohortId: after.cohortId,
    dueDate: after.dueDate,
  };

  if (!wasPublished && isPublished) {
    await assignRecordingToRoster(db, rec, 'system');
    return;
  }
  if (wasPublished && !isPublished) {
    await deactivateAssignmentsForRecording(db, recordingId);
    return;
  }
  if (wasPublished && isPublished && before) {
    if (before.courseId !== after.courseId) {
      await deactivateAssignmentsForRecording(db, recordingId);
      await assignRecordingToRoster(db, rec, 'system');
    } else if (before.dueDate !== after.dueDate) {
      await updatePublishDueDates(db, recordingId, after.dueDate);
    }
  }
}

