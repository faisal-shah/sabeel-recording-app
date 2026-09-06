import { useMemo } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  AUDIT_PAGE,
  COLLECTIONS,
  attendanceGroups,
  attendanceReport,
  effectiveCompletion,
  listenedFraction,
  rollup,
  type AssignmentDoc,
  type AttendanceReport,
  type AttendanceStatus,
  type AuditEntryDoc,
  type CompletionDoc,
  type CompletionOverrideDoc,
  type LedgerRollup,
  type ListeningProgressDoc,
} from '@sabeel/shared';
import { db, functions } from './firebase';
import { useListenerFailed, useLiveQuery } from './liveQuery';
import { useStudents } from './students';
import { useCourseSessions } from './sessions';
import { useRoster } from './structure';
import type { RecordingRow } from './recordings';
import type { SessionRow } from './sessions';

// --------------------------------------------------------------- callables --

const call = <I,>(name: string) => (input: I) =>
  httpsCallable(functions, name)(input).then(() => undefined);

export const overrideCompletion = call<{
  studentUid: string;
  recordingId: string;
  completed: boolean;
  reason: string;
}>('overrideCompletion');

export const clearCompletionOverride = call<{
  studentUid: string;
  recordingId: string;
  reason: string;
}>('clearCompletionOverride');

// ------------------------------------------------------- per-recording reads --
//
// EVERY staff read here MUST pin `courseId`, and being "class-scoped by nature"
// is not the same thing. The staff arm of these collections resolves
// `get(/courses/$(resource.data.courseId))`, and Firestore evaluates a `list`
// rule against the QUERY's constraints, not only against the documents it would
// return: unless the query pins `courseId`, that path is unresolvable and the
// listen is refused outright — even when it would have returned nothing.
//
// A `recordingId ==` filter does not pin it. One recording does belong to one
// class, but Firestore cannot know that, so it cannot collapse the lookup. That
// mistake shipped: the recording ledger read `recordingId ==` alone, and every
// one of its four listeners was denied for every MANAGER on every recording,
// while admins saw nothing wrong (their arm reads no documents and depends on no
// `resource.data`). See the shape assertions in rules.ledger.test.ts.

function useScopedMap<T, V>(
  label: string,
  coll: string,
  /** The course scope the rules require. Null until it is known. */
  courseId: string | null,
  /** Narrows the course scope to one recording; null reads the whole course. */
  recordingId: string | null,
  pick: (data: T, pending: boolean) => V,
  keyOf: (data: T) => string,
  metadata = false,
) {
  return useLiveQuery<Map<string, V>>(
    () =>
      courseId
        ? query(
            collection(db, coll),
            where('courseId', '==', courseId),
            ...(recordingId ? [where('recordingId', '==', recordingId)] : []),
          )
        : null,
    // coll is a constant at every call site today, so listing it changes nothing
    // at runtime — but the query reads it, and a wrapper whose dep list quietly
    // under-reports its inputs is how a subscription ends up serving another
    // collection's data after a refactor.
    [courseId, recordingId, coll],
    {
      label: label,
      map: (snap) => {
        const m = new Map<string, V>();
        for (const d of snap.docs) m.set(keyOf(d.data() as T), pick(d.data() as T, d.metadata.hasPendingWrites));
        return m;
      },
      empty: new Map(),
      includeMetadataChanges: metadata,
    },
  );
}

/**
 * The one-of-three filter both ledgers offer, and its words.
 *
 * ONE DECLARATION, because the two screens are the same question asked of a
 * recording and of a student, and the pair had drifted before: a label spelled
 * in a ternary on each screen, with the note "the same order as the recording
 * ledger's" standing in for anything that would notice if it stopped being.
 *
 * "Missed", never "overdue": once the deadline passes access has closed, so the
 * work is not still outstanding. The word matches the course detail, the
 * student's own home and the CSV export.
 */
export type LedgerFilter = 'all' | 'notComplete' | 'missed';

