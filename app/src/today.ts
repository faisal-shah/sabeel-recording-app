import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  DUE_SOON_DAYS,
  INSTITUTE_TIMEZONE,
  todayInZone,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';
import { db } from './firebase';
import { useLiveQuery } from './liveQuery';
import { useAllCourses, useMyCourses, type CourseRow } from './structure';

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
}

export interface TodayQueue {
  items: TodayItem[];
  /** Rows that grant nobody anything until they are cleared — the tab's badge. */
  blocking: number;
  /** No snapshot has arrived yet. Distinct from an empty queue, which is news. */
  loading: boolean;
  /** More courses than one `in` clause can carry; the queue is a partial view. */
  truncated: boolean;
}

/**
 * Firestore's `in` takes at most 30 values.
 *
 * An institute past that is past the point where one flat queue is the right
 * screen anyway, so this truncates and says so on the screen rather than
 * paginating a to-do list.
 */
const MAX_SCOPE = 30;

/**
 * How urgent each kind is, before age is considered.
 *
 * ATTENDANCE IS FIRST AND IT IS NOT A CLOSE CALL. Under the excused-only policy
 * an un-taken sheet grants nobody anything, so a whole class is locked out of a
 * published recording with nothing on any screen saying why. Every other row
 * here is work that is visibly outstanding somewhere; this one is work whose
 * absence is invisible.
 */
const RANK: Record<TodayKind, number> = {
  attendance: 0,
  publish: 1,
  recording: 2,
  closing: 3,
};

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The staff work queue, derived — never stored.
 *
 * Every row is computed from sessions and recordings the reader can already
 * see. There is no queue collection, nothing to keep in step with the documents
 * it describes, and no way for it to claim work that is already done: close the
 * gap and the row is gone.
 *
 * LIVE, not a one-shot read, and the badge is why. A count on the tab that is
 * refreshed only on arrival tells you two sessions are blocking access for as
 * long as you stay on the screen where you just fixed both — and a badge that
 * lies about work you have finished is worse than no badge. Two listeners hold
 * the whole thing honest: submit attendance and the row and the count go at the
 * same moment, from whichever screen you are on.
 */
function useTodayQueue(courses: CourseRow[]): TodayQueue {
  /*
   * A STRING FIRST, THE ARRAY FROM IT — not the other way round.
   *
   * `courses` is a new array on every render of the live query that produced
   * it, so it cannot be a subscription input. Sorting the ids into one string
   * gives a stable primitive, and rebuilding the array FROM that string gives a
   * stable array too — which is what lets `exhaustive-deps` check this hook
   * honestly instead of being told to look away. That rule is what mechanically
   * proves every live query resubscribes when its inputs change; silencing it
   * here would cost more than the two lines it saves.
   */
  const key = courses
    .map((c) => c.id)
    .sort()
    .slice(0, MAX_SCOPE)
    .join(',');
  const scope = useMemo(() => (key ? key.split(',') : []), [key]);
  const truncated = courses.length > MAX_SCOPE;

  /*
   * `null` UNTIL THE FIRST SNAPSHOT, deliberately — not an empty array.
   *
   * `useLiveQuery` renders `empty` before anything arrives and again after an
   * error, so an empty array cannot tell "nothing is waiting" from "nothing has
   * come back yet". On this screen those are opposite messages: the first is the
   * most useful thing it can say, and showing it for a beat before the rows
   * appear is a flash of the wrong answer on the app's landing screen.
   */
  const sessions = useLiveQuery<(SessionDoc & { id: string })[] | null>(
    () =>
      scope.length > 0
        ? query(collection(db, COLLECTIONS.sessions), where('courseId', 'in', scope))
        : null,
    [scope],
    {
      label: 'todaySessions',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as SessionDoc) })),
      empty: null,
    },
  );

  const recordings = useLiveQuery<Map<string, RecordingDoc & { id: string }> | null>(
    () =>
      scope.length > 0
        ? query(collection(db, COLLECTIONS.recordings), where('courseId', 'in', scope))
        : null,
    [scope],
    {
      label: 'todayRecordings',
      map: (snap) =>
        new Map(snap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as RecordingDoc) }])),
      empty: null,
    },
  );

  const names = useMemo(() => new Map(courses.map((c) => [c.id, c.name])), [courses]);

  return useMemo(() => {
    // Nothing subscribed is not the same as nothing loaded: a manager assigned
    // no courses has an answer already, and it is "nothing is waiting".
    const subscribed = scope.length > 0;
    if (subscribed && (sessions === null || recordings === null)) {
      return { items: [], blocking: 0, loading: true, truncated };
    }

    const today = todayInZone(INSTITUTE_TIMEZONE);
    const out: TodayItem[] = [];

    for (const s of sessions ?? []) {
      if (s.archived) continue;
      const courseName = names.get(s.courseId) ?? '';
      const met = daysBetween(s.date, today);
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
            detail: 'Attendance is in. The recording has not been added yet.',
          });
        }
        continue;
      }

      if (rec.status === 'needsAttention' || rec.status === 'draft') {
        out.push({
          ...base,
          key: `pub-${s.id}`,
          kind: 'publish',
          recordingId: rec.id,
          age: met,
          detail:
            rec.status === 'needsAttention'
              ? 'The import needs attention before it can be published.'
              : 'A draft is waiting to be published.',
        });
        continue;
      }

      if (rec.status === 'published') {
        const left = daysBetween(today, s.dueDate);
        if (left >= 0 && left <= DUE_SOON_DAYS) {
          out.push({
            ...base,
            key: `close-${s.id}`,
            kind: 'closing',
            recordingId: rec.id,
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
      blocking: out.filter((i) => i.kind === 'attendance').length,
      loading: false,
      truncated,
    };
  }, [sessions, recordings, names, truncated, scope]);
}

/**
 * The queue for whoever is signed in — subscribed ONCE, at the app shell.
 *
 * The tab's badge and the screen itself must never disagree, and the cheapest
 * way to guarantee that is for there to be one subscription rather than two
 * that happen to run the same query. The shell holds it and hands it down; the
 * Today screen renders it and does no fetching of its own.
 *
 * A STUDENT SUBSCRIBES TO NOTHING. Sessions are staff-only in the rules, so a
 * student running this would raise a permission denial per listener from their
 * own home screen — the exact shape of the bug the shared-device route tables
 * exist to prevent. Both course queries are gated, so their scope is empty and
 * no listener is ever opened.
 */
export function useStaffQueue(isStaff: boolean, isAdmin: boolean, uid: string): TodayQueue {
  const all = useAllCourses(isStaff && isAdmin);
  const mine = useMyCourses(isStaff && !isAdmin ? uid : null);
  return useTodayQueue(isAdmin ? all : mine);
}
