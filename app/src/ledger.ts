import { useMemo } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
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
import { useLiveQuery } from './liveQuery';
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
// Each is class-scoped by nature (one recording belongs to one class), so the
// staff rules accept the `recordingId ==` query.

function useMapByStudent<T, V>(
  label: string,
  coll: string,
  field: 'recordingId' | 'courseId',
  value: string | null,
  pick: (data: T, pending: boolean) => V,
  keyOf: (data: T) => string,
  metadata = false,
) {
  return useLiveQuery<Map<string, V>>(
    () => (value ? query(collection(db, coll), where(field, '==', value)) : null),
    // coll and field are constants at every call site today, so listing them
    // changes nothing at runtime — but the query reads them, and a wrapper whose
    // dep list quietly under-reports its inputs is how a subscription ends up
    // serving another collection's data after a refactor.
    [value, coll, field],
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
 * whole submitted roster. All reads are `recordingId ==`, so the staff rules
 * accept them class-scoped; the join and the counts are pure.
 */
export function useRecordingLedger(
  recording: RecordingRow,
  session: SessionRow,
  today: string,
): RecordingLedger {
  const rid = recording.id;
  const assignments = useLiveQuery<Map<string, AssignmentDoc>>(
    () =>
      query(
        collection(db, COLLECTIONS.assignments),
        where('recordingId', '==', rid),
        where('active', '==', true),
      ),
    [rid],
    {
      label: 'ledgerAssignments',
      map: (snap) => new Map(snap.docs.map((d) => [(d.data() as AssignmentDoc).studentUid, d.data() as AssignmentDoc])),
      empty: new Map(),
    },
  );
  const completions = useMapByStudent<CompletionDoc, { completed: boolean; completedAt: number | null; pending: boolean }>(
    'ledgerCompletions',
    COLLECTIONS.completions,
    'recordingId',
    rid,
    (d, pending) => ({ completed: d.completed, completedAt: d.completedAt, pending }),
    (d) => d.studentUid,
    true,
  );
  const overrides = useMapByStudent<CompletionOverrideDoc, CompletionOverrideDoc>(
    'ledgerOverrides',
    COLLECTIONS.completionOverrides,
    'recordingId',
    rid,
    (d) => d,
    (d) => d.studentUid,
  );
  const progress = useMapByStudent<ListeningProgressDoc, { listenedMs: number; updatedAt: number }>(
    'ledgerProgress',
    COLLECTIONS.listeningProgress,
    'recordingId',
    rid,
    (d) => ({ listenedMs: d.listenedMs, updatedAt: d.updatedAt }),
    (d) => d.studentUid,
  );
  const students = useStudents(true);
  const nameByUid = useMemo(() => new Map(students.map((s) => [s.uid, s.displayName])), [students]);

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

    const status = session.attendance;
    // Re-stating dueDate after the spread is what narrows the row to a
    // RequiredRow: the grant it came from always carries one.
    const accountable: RequiredRow[] = [...assignments.values()]
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
    const lapsed = excused
      .filter((uid) => !assignments.has(uid))
      .map((uid) => row(uid, null, 'excused'))
      .sort(byName);

    // Anyone with real listening/completion who holds no current grant and is
    // not in the snapshot — e.g. excused and listening, then corrected out.
    const known = new Set<string>([...assignments.keys(), ...present, ...absent, ...excused]);
    const otherUids = new Set<string>();
    for (const [uid, c] of completions.entries()) if (c.completed && !known.has(uid)) otherUids.add(uid);
    for (const uid of progress.keys()) if (!known.has(uid)) otherUids.add(uid);
    const otherListeners = [...otherUids].map((uid) => row(uid, null, null));

    return {
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
  }, [assignments, completions, overrides, progress, nameByUid, recording.durationSec, session.attendance, today]);
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
  const completions = useMapByStudent<CompletionDoc, boolean>(
    'courseLedgerCompletions',
    COLLECTIONS.completions,
    'courseId',
    courseId,
    (d) => d.completed,
    (d) => `${d.studentUid}_${d.recordingId}`,
  );
  const overrides = useMapByStudent<CompletionOverrideDoc, CompletionOverrideDoc>(
    'courseLedgerOverrides',
    COLLECTIONS.completionOverrides,
    'courseId',
    courseId,
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
    // `coll` for the same reason as useMapByStudent: the query reads it.
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
export function useAudit(courseId: string | null): AuditRow[] {
  return useLiveQuery<AuditRow[]>(
    () =>
      courseId === null
        ? query(collection(db, COLLECTIONS.auditLog), orderBy('at', 'desc'))
        : query(
            collection(db, COLLECTIONS.auditLog),
            where('courseId', '==', courseId),
            orderBy('at', 'desc'),
          ),
    [courseId],
    {
      label: 'audit',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as AuditEntryDoc) })),
      empty: [],
    },
  );
}