export const LEDGER_FILTERS: { value: LedgerFilter; label: string }[] = [
  { value: 'notComplete', label: 'Not complete' },
  { value: 'missed', label: 'Missed' },
  { value: 'all', label: 'All' },
];

export interface LedgerRow {
  studentUid: string;
  name: string;
  /** Null for everyone without a grant — attendees, absentees, other listeners. */
  dueDate: string | null;
  completed: boolean;
  source: 'override' | 'student' | 'none';
  overrideReason?: string;
  listenedPct: number;
  lastListened: number | null;
  completedAt: number | null;
  pending: boolean;
  /** How the session recorded this student: 'excused' for the accountable set,
   *  'present'/'absent' for the rest of the roster, null for someone outside the
   *  snapshot. */
  attendance: AttendanceStatus | null;
}

/** An accountable row always came from a grant, so it always has a deadline. */
export type RequiredRow = LedgerRow & { dueDate: string };

export interface RecordingLedger {
  /**
   * No grant snapshot has arrived yet — so every group below is provisional.
   *
   * Distinct from "nobody holds this recording", which is news and is what the
   * screen says when this is false and `accountable` is empty.
   */
  loading: boolean;
  /** Excused, so granted the recording and required to listen — the only people
   *  who can open it at all. */
  accountable: RequiredRow[];
  /** Present at the session: nothing required, and no access either. */
  attendees: LedgerRow[];
  /** Absent without being excused: nothing required, and no access. Listed so a
   *  ledger still accounts for the whole submitted roster. */
  absentees: LedgerRow[];
  /** Excused at the session but holding no active grant — unenrolled from the
   *  class, or the recording was unpublished. Both deactivate every assignment
   *  while the attendance marks stay, so without this group they would appear in
   *  no section at all. */
  lapsed: LedgerRow[];
  /** Listened without holding a current grant — e.g. excused, listened, then
   *  corrected to present. Evidence, not accountability. */
  otherListeners: LedgerRow[];
  rollup: LedgerRollup;
}

/**
 * The recording ledger: the granted roster joined with completion, override, and
 * listening progress, split against the session's attendance into the excused
 * (who owe it), the present and the absent (who do not, and cannot open it), and
 * the excused whose grant has since lapsed. Every uid the session recorded lands
 * in exactly one group, which is what lets the screen claim to account for the
 * whole submitted roster. Every read is `courseId == && recordingId ==` — the
 * course scope is what the staff rules require, not an optimisation (see the
 * note on useScopedMap); the join and the counts are pure.
 */
