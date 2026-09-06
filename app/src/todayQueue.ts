/**
 * The staff work queue's derivation — pure, and deliberately in its own module.
 *
 * NOTHING HERE IMPORTS REACT, FIREBASE OR REACT-NATIVE, and that is the point:
 * `app/vitest.config.ts` runs in a node environment with no react-native
 * transform, so logic that reaches the app's UI layer cannot be unit tested at
 * all. Everything interesting about this queue lives here — the bucketing, what
 * counts as blocking, the ordering, and the three different sentences an empty
 * result has to produce — and `today.ts` is the subscriptions that feed it.
 */
import {
  DUE_SOON_DAYS,
  daysUntilDue,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';

export type TodayKind = 'attendance' | 'recording' | 'publish' | 'closing';

export interface TodayItem {
  key: string;
  kind: TodayKind;
  sessionId: string;
  courseId: string;
  courseName: string;
  title: string;
  /** The session's meeting date, `YYYY-MM-DD`. */
  date: string;
  /** What the reader has to do about it, in their own words. */
  detail: string;
  recordingId: string | null;
  /** Days past due (negative = still to come). Drives the ordering. */
  age: number;
  /**
   * Students are locked out of something until this is cleared.
   *
   * Two kinds qualify and it is worth being exact about which. An un-taken
   * register grants nobody anything, and an UNPUBLISHED recording takes back
   * access every excused student already had. A draft has granted nothing yet
   * and a missing recording is not a lockout — those are work, not a closed
   * door. This is what the tab's badge counts.
   */
  blocking: boolean;
}

export interface TodayQueue {
  items: TodayItem[];
  /** How many rows are `blocking` — the number on the tab. */
  blocking: number;
  /** No snapshot has arrived yet. Distinct from an empty queue, which is news. */
  loading: boolean;
  /** A listener was refused. `loading` would otherwise be true for ever. */
  failed: boolean;
  /**
   * Whether there are any LIVE courses to have a queue about.
   *
   * An empty queue has three causes and they read as three different sentences:
   * nothing is waiting, you have no courses yet, and your courses are all
   * finished. Telling a manager at the end of term that an administrator will
   * assign them something is the second answer given to the third question.
   */
  scoped: boolean;
  /** Courses exist, but none of them is still running. */
  allFinished: boolean;
  /** More courses than one `in` clause can carry; the queue is a partial view. */
  truncated: boolean;
}

/**
 * How urgent each kind is, before age is considered — and THE ONE STATEMENT OF
 * that order in the app. `TodayScreen` renders its sections in this sequence by
 * reading it, rather than by listing the kinds a second time; two lists would
 * be free to disagree, and the disagreement would be invisible because the
 * screen groups the rows anyway.
 *
 * ATTENDANCE IS FIRST AND IT IS NOT A CLOSE CALL. Under the excused-only policy
 * an un-taken sheet grants nobody anything, so a whole class is locked out of a
 * published recording with nothing on any screen saying why. Every other row
 * here is work that is visibly outstanding somewhere; this one is work whose
 * absence is invisible.
 */
export const KIND_ORDER = ['attendance', 'publish', 'recording', 'closing'] as const;
const RANK: Record<TodayKind, number> = {
  attendance: KIND_ORDER.indexOf('attendance'),
  publish: KIND_ORDER.indexOf('publish'),
  recording: KIND_ORDER.indexOf('recording'),
  closing: KIND_ORDER.indexOf('closing'),
};

/**
 * The whole derivation, as a pure function of what the listeners returned.
 *
 * SEPARATE FROM THE HOOK ON PURPOSE. Everything interesting about this queue is
 * in here — the bucketing, what counts as blocking, the ordering, and the three
 * different sentences an empty result has to produce — and none of it was
 * reachable from a test while it lived inside a `useMemo`. The hook below is now
 * only the subscriptions and this call.
 */
export function buildTodayQueue({
  courses,
  sessions,
  recordings,
  scope,
  today,
  failed,
  settled,
  truncated,
}: {
  /** Every course the reader can see, or null before the first snapshot. */
  courses: { id: string; name: string }[] | null;
  /** Sessions across `scope`, or null before the first snapshot. */
  sessions: (SessionDoc & { id: string })[] | null;
  /** Recordings across `scope` by id, or null before the first snapshot. */
  recordings: Map<string, RecordingDoc & { id: string }> | null;
  /** The course ids actually subscribed — empty when there are none to watch. */
  scope: readonly string[];
  /** Today in the institute's timezone, as `YYYY-MM-DD`. */
  today: string;
  /** Whether any listener this queue depends on was refused. */
  failed: boolean;
  /**
   * Whether nothing will ever be subscribed, so a null `courses` is the final
   * answer rather than a cold load.
   *
   * True only for a reader who has no course query at all — a student, whose
   * queue is never rendered. It is NOT "the course listener has answered": that
   * listener reports by turning `courses` non-null, and until it does there is
   * nothing to say.
   */
  settled: boolean;
  /** Whether `scope` was cut to fit one `in` clause. */
  truncated: boolean;
}): TodayQueue {
  const names = new Map((courses ?? []).map((c) => [c.id, c.name]));

  // Nothing subscribed is not the same as nothing loaded. Until the COURSES
  // arrive there is no answer at all, and an empty list of them reads on
  // screen as "you have no courses" — a confident wrong answer shown to every
  // staff member for the length of a cold load.
  const pending = { items: [], blocking: 0, failed, scoped: true, allFinished: false, truncated };
  if (!settled && courses === null) {
    return { ...pending, loading: !failed };
  }

  const subscribed = scope.length > 0;
  if (subscribed && (sessions === null || recordings === null)) {
    return { ...pending, loading: !failed };
  }

  const out: TodayItem[] = [];

  for (const s of sessions ?? []) {
    if (s.archived) continue;
    const courseName = names.get(s.courseId) ?? '';
    // Days since the meeting: `daysUntilDue` counts whole calendar days
    // between two date-only strings, which is exactly this with the arguments
    // the other way round.
    const met = -daysUntilDue(s.date, today);
    const base = {
      sessionId: s.id,
      courseId: s.courseId,
      courseName,
      title: s.title,
      date: s.date,
    };

    if (s.attendanceSubmittedAt === null && met >= 0) {
      out.push({
        ...base,
        key: `att-${s.id}`,
        kind: 'attendance',
        recordingId: null,
        age: met,
        blocking: true,
        detail:
          met === 0
            ? 'Met today. Nobody has access until attendance is taken.'
            : `Met ${met} ${met === 1 ? 'day' : 'days'} ago. Nobody has access until attendance is taken.`,
      });
      continue;
    }

    const rec = s.recordingId ? (recordings?.get(s.recordingId) ?? null) : null;
    if (!rec) {
      if (met >= 0) {
        out.push({
          ...base,
          key: `rec-${s.id}`,
          kind: 'recording',
          recordingId: null,
          age: met,
          blocking: false,
          detail: 'Attendance is in. The recording has not been added yet.',
        });
      }
      continue;
    }

    /*
     * NOT OUT YET, AND THE THREE REASONS ARE NOT EQUALLY URGENT.
     *
     * A draft and a needs-attention import have granted nobody anything, so
     * they are work without being a lockout. Unpublishing and ARCHIVING both
     * revoke what every excused student already had — the fan-out reads
     * `status === 'published'` and nothing else (`assignmentsFanout.ts`), so the
     * two are identical to a student.
     *
     * Archiving is offered as a terminal filing decision, which is why it is
     * only surfaced WHILE THE DEADLINE IS STILL OPEN: archived after the date,
     * it took away nothing anyone could still use, and nagging about it would
     * make the queue a list of finished terms. Archived before it, students are
     * locked out of listening they are still accountable for, and nothing else
     * on any screen says so.
     */
    const revoked = rec.status === 'unpublished' || rec.status === 'archived';
    const stillOwed = daysUntilDue(s.dueDate, today) >= 0;
    if (rec.status !== 'published' && !(rec.status === 'archived' && !stillOwed)) {
      out.push({
        ...base,
        key: `pub-${s.id}`,
        kind: 'publish',
        recordingId: rec.id,
        age: met,
        blocking: revoked,
        detail:
          rec.status === 'needsAttention'
            ? 'The import needs attention before it can be published.'
            : rec.status === 'unpublished'
              ? 'Unpublished, so nobody excused can open it.'
              : rec.status === 'archived'
                ? 'Archived before its listen-by date, so nobody excused can open it.'
                : 'A draft is waiting to be published.',
      });
      continue;
    }

    if (rec.status === 'published') {
      const left = daysUntilDue(s.dueDate, today);
      if (left >= 0 && left <= DUE_SOON_DAYS) {
        out.push({
          ...base,
          key: `close-${s.id}`,
          kind: 'closing',
          recordingId: rec.id,
          blocking: false,
          // Negative, so a deadline further off sorts below a nearer one under
          // the same descending comparison the overdue rows use.
          age: -left,
          detail:
            left === 0
              ? 'Access closes today. Check who still has not listened.'
              : `Access closes in ${left} ${left === 1 ? 'day' : 'days'}.`,
        });
      }
    }
  }

  out.sort(
    (a, b) => RANK[a.kind] - RANK[b.kind] || b.age - a.age || a.title.localeCompare(b.title),
  );
  return {
    items: out,
    blocking: out.filter((i) => i.blocking).length,
    loading: false,
    failed,
    scoped: subscribed,
    allFinished: !subscribed && (courses ?? []).length > 0,
    truncated,
  };
}
