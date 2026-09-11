import type { AuditEntryDoc } from '@sabeel/shared';

/**
 * A student's history, read out of the audit log.
 *
 * NOT A SECOND RECORD. Every change staff make to a student already lands in
 * `auditLog` through the `auditedCall` wrapper, tagged with the student's uid
 * under `targets.studentUid` — so a student's history is one query on the log
 * that exists, not an events collection kept in step with it. What this module
 * adds is the reading: which of those rows are about the student's standing
 * (their account, their enrolments), and how each is said on their page.
 *
 * The actions that are NOT here are deliberate. A completion override or an
 * attendance submission names the student too, but belongs to a recording's
 * ledger or a session's register, where it is already shown with its context.
 */
export interface StudentEvent {
  id: string;
  at: number;
  actorUid: string;
  /** What happened, as a sentence fragment: "Enrolled in Hikam Foundations". */
  what: string;
}

/**
 * The sentence for one audit row, or `null` when the row is not part of the
 * student's history.
 *
 * `courseLabel` names a course (with its cohort, since the same course name
 * recurs term after term); it is asked for a course that may since have been
 * deleted, and answers with whatever it has.
 *
 * Every branch has a fallback for a row whose `detail` predates the field it
 * reads — `setEnrollmentActive` audited without its boolean until the history
 * needed it — and the fallback says less rather than guessing: "Enrolment
 * changed" is true of both directions, and a wrong "Removed" on a student who
 * came back is exactly the sentence this page must never print.
 */
export function describeStudentEvent(
  e: AuditEntryDoc,
  courseLabel: (courseId: string) => string,
): string | null {
  const course = () => courseLabel(e.courseId ?? '');
  switch (e.action) {
    case 'createStudent':
      // The account itself is dated from the student document, which every
      // student has whether or not their creation was logged under this key.
      // What the log adds is the enrolment made in the same step.
      return e.courseId ? `Enrolled in ${course()}` : null;
    case 'createEnrollment':
      return `${e.detail?.reenrolled === true ? 'Re-enrolled' : 'Enrolled'} in ${course()}`;
    case 'setEnrollmentActive':
      return e.detail?.active === false
        ? `Removed from ${course()}`
        : e.detail?.active === true
          ? `Re-enrolled in ${course()}`
          : `Enrolment changed in ${course()}`;
    case 'setStudentAccess':
      return e.detail?.status === 'disabled'
        ? 'Account disabled'
        : e.detail?.status === 'active'
          ? 'Account re-enabled'
          : 'Account access changed';
    default:
      return null;
  }
}

/**
 * A second row saying the same thing as the one before it, by the same person,
 * this soon after, is the same tap twice — not a second event.
 *
 * Two "Enrolled in Tafseer" rows 24 ms apart reached production from one
 * double-tapped row before the server refused the second call. The log keeps
 * both, and the audit screen shows both, because both calls ran; the student's
 * page is about what happened to the student, and one thing did.
 */
const SAME_TAP_MS = 60_000;

/**
 * The rows for the page, OLDEST FIRST — a history starts at the beginning.
 *
 * The query behind this is newest-first with a cap, like every read of the
 * audit log, so the cap keeps the most recent events rather than the oldest;
 * the order is turned round here for reading. Rows that are not about the
 * student's standing are dropped, not shown raw.
 */
export function studentHistory(
  entries: readonly (AuditEntryDoc & { id: string })[],
  courseLabel: (courseId: string) => string,
): StudentEvent[] {
  const rows: StudentEvent[] = [];
  for (const e of entries) {
    const what = describeStudentEvent(e, courseLabel);
    if (what) rows.push({ id: e.id, at: e.at, actorUid: e.actorUid, what });
  }
  rows.sort((a, b) => a.at - b.at);
  const out: StudentEvent[] = [];
  for (const r of rows) {
    const prev = out[out.length - 1];
    const sameTap =
      prev !== undefined &&
      prev.what === r.what &&
      prev.actorUid === r.actorUid &&
      r.at - prev.at <= SAME_TAP_MS;
    if (!sameTap) out.push(r);
  }
  return out;
}