export function useRecordingLedger(
  recording: RecordingRow,
  session: SessionRow,
  today: string,
): RecordingLedger {
  const rid = recording.id;
  // The course scope every read below carries — see the note on useScopedMap.
  const cid = recording.courseId;
  /*
   * `null` UNTIL THE FIRST SNAPSHOT — not an empty Map.
   *
   * THE GRANTS ARE WHAT THIS SCREEN IS. `accountable` is built from them and
   * `lapsed` is everyone excused who is NOT in them, so an empty Map standing in
   * for "nothing has arrived yet" does not read as a blank screen: it reads as
   * `Required 0 / Completed 0 / Missed 0`, "Nobody holds this recording now —
   * every grant from this session has lapsed", and an "Excused, access closed"
   * section naming the whole class and explaining they were unenrolled or the
   * recording was pulled. A confident, fully-formed, wrong answer, shown for the
   * length of every cold load on the one screen staff consult to decide who to
   * chase.
   */
  const assignments = useLiveQuery<Map<string, AssignmentDoc> | null>(
    () =>
      query(
        collection(db, COLLECTIONS.assignments),
        where('courseId', '==', cid),
        where('recordingId', '==', rid),
        where('active', '==', true),
      ),
    [cid, rid],
    {
      label: 'ledgerAssignments',
      map: (snap) => new Map(snap.docs.map((d) => [(d.data() as AssignmentDoc).studentUid, d.data() as AssignmentDoc])),
      empty: null,
    },
  );
  const completions = useScopedMap<CompletionDoc, { completed: boolean; completedAt: number | null; pending: boolean }>(
    'ledgerCompletions',
    COLLECTIONS.completions,
    cid,
    rid,
    (d, pending) => ({ completed: d.completed, completedAt: d.completedAt, pending }),
    (d) => d.studentUid,
    true,
  );
  const overrides = useScopedMap<CompletionOverrideDoc, CompletionOverrideDoc>(
    'ledgerOverrides',
    COLLECTIONS.completionOverrides,
    cid,
    rid,
    (d) => d,
    (d) => d.studentUid,
  );
  const progress = useScopedMap<ListeningProgressDoc, { listenedMs: number; updatedAt: number }>(
    'ledgerProgress',
    COLLECTIONS.listeningProgress,
    cid,
    rid,
    (d) => ({ listenedMs: d.listenedMs, updatedAt: d.updatedAt }),
    (d) => d.studentUid,
  );
  const students = useStudents(true);
  const nameByUid = useMemo(() => new Map(students.map((s) => [s.uid, s.displayName])), [students]);
  // The four listeners this join reads. Matched on the LABEL, so a refusal on
  // any of them ends the loading state rather than leaving it for ever.
  const failed = useListenerFailed([
    'ledgerAssignments',
    'ledgerCompletions',
    'ledgerOverrides',
    'ledgerProgress',
  ]);

  return useMemo(() => {
    const row = (
      studentUid: string,
      dueDate: string | null,
      attendance: AttendanceStatus | null,
    ): LedgerRow => {
      const c = completions.get(studentUid);
      const o = overrides.get(studentUid);
      const eff = effectiveCompletion(c, o);
      const p = progress.get(studentUid);
      return {
        studentUid,
        name: nameByUid.get(studentUid) ?? studentUid,
        dueDate,
        completed: eff.completed,
        source: eff.source,
        overrideReason: eff.reason,
        listenedPct: p ? listenedFraction(p.listenedMs, recording.durationSec) : 0,
        lastListened: p?.updatedAt ?? null,
        completedAt: c?.completedAt ?? null,
        pending: c?.pending ?? false,
        attendance,
      };
    };

    // A REFUSAL IS NOT A LOAD. `useLiveQuery` resets to `empty` on a listener
    // error as well as before the first snapshot, and `empty` here is the same
    // null — so a manager removed from the class mid-view would sit on
    // "Checking who holds this recording…" for ever. `today.ts` carries the same
    // guard for the same reason.
    const loading = assignments === null && !failed;
    const granted = assignments ?? new Map<string, AssignmentDoc>();
    const status = session.attendance;
    // Re-stating dueDate after the spread is what narrows the row to a
    // RequiredRow: the grant it came from always carries one.
    const accountable: RequiredRow[] = [...granted.values()]
      .map((a) => ({ ...row(a.studentUid, a.dueDate, status[a.studentUid] ?? 'excused'), dueDate: a.dueDate }))
      // Not-yet-complete first, then by name. Every row here is excused, so
      // there is no longer a second attendance status to order within.
      .sort((x, y) => Number(x.completed) - Number(y.completed) || x.name.localeCompare(y.name));

    const { present, absent, excused } = attendanceGroups(status);
    const byName = (x: LedgerRow, y: LedgerRow) => x.name.localeCompare(y.name);
    const attendees = present.map((uid) => row(uid, null, 'present')).sort(byName);
    const absentees = absent.map((uid) => row(uid, null, 'absent')).sort(byName);
    // Excused, but the grant that came with it is no longer active. `accountable`
    // reads only ACTIVE assignments, so unenrolling a student or unpublishing the
    // recording drops them out of it while the session still says they were
    // excused — and they belong to neither present nor absent.
    // EMPTY UNTIL THE GRANTS ARRIVE. Both this group and `otherListeners` are
    // defined by ABSENCE from `granted`, so before the first snapshot they are
    // "everyone" — and each carries a notice stating a cause ("unenrolled, or
    // this recording was unpublished") that has not happened. A section that is
    // briefly missing is a loading screen; a section that briefly accuses the
    // whole class of having lost access is not.
    const lapsed = loading
      ? []
      : excused
          .filter((uid) => !granted.has(uid))
          .map((uid) => row(uid, null, 'excused'))
          .sort(byName);

    // Anyone with real listening/completion who holds no current grant and is
    // not in the snapshot — e.g. excused and listening, then corrected out.
    const known = new Set<string>([...granted.keys(), ...present, ...absent, ...excused]);
    const otherUids = new Set<string>();
    for (const [uid, c] of completions.entries()) if (c.completed && !known.has(uid)) otherUids.add(uid);
    for (const uid of progress.keys()) if (!known.has(uid)) otherUids.add(uid);
    const otherListeners = loading ? [] : [...otherUids].map((uid) => row(uid, null, null));

    return {
      loading,
      accountable,
      attendees,
      absentees,
      lapsed,
      otherListeners,
      rollup: rollup(
        accountable.map((r) => ({ completed: r.completed, dueDate: r.dueDate })),
        today,
      ),
    };
  }, [assignments, failed, completions, overrides, progress, nameByUid, recording.durationSec, session.attendance, today]);
}

