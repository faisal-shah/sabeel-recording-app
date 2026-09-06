import { useMemo } from 'react';
import { collection, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  INSTITUTE_TIMEZONE,
  QUEUE_SCOPE,
  todayInZone,
  type RecordingDoc,
  type SessionDoc,
} from '@sabeel/shared';
// The queue's vocabulary, re-exported so a screen has one import for the hook
// and the shapes it returns. `buildTodayQueue` itself is not: its callers are
// this file and its own test, and both name the module it lives in.
export { KIND_ORDER, type TodayItem, type TodayKind, type TodayQueue } from './todayQueue';
import { buildTodayQueue, type TodayQueue } from './todayQueue';
import { db } from './firebase';
import { useListenerFailed, useLiveQuery } from './liveQuery';
import { useAllCoursesState, useMyCoursesState, type CourseRow } from './structure';


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
function useTodayQueue(
  courses: CourseRow[] | null,
  max: number,
  /** See `buildTodayQueue`: "nothing will ever be subscribed", not "loaded". */
  settled: boolean,
): TodayQueue {
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
  /*
   * FINISHED COURSES ARE NOT WORK — and `effectiveActive` is the field that
   * says so, not `archived`.
   *
   * `archived` is a course's OWN flag. A term ends by archiving the COHORT, and
   * that cascade deliberately never touches it — it sets `effectiveActive`. So
   * reading `archived` meant every course of every past term stayed in the
   * queue for ever, producing rows nobody is waiting on and spending the scope
   * budget that live courses need. Every other "is this course live" test in
   * the app already uses the derived flag.
   */
  const live = (courses ?? []).filter((c) => c.effectiveActive);
  const key = live
    .map((c) => c.id)
    .sort()
    .slice(0, max)
    .join(',');
  const scope = useMemo(() => (key ? key.split(',') : []), [key]);
  const truncated = live.length > max;

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

  // A refused listener leaves both queries on their `empty` value for ever, and
  // `empty` is the same `null` that means "nothing has arrived yet" — so without
  // this the landing screen sits on "Checking your courses…" with no way out.
  //
  // THESE TWO LABELS, not the app-wide signal: another screen's denial must not
  // make this one claim it could not read the courses, and this one's denial
  // must not clear because something unrelated recovered.
  //
  // Spelled out rather than referenced from the calls above, because
  // `firestoreIndexes.test.ts` parses `label:` out of every `useLiveQuery` call
  // site and a computed one is a call site it cannot read — a guard that stops
  // seeing a query is worse than the duplication. They are twenty lines apart.
  // All four, not just the two this hook subscribes itself. The first guard
  // below waits on `courses`, which comes from `allCourses`/`myCourses` — so a
  // refusal THERE left `courses` null, `failed` false, and the landing screen
  // on "Checking your courses…" for good: the exact failure this reports.
  const failed = useListenerFailed([
    'todaySessions',
    'todayRecordings',
    'allCourses',
    'myCourses',
  ]);

  // OUTSIDE the memo: a browser left open past midnight would otherwise keep
  // saying "Met today" until the next snapshot happened to arrive.
  const today = todayInZone(INSTITUTE_TIMEZONE);

  return useMemo(
    () =>
      buildTodayQueue({ courses, sessions, recordings, scope, today, failed, settled, truncated }),
    [courses, sessions, recordings, scope, today, failed, settled, truncated],
  );
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
  // SCOPED, for the same reason the docked bar's listeners are: this one is
  // mounted by the SHELL and outlives every screen, while five screens mount the
  // same query under the same label. Unscoped, navigating away from one of them
  // deletes the shell's error entry — and `useListenerFailed` below then goes
  // false with `courses` still null, so the landing screen falls back from
  // "Could not read your courses" to "Checking your courses…" for good.
  const all = useAllCoursesState(isStaff && isAdmin, 'todayQueue');
  const mine = useMyCoursesState(isStaff && !isAdmin ? uid : null, 'todayQueue');
  const courses = isAdmin ? all : mine;
  return useTodayQueue(
    courses,
    isAdmin ? QUEUE_SCOPE.admin : QUEUE_SCOPE.manager,
    // A student subscribes to nothing, so "no courses" is their settled answer
    // rather than one still arriving.
    !isStaff,
  );
}
