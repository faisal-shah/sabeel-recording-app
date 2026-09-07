import { type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  accountableUids,
  assignmentId,
  enrollmentId,
  type AssignmentDoc,
  type EnrollmentDoc,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';

/**
 * The one place assignment documents are written.
 *
 * Obligations are attendance-driven: a student owes a session's recording iff the
 * recording is published, attendance has been submitted, and they were marked
 * EXCUSED. That one document is both the access grant and the requirement, so
 * present and absent students are granted nothing. This module reconciles the
 * `assignments` collection to that truth. All of it runs in the Admin SDK, so it
 * bypasses security rules — assignments are server-owned and `firestore.rules`
 * denies every client write.
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

/**
 * Of the excused, those still enrolled in the class.
 *
 * THE SAME RULE `submitAttendance` ALREADY APPLIES, re-applied here. That
 * callable filters the map it stores to actively-enrolled students — "the
 * snapshot is the roster at submit time" — so a mark can only ever be written
 * for somebody enrolled. This is that rule at RECONCILE time, which is the
 * moment it was missing: a snapshot taken months ago is not evidence that its
 * roster is still the roster.
 *
 * UNENROLMENT HAS TO STICK, and without this it did not. `setEnrollmentActive`
 * calls `deactivateStudentAssignmentsInCourse`, which switches the grants off —
 * and then the next write to ANY session in that course (a title fix, a moved
 * due date, a re-submitted register) re-ran this reconcile, which rebuilt the
 * target set from the attendance snapshot alone and switched them straight back
 * on. A mark records what happened on the day and outlives the enrolment;
 * enrolment is the separate fact of whether they are still in the class, and
 * only the second one decides who is accountable now.
 *
 * That silently contradicted three places that promise otherwise: the rules
 * gate a recording on an ACTIVE assignment, `getPlaybackUrl` mints on one, and
 * the ledger tells staff in as many words that a lapsed grant means the student
 * "was unenrolled from the class… Re-enrolling or republishing restores the
 * grant" — which is also now true, since re-enrolling puts them back in this
 * set on the next reconcile.
 *
 * One batched read, and only when there is somebody to check.
 */
async function stillEnrolled(
  db: Firestore,
  courseId: string,
  studentUids: string[],
): Promise<string[]> {
  if (studentUids.length === 0) return [];
  // CHUNKED at the same 400 as `assignToStudents`, which is the rule this
  // module's header states: a pathologically large roster must not throw.
  const active = new Set<string>();
  for (const group of chunked(studentUids)) {
    const refs = group.map((uid) =>
      db.collection(COLLECTIONS.enrollments).doc(enrollmentId(uid, courseId)),
    );
    const rows = await db.getAll(...refs);
    group.forEach((uid, i) => {
      if ((rows[i].data() as EnrollmentDoc | undefined)?.active) active.add(uid);
    });
  }
  return studentUids.filter((uid) => active.has(uid));
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
 * (attendance) trigger. Target = the EXCUSED in the submitted attendance, and
 * only once the recording is published AND attendance has been submitted;
 * otherwise nobody is accountable and nobody may open it. `dueDate` follows the
 * session, so a due-date edit re-flows here. Idempotent — deterministic ids plus
 * a deactivate of the complement — so it is safe on every write.
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
  const excused = ready ? accountableUids(session.attendance) : [];
  const target = await stillEnrolled(db, session.courseId, excused);

  await assignToStudents(db, session, sessionId, recId, target, 'system');
  await deactivateExcept(db, recId, new Set(target));
}

/**
 * Reconcile every session in a course — the other half of unenrolment.
 *
 * `deactivateStudentAssignmentsInCourse` switches a student's grants off when
 * they leave. Nothing switched them back on when they returned: there is no
 * trigger on `enrollments`, and `setEnrollmentActive` wrote one field. So a
 * student who was unenrolled and re-enrolled a fortnight later came back to an
 * empty home screen — every recording refused by the rules and by
 * `getPlaybackUrl` — while the recording ledger told staff, in as many words,
 * that "re-enrolling them or republishing restores it". Access actually returned
 * only if somebody independently edited each session or republished each
 * recording, which is not a thing anybody would think to do.
 *
 * Per SESSION rather than per assignment, because the grant is derived, never
 * restored from a copy: each session is reconciled from its own attendance and
 * its own recording, which is the same decision `onSessionWritten` makes. A
 * student excused before they left is granted again; one who was not is not;
 * and a session whose recording is no longer published grants nobody, exactly as
 * if it had been reconciled for any other reason.
 *
 * Sized for a course, not for the institute: a term is tens of sessions, and
 * this runs on an admin action nobody performs in a loop.
 */
export async function reconcileCourseAssignments(db: Firestore, courseId: string): Promise<void> {
  const sessions = await db
    .collection(COLLECTIONS.sessions)
    .where('courseId', '==', courseId)
    .get();
  for (const doc of sessions.docs) {
    const session = doc.data() as SessionDoc;
    if (!session.recordingId) continue;
    const rec = (
      await db.collection(COLLECTIONS.recordings).doc(session.recordingId).get()
    ).data() as RecordingDoc | undefined;
    await reconcileSessionAssignments(db, doc.id, session, rec);
  }
}

/**
 * React to a recording write: reconcile its session's obligations. A recording
 * that is gone deactivates everything pointing at it.
 *
 * THE EVENT PAYLOAD DECIDES NOTHING — not what to write, and not whether the
 * recording still exists. The delete branch used to read the event's `after`,
 * which is the one thing `applySessionFanout`'s docblock says not to do: delivery
 * is at-least-once and unordered, so a delete event arriving after the document
 * at that id exists again deactivated a live grant. Production never reuses a
 * recording id, so this was only ever reachable in a fixture — but a trigger
 * that trusts a stale snapshot for a destructive branch is the wrong shape, and
 * it made three unrelated suites fail a few runs in a hundred, in a different
 * test each time.
 */
export async function applyRecordingFanout(db: Firestore, recordingId: string): Promise<void> {
  const rec = (await db.collection(COLLECTIONS.recordings).doc(recordingId).get()).data() as
    | RecordingDoc
    | undefined;
  if (!rec?.sessionId) {
    // Gone, or malformed with no session — nothing left to reconcile against.
    await deactivateAssignmentsForRecording(db, recordingId);
    return;
  }
  const session = (
    await db.collection(COLLECTIONS.sessions).doc(rec.sessionId).get()
  ).data() as SessionDoc | undefined;
  await reconcileSessionAssignments(db, rec.sessionId, session, rec);
}

/**
 * React to a session write (attendance / due-date change): reconcile its
 * recording's obligations.
 *
 * Both sides are RE-READ rather than taken from the event's `after` snapshot.
 * Cloud Functions delivery is at-least-once and unordered, so two quick writes
 * — submit attendance, then correct one student and re-submit — can reconcile in
 * reverse order. Reconciling from a snapshot lets the older invocation write
 * last and silently restore the obligation that was just removed, and it stays
 * wrong until the next write to that session. Reconciling from stored truth
 * converges no matter what order the events arrive in.
 */
export async function applySessionFanout(
  db: Firestore,
  sessionId: string,
  _before: SessionDoc | undefined,
  after: SessionDoc | undefined,
): Promise<void> {
  if (!after) return; // a deleted session cascades its assignments in the delete callable
  const session = (await db.collection(COLLECTIONS.sessions).doc(sessionId).get()).data() as
    | SessionDoc
    | undefined;
  if (!session) return;
  const recId = session.recordingId;
  const rec = recId
    ? ((await db.collection(COLLECTIONS.recordings).doc(recId).get()).data() as
        | RecordingDoc
        | undefined)
    : undefined;
  await reconcileSessionAssignments(db, sessionId, session, rec);
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