// ------------------------------------------------------------ class-level ---

export interface CourseAssignmentItem {
  studentUid: string;
  recordingId: string;
  completed: boolean;
  dueDate: string;
}

export interface CourseLedger {
  /** rollup across every active assignment in the class. */
  rollup: LedgerRollup;
  /** per-recording { complete, total } for the recordings list. */
  byRecording: Map<string, { complete: number; total: number }>;
  /** every active assignment reduced to its effective completion (for the report). */
  items: CourseAssignmentItem[];
}

/**
 * Course-level counts: every active assignment in the class, its effective
 * completion, rolled up whole-class and per-recording. `courseId ==` reads.
 */
export function useCourseLedger(courseId: string | null, today: string): CourseLedger {
  const assignments = useLiveQuery<AssignmentDoc[]>(
    () =>
      courseId
        ? query(
            collection(db, COLLECTIONS.assignments),
            where('courseId', '==', courseId),
            where('active', '==', true),
          )
        : null,
    [courseId],
    {
      label: 'courseLedgerAssignments',
      map: (snap) => snap.docs.map((d) => d.data() as AssignmentDoc),
      empty: [],
    },
  );
  const completions = useScopedMap<CompletionDoc, boolean>(
    'courseLedgerCompletions',
    COLLECTIONS.completions,
    courseId,
    null,
    (d) => d.completed,
    (d) => `${d.studentUid}_${d.recordingId}`,
  );
  const overrides = useScopedMap<CompletionOverrideDoc, CompletionOverrideDoc>(
    'courseLedgerOverrides',
    COLLECTIONS.completionOverrides,
    courseId,
    null,
    (d) => d,
    (d) => `${d.studentUid}_${d.recordingId}`,
  );

  return useMemo(() => {
    const items: CourseAssignmentItem[] = assignments.map((a) => {
      const key = `${a.studentUid}_${a.recordingId}`;
      const c = completions.get(key);
      const eff = effectiveCompletion(c === undefined ? undefined : { completed: c }, overrides.get(key));
      return { studentUid: a.studentUid, recordingId: a.recordingId, completed: eff.completed, dueDate: a.dueDate };
    });
    const byRecording = new Map<string, { complete: number; total: number }>();
    for (const it of items) {
      const cur = byRecording.get(it.recordingId) ?? { complete: 0, total: 0 };
      cur.total++;
      if (it.completed) cur.complete++;
      byRecording.set(it.recordingId, cur);
    }
    return { rollup: rollup(items, today), byRecording, items };
  }, [assignments, completions, overrides, today]);
}

// --------------------------------------------------------- attendance report --

/**
 * A course's attendance report: sessions + roster + the active catch-up
 * assignments, aggregated by the pure `attendanceReport`. Composes existing
 * live reads (no new listener shapes), so the security rules already cover it.
 */
