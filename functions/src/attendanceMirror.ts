import { type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  attendanceRecordId,
  type AttendanceRecordDoc,
  type SessionDoc,
} from '@sabeel/shared';

/**
 * The one place `attendanceRecords` documents are written.
 *
 * Attendance is a MAP on the session document, and `/sessions` is staff-only
 * because the map holds the whole roster. Firestore security is per-document —
 * there is no rule that reveals one key of a map to the student it belongs to
 * and hides the rest — so the only way to show a student their own mark is to
 * give them a document that contains it and nothing else. This module projects
 * the session's map onto one such document per student.
 *
 * The session stays canonical. This is reconciled FROM it, never the reverse,
 * and like the assignment fan-out it reads stored truth rather than an event
 * payload, so it converges whatever order the triggers arrive in and whoever
 * wrote the session (callable, seed script or test). It writes only
 * `attendanceRecords`, so it cannot re-trigger `onSessionWritten`.
 *
 * Firestore batches cap at 500 writes; a roster is far smaller, but the helpers
 * chunk at 400 so a pathologically large one cannot throw. Same shape as
 * `assignmentsFanout`.
 */

const CHUNK = 400;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Reconcile one session's attendance projections to its submitted snapshot.
 *
 * Until attendance is submitted the target is empty, so a session whose marks
 * are still being edited shows a student nothing — the same gate that stops the
 * assignment fan-out running early. Rows for students no longer in the snapshot
 * (unenrolled, or corrected out of it) are DELETED rather than deactivated:
 * unlike an assignment, an attendance mark carries no history worth keeping once
 * the session says it never happened, and a stale row would contradict the
 * staff-facing report.
 */
export async function reconcileAttendanceRecords(
  db: Firestore,
  sessionId: string,
  session: SessionDoc | undefined,
): Promise<void> {
  const submittedAt = session?.attendanceSubmittedAt ?? null;
  const target = session && submittedAt !== null ? session.attendance : {};

  const existing = await db
    .collection(COLLECTIONS.attendanceRecords)
    .where('sessionId', '==', sessionId)
    .get();

  const stale = existing.docs.filter(
    (d) => target[(d.data() as AttendanceRecordDoc).studentUid] === undefined,
  );
  for (const group of chunked(stale)) {
    const batch = db.batch();
    for (const d of group) batch.delete(d.ref);
    await batch.commit();
  }

  if (!session || submittedAt === null) return;

  const uids = Object.keys(target);
  for (const group of chunked(uids)) {
    const batch = db.batch();
    for (const studentUid of group) {
      const doc: AttendanceRecordDoc = {
        studentUid,
        sessionId,
        courseId: session.courseId,
        cohortId: session.cohortId,
        date: session.date,
        title: session.title,
        status: target[studentUid],
        submittedAt,
      };
      batch.set(
        db.collection(COLLECTIONS.attendanceRecords).doc(attendanceRecordId(studentUid, sessionId)),
        doc,
      );
    }
    await batch.commit();
  }
}
