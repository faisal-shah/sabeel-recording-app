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
 * A required-listening obligation for one student and one recording.
 *
 * There is exactly one reason an obligation exists: the student was absent or
 * excused from the session and it has a published recording. So there is no
 * `source` — the reconcile from the session's attendance is the only writer.
 *
 * Document id is `${studentUid}_${recordingId}` — at most one obligation per
 * student per recording, which makes the reconcile idempotent. Written ONLY by
 * the server; clients read their own and never write. `dueDate` is denormalized
 * from the session so a student computes overdue with no extra read.
 */
export interface AssignmentDoc {
  studentUid: string;
  recordingId: string;
  sessionId: string;
  courseId: string;
  cohortId: string;
  /** Date-only `YYYY-MM-DD` in the institute timezone, or null ("required, but
   *  never overdue" — a no-due assignment is still required listening). */
  dueDate: string | null;
  /**
   * Accountability on/off without deleting history. Unpublish, marking the
   * student present, and unenrolling all set this false; the row and its
   * completion history remain for audit.
   */
  active: boolean;
  assignedAt: number;
  assignedBy: string;
}

export function assignmentId(studentUid: string, recordingId: string): string {
  return `${studentUid}_${recordingId}`;
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
 * Is this obligation overdue as of `today`?
 *
 * The due date is the LAST on-time day: a recording due `2026-07-25` is still
 * "due" all through the 25th and becomes overdue on the 26th. No-due
 * assignments never become overdue.
 */
export function isOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && today > dueDate;
}

/**
 * Which section of the student home an obligation belongs in.
 *
 *  - `done`     — completed, regardless of due date (Completed / recent history).
 *  - `overdue`  — past its due date and not done.
 *  - `dueSoon`  — due within the next `DUE_SOON_DAYS` days (incl. today), not done.
 *  - `upcoming` — has a due date further out than that, not done.
 *  - `noDue`    — required but with no due date, not done.
 *
 * `upcoming` is not one of the brief's four named sections but is the honest
 * home for a dated obligation that is neither soon nor overdue; the home orders
 * it right after `dueSoon`.
 */
export type DueBucket = 'overdue' | 'dueSoon' | 'upcoming' | 'noDue' | 'done';

const BUCKET_RANK: Record<DueBucket, number> = {
  overdue: 0,
  dueSoon: 1,
  upcoming: 2,
  noDue: 3,
  done: 4,
};

/** Sort key for the home list: lower sorts first. */
export function bucketRank(bucket: DueBucket): number {
  return BUCKET_RANK[bucket];
}

export function dueBucket(
  item: { dueDate: string | null; completed: boolean },
  today: string,
): DueBucket {
  if (item.completed) return 'done';
  if (item.dueDate === null) return 'noDue';
  if (isOverdue(item.dueDate, today)) return 'overdue';
  return daysUntilDue(item.dueDate, today) <= DUE_SOON_DAYS ? 'dueSoon' : 'upcoming';
}