export function useCourseAttendance(courseId: string | null, today: string): AttendanceReport {
  const sessions = useCourseSessions(courseId);
  const roster = useRoster(courseId);
  const { items } = useCourseLedger(courseId, today);

  return useMemo(
    () =>
      attendanceReport({
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          date: s.date,
          attendance: s.attendance,
          attendanceSubmittedAt: s.attendanceSubmittedAt,
        })),
        rosterUids: roster.filter((e) => e.active).map((e) => e.studentUid),
        assignments: items.map((i) => ({ studentUid: i.studentUid, completed: i.completed, dueDate: i.dueDate })),
        today,
      }),
    [sessions, roster, items, today],
  );
}

// -------------------------------------------------------------- student ledger --

export interface StudentLedgerItem {
  recordingId: string;
  dueDate: string;
  completed: boolean;
  source: 'override' | 'student' | 'none';
  overrideReason?: string;
}

/**
 * One student's obligations in one class. Reads are `studentUid == uid &&
 * courseId == X` — two equalities, class-scoped, so the staff rules accept them.
 * The screen supplies recording titles from `useCourseRecordings`.
 */
export function useStudentLedger(studentUid: string | null, courseId: string): StudentLedgerItem[] {
  const assignments = useLiveQuery<AssignmentDoc[]>(
    () =>
      studentUid
        ? query(
            collection(db, COLLECTIONS.assignments),
            where('studentUid', '==', studentUid),
            where('courseId', '==', courseId),
          )
        : null,
    [studentUid, courseId],
    {
      label: 'studentLedgerAssignments',
      map: (snap) => snap.docs.map((d) => d.data() as AssignmentDoc).filter((a) => a.active),
      empty: [],
    },
  );
  const completions = useStudentCourseMap<CompletionDoc, boolean>(
    'studentLedgerCompletions',
    COLLECTIONS.completions,
    studentUid,
    courseId,
    (d) => d.completed,
  );
  const overrides = useStudentCourseMap<CompletionOverrideDoc, CompletionOverrideDoc>(
    'studentLedgerOverrides',
    COLLECTIONS.completionOverrides,
    studentUid,
    courseId,
    (d) => d,
  );

  return useMemo(
    () =>
      assignments.map((a) => {
        const c = completions.get(a.recordingId);
        const eff = effectiveCompletion(c === undefined ? undefined : { completed: c }, overrides.get(a.recordingId));
        return {
          recordingId: a.recordingId,
          dueDate: a.dueDate,
          completed: eff.completed,
          source: eff.source,
          overrideReason: eff.reason,
        };
      }),
    [assignments, completions, overrides],
  );
}

function useStudentCourseMap<T extends { recordingId: string }, V>(
  label: string,
  coll: string,
  studentUid: string | null,
  courseId: string,
  pick: (data: T) => V,
) {
  return useLiveQuery<Map<string, V>>(
    () =>
      studentUid
        ? query(
            collection(db, coll),
            where('studentUid', '==', studentUid),
            where('courseId', '==', courseId),
          )
        : null,
    // `coll` for the same reason as useScopedMap: the query reads it.
    [studentUid, courseId, coll],
    {
      label: label,
      map: (snap) => new Map(snap.docs.map((d) => [(d.data() as T).recordingId, pick(d.data() as T)])),
      empty: new Map(),
    },
  );
}

// --------------------------------------------------------------- audit read --

export interface AuditRow extends AuditEntryDoc {
  id: string;
}

/**
 * The audit log, newest first. A manager passes their courseId (scoped read); an
 * admin passes null for the unconstrained global view.
 */
export function useAudit(courseId: string | null, enabled = true): AuditRow[] {
  return useLiveQuery<AuditRow[]>(
    () =>
      !enabled
        ? null
        : courseId === null
          ? query(collection(db, COLLECTIONS.auditLog), orderBy('at', 'desc'), limit(AUDIT_PAGE))
          : query(
              collection(db, COLLECTIONS.auditLog),
              where('courseId', '==', courseId),
              orderBy('at', 'desc'),
              limit(AUDIT_PAGE),
            ),
    [courseId, enabled],
    {
      label: 'audit',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as AuditEntryDoc) })),
      empty: [],
    },
  );
}
