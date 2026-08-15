/**
 * Assignments (required-listening obligations), completion state, and the
 * date-only due-date maths that orders a student's home.
 *
 * Everything here is PURE — no Firestore, no Date-now hidden inside — so every
 * boundary (the day a due date flips to overdue, in the institute timezone) can
 * be tested with a fixed clock and no emulator. Same discipline as
 * `recordings.ts`.
 */
import { DUE_SOON_DAYS } from './constants';

// -------------------------------------------------------------- documents --

/**
 * A student's grant on one recording: both the permission to play it and the
 * obligation to.
 *
 * There is exactly one reason one exists: the student was marked EXCUSED for the
 * session and it has a published recording. So there is no `source` — the
 * reconcile from the session's attendance is the only writer.
 *
 * This document is the whole of a student's access. `firestore.rules` gates the
 * recording's metadata on it, and `getPlaybackUrl` gates the audio on it, so a
 * student who is not excused cannot reach a recording by any route.
 *
 * Document id is `${studentUid}_${recordingId}` — at most one per student per
 * recording, which makes the reconcile idempotent. Written ONLY by the server;
 * clients read their own and never write. `dueDate` is denormalized from the
 * session so a student sees their deadline with no extra read.
 */
export interface AssignmentDoc {
  studentUid: string;
  recordingId: string;
  sessionId: string;
  courseId: string;
  cohortId: string;
  /** Date-only `YYYY-MM-DD` in the institute timezone. The last day the student
   *  may listen: access closes after it. Never null — see `SessionDoc.dueDate`. */
  dueDate: string;
  /**
   * The grant on/off without deleting history. Unpublish, marking the student
   * present or absent, and unenrolling all set this false; the row and its
   * completion history remain for audit.
   *
   * Note it does NOT go false when the due date passes: that would erase the
   * ledger's record of who missed what. Expiry is a function of the date, not a
   * stored flag — see `hasRecordingAccess`.
   */
  active: boolean;
  assignedAt: number;
  assignedBy: string;
}

export function assignmentId(studentUid: string, recordingId: string): string {
  return `${studentUid}_${recordingId}`;
}

/**
 * May this student still open this recording?
 *
 * The single definition of access, shared by `getPlaybackUrl` and the student
 * UI so the app never offers a play button the server will refuse. Deliberately
 * NOT reimplemented in security rules: comparing `request.time` to a date-only
 * string in the institute timezone would be a second copy of the maths below,
 * free to drift. Rules gate the metadata on `active`; this gates the audio.
 */
export function hasRecordingAccess(
  assignment: { active: boolean; dueDate: string },
  today: string,
): boolean {
  return assignment.active && !isOverdue(assignment.dueDate, today);
}

/**
 * A student's current completion STATE for one recording.
 *
 * Client-written, keyed `${studentUid}_${recordingId}`, and independent of any
 * assignment: a student may complete an accessible recording that was never
 * assigned to them (the brief allows it; it just does not count as required).
 * `hasPendingWrites` on this document's snapshot is the "Pending sync" signal.
 */
export interface CompletionDoc {
  studentUid: string;
  recordingId: string;
  courseId: string;
  completed: boolean;
  /** When it was last marked complete; null once unmarked. */
  completedAt: number | null;
  updatedAt: number;
}

export function completionId(studentUid: string, recordingId: string): string {
  return `${studentUid}_${recordingId}`;
}

/**
 * One mark/unmark action — append-only audit.
 *
 * `actor` is `'student'` for self-service; staff overrides (Phase 5) will carry
 * a uid here. Never updated or deleted.
 */
export interface CompletionEventDoc {
  studentUid: string;
  recordingId: string;
  courseId: string;
  action: 'complete' | 'uncomplete';
  actor: 'student';
  at: number;
}

// -------------------------------------------------------- date-only maths --

/**
 * Today's calendar date in a timezone, as `YYYY-MM-DD`.
 *
 * `en-CA` formats as ISO `YYYY-MM-DD`, and `timeZone` makes the rollover happen
 * at local midnight — so at 11pm Houston time on the 24th this returns
 * `...-24`, not the 25th that UTC would give. No date library needed.
 */
export function todayInZone(timeZone: string, now: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

/**
 * `date` shifted by whole calendar days, as `YYYY-MM-DD`.
 *
 * Parsed as UTC midnight for the same reason `daysUntilDue` is: this is civil
 * date arithmetic, and DST never enters a count of calendar days. Used to
 * prefill a session's due date from its meeting date.
 */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whole calendar days from `today` until `dueDate` (negative once past).
 *
 * Both are date-only strings, so they are parsed as UTC midnight purely to
 * count the days between two civil dates — DST never enters a difference of two
 * calendar days, so this is exact. `2026-07-25` minus `2026-07-24` is 1.
 */
export function daysUntilDue(dueDate: string, today: string): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((due - now) / 86_400_000);
}

/**
 * Has this due date passed as of `today`?
 *
 * The due date is the LAST on-time day: a recording due `2026-07-25` is still
 * open all through the 25th and closes on the 26th.
 */
export function isOverdue(dueDate: string, today: string): boolean {
  return today > dueDate;
}

/**
 * Which section of the student home an obligation belongs in.
 *
 *  - `done`     — completed, regardless of due date (Completed / recent history).
 *  - `missed`   — past its due date and not done. Access has closed, so this is
 *                 a final state, not a late-but-still-doable one. Called
 *                 "missed" rather than "overdue" for exactly that reason: staff
 *                 and students should not read it as work still outstanding.
 *  - `dueSoon`  — due within the next `DUE_SOON_DAYS` days (incl. today), not done.
 *  - `upcoming` — due further out than that, not done.
 *
 * `upcoming` is not one of the brief's named sections but is the honest home for
 * an obligation that is neither soon nor missed; the home orders it after
 * `dueSoon`.
 */
export type DueBucket = 'missed' | 'dueSoon' | 'upcoming' | 'done';

const BUCKET_RANK: Record<DueBucket, number> = {
  missed: 0,
  dueSoon: 1,
  upcoming: 2,
  done: 3,
};

/** Sort key for the home list: lower sorts first. */
export function bucketRank(bucket: DueBucket): number {
  return BUCKET_RANK[bucket];
}

export function dueBucket(
  item: { dueDate: string; completed: boolean },
  today: string,
): DueBucket {
  if (item.completed) return 'done';
  if (isOverdue(item.dueDate, today)) return 'missed';
  return daysUntilDue(item.dueDate, today) <= DUE_SOON_DAYS ? 'dueSoon' : 'upcoming';
}
