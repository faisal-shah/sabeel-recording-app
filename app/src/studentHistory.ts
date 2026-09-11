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
  const out: StudentEvent[] = [];
  for (const e of entries) {
    const what = describeStudentEvent(e, courseLabel);
    if (what) out.push({ id: e.id, at: e.at, actorUid: e.actorUid, what });
  }
  return out.sort((a, b) => a.at - b.at);
}
