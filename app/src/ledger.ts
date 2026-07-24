import { useMemo } from 'react';
import { collection, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  effectiveCompletion,
  listenedFraction,
  rollup,
  type AssignmentDoc,
  type AuditEntryDoc,
  type CompletionDoc,
  type CompletionOverrideDoc,
  type LedgerRollup,
  type ListeningProgressDoc,
} from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveQuery } from './liveQuery';
import { useStudents } from './students';
import type { RecordingRow } from './recordings';

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
    label,
    () => (value ? query(collection(db, coll), where(field, '==', value)) : null),
    (snap) => {
      const m = new Map<string, V>();
      for (const d of snap.docs) m.set(keyOf(d.data() as T), pick(d.data() as T, d.metadata.hasPendingWrites));
      return m;
    },
    new Map(),
    [value],
    metadata,
  );
}

export interface LedgerRow {
  studentUid: string;
  name: string;
  dueDate: string | null;
  completed: boolean;
  source: 'override' | 'student' | 'none';
  overrideReason?: string;
  listenedPct: number;
  lastListened: number | null;
  completedAt: number | null;
  pending: boolean;
}

export interface RecordingLedger {
  /** Students accountable for this recording (an active assignment). */
  accountable: LedgerRow[];
  /** Completed it without being assigned — evidence, not accountability. */
  notRequired: LedgerRow[];
  rollup: LedgerRollup;
}

/**
 * The recording ledger: the accountable roster joined with completion,
 * override, and listening progress. All reads are `recordingId ==`, so the
 * staff rules accept them class-scoped; the join and the counts are pure.
 */
export function useRecordingLedger(recording: RecordingRow, today: string): RecordingLedger {
  const rid = recording.id;
  const assignments = useLiveQuery<Map<string, AssignmentDoc>>(
    'ledgerAssignments',
    () =>
      query(
        collection(db, COLLECTIONS.assignments),
        where('recordingId', '==', rid),
        where('active', '==', true),
      ),
    (snap) => new Map(snap.docs.map((d) => [(d.data() as AssignmentDoc).studentUid, d.data() as AssignmentDoc])),
    new Map(),
    [rid],
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
    const row = (studentUid: string, dueDate: string | null): LedgerRow => {
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
      };
    };

    const accountable = [...assignments.values()]
      .map((a) => row(a.studentUid, a.dueDate))
      .sort((x, y) => Number(x.completed) - Number(y.completed) || x.name.localeCompare(y.name));

    const assignedUids = new Set(assignments.keys());
    const notRequired = [...completions.entries()]
      .filter(([uid, c]) => c.completed && !assignedUids.has(uid))
      .map(([uid]) => row(uid, null));

    return {
      accountable,
      notRequired,
      rollup: rollup(
        accountable.map((r) => ({ completed: r.completed, dueDate: r.dueDate })),
        today,
      ),
    };
  }, [assignments, completions, overrides, progress, nameByUid, recording.durationSec, today]);
}

// ------------------------------------------------------------ class-level ---

export interface CourseLedger {
  /** rollup across every active assignment in the class. */
  rollup: LedgerRollup;
  /** per-recording { complete, total } for the recordings list. */
  byRecording: Map<string, { complete: number; total: number }>;
}

/**
 * Course-level counts: every active assignment in the class, its effective
 * completion, rolled up whole-class and per-recording. `courseId ==` reads.
 */
export function useCourseLedger(courseId: string | null, today: string): CourseLedger {
  const assignments = useLiveQuery<AssignmentDoc[]>(
    'courseLedgerAssignments',
    () =>
      courseId
        ? query(
            collection(db, COLLECTIONS.assignments),
            where('courseId', '==', courseId),
            where('active', '==', true),
          )
        : null,
    (snap) => snap.docs.map((d) => d.data() as AssignmentDoc),
    [],
    [courseId],
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
    const items = assignments.map((a) => {
      const key = `${a.studentUid}_${a.recordingId}`;
      const c = completions.get(key);
      const eff = effectiveCompletion(c === undefined ? undefined : { completed: c }, overrides.get(key));
      return { recordingId: a.recordingId, completed: eff.completed, dueDate: a.dueDate };
    });
    const byRecording = new Map<string, { complete: number; total: number }>();
    for (const it of items) {
      const cur = byRecording.get(it.recordingId) ?? { complete: 0, total: 0 };
      cur.total++;
      if (it.completed) cur.complete++;
      byRecording.set(it.recordingId, cur);
    }
    return { rollup: rollup(items, today), byRecording };
  }, [assignments, completions, overrides, today]);
}

// -------------------------------------------------------------- student ledger --

export interface StudentLedgerItem {
  recordingId: string;
  dueDate: string | null;
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
    'studentLedgerAssignments',
    () =>
      studentUid
        ? query(
            collection(db, COLLECTIONS.assignments),
            where('studentUid', '==', studentUid),
            where('courseId', '==', courseId),
          )
        : null,
    (snap) => snap.docs.map((d) => d.data() as AssignmentDoc).filter((a) => a.active),
    [],
    [studentUid, courseId],
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
    label,
    () =>
      studentUid
        ? query(
            collection(db, coll),
            where('studentUid', '==', studentUid),
            where('courseId', '==', courseId),
          )
        : null,
    (snap) => new Map(snap.docs.map((d) => [(d.data() as T).recordingId, pick(d.data() as T)])),
    new Map(),
    [studentUid, courseId],
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
    'audit',
    () =>
      courseId === null
        ? query(collection(db, COLLECTIONS.auditLog), orderBy('at', 'desc'))
        : query(
            collection(db, COLLECTIONS.auditLog),
            where('courseId', '==', courseId),
            orderBy('at', 'desc'),
          ),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as AuditEntryDoc) })),
    [],
    [courseId],
  );
}
