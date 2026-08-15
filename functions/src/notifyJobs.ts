import { type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  attendanceMissingMessage,
  lastDayMessage,
  recordingReadyMessage,
  type AssignmentDoc,
  type CompletionDoc,
  type CourseDoc,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';
import { notifyOnce } from './notify';

/**
 * What each of the three notifications actually looks up and sends.
 *
 * Separated from the trigger/schedule bindings so every one of them can be
 * driven directly against the emulator with the FCM sender stubbed. Delivery is
 * the only part no test can reach; deciding WHO gets WHAT is all here.
 */

/** Cache course names across a batch — a morning sweep touches the same few. */
function courseNames(db: Firestore) {
  const cache = new Map<string, string>();
  return async (courseId: string): Promise<string> => {
    const hit = cache.get(courseId);
    if (hit !== undefined) return hit;
    const doc = (await db.collection(COLLECTIONS.courses).doc(courseId).get()).data() as
      | CourseDoc
      | undefined;
    const name = doc?.name ?? 'Your class';
    cache.set(courseId, name);
    return name;
  };
}

/**
 * A grant just became active on a published recording: tell the student.
 *
 * Fires from the assignments trigger rather than the publish callable because a
 * grant appears from either direction — publishing a recording, or submitting
 * attendance for one already published — and the assignment document is where
 * those two paths meet.
 */
export async function notifyRecordingReady(
  db: Firestore,
  assignment: AssignmentDoc,
): Promise<boolean> {
  const rec = (
    await db.collection(COLLECTIONS.recordings).doc(assignment.recordingId).get()
  ).data() as RecordingDoc | undefined;
  if (!rec || rec.status !== 'published') return false;

  const courseName = await courseNames(db)(assignment.courseId);
  return notifyOnce(
    db,
    assignment.studentUid,
    'recordingReady',
    assignment.recordingId,
    recordingReadyMessage(courseName, rec.title, assignment.dueDate),
  );
}

/**
 * Everyone whose grant closes at the end of `today` and who has not finished it.
 *
 * Deliberately the morning OF the due date, not the day after: after it the
 * recording is gone, so the only honest message would be "you missed it".
 */
export async function notifyLastDay(db: Firestore, today: string): Promise<number> {
  const due = await db
    .collection(COLLECTIONS.assignments)
    .where('active', '==', true)
    .where('dueDate', '==', today)
    .get();

  const nameOf = courseNames(db);
  let sent = 0;
  for (const doc of due.docs) {
    const a = doc.data() as AssignmentDoc;
    const completion = (
      await db
        .collection(COLLECTIONS.completions)
        .doc(`${a.studentUid}_${a.recordingId}`)
        .get()
    ).data() as CompletionDoc | undefined;
    if (completion?.completed) continue;

    const rec = (
      await db.collection(COLLECTIONS.recordings).doc(a.recordingId).get()
    ).data() as RecordingDoc | undefined;
    if (!rec || rec.status !== 'published') continue;

    const ok = await notifyOnce(
      db,
      a.studentUid,
      'lastDay',
      a.recordingId,
      lastDayMessage(await nameOf(a.courseId), rec.title, a.dueDate),
    );
    if (ok) sent++;
  }
  return sent;
}

/**
 * Sessions that have met but whose attendance was never submitted, to the staff
 * who run them.
 *
 * Under excused-only access an un-taken sheet is not an admin nicety: nobody is
 * granted anything, so a published recording sits there openable by no one and
 * nothing in the app says so. This is the message that catches it.
 *
 * `graceDays` keeps it off a teacher's back the same evening — attendance taken
 * the next morning is normal, not a lapse.
 */
export async function notifyAttendanceMissing(
  db: Firestore,
  today: string,
  graceDays = 2,
): Promise<number> {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - graceDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const stale = await db
    .collection(COLLECTIONS.sessions)
    .where('attendanceSubmittedAt', '==', null)
    .where('date', '<=', cutoff)
    .get();

  const nameOf = courseNames(db);
  let sent = 0;
  for (const doc of stale.docs) {
    const s = doc.data() as SessionDoc;
    if (s.archived) continue;
    const course = (await db.collection(COLLECTIONS.courses).doc(s.courseId).get()).data() as
      | CourseDoc
      | undefined;
    // An archived or finished course is not a reminder anyone wants.
    if (!course || !course.effectiveActive) continue;

    const message = attendanceMissingMessage(await nameOf(s.courseId), s.title, s.date);
    for (const uid of course.managerUids) {
      if (await notifyOnce(db, uid, 'attendanceMissing', doc.id, message)) sent++;
    }
  }
  return sent;
}
