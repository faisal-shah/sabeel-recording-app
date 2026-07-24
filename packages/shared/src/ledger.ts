/**
 * The accountability ledger — pure shaping and counting over the Phase 4 data.
 *
 * No Firestore here: the staff ledger reads assignments + completions +
 * overrides + progress live in the app and computes everything with these
 * functions, so the counts can be unit-tested at the day boundary without an
 * emulator. Same discipline as `assignments.ts`, whose `dueBucket`/`isOverdue`
 * this reuses rather than re-deriving.
 */
import { dueBucket, isOverdue, type DueBucket } from './assignments';
import { attendanceGroups, type AttendanceStatus } from './types';

/**
 * A staff override of a student's completion — separate from the student's own
 * completion doc so the student can never touch it. Server-written only.
 */
export interface CompletionOverrideDoc {
  studentUid: string;
  recordingId: string;
  courseId: string;
  completed: boolean;
  /** Required — the brief allows an override only WITH a recorded reason. */
  reason: string;
  overriddenBy: string;
  at: number;
}

export function overrideId(studentUid: string, recordingId: string): string {
  return `${studentUid}_${recordingId}`;
}

/**
 * The completion the ledger acts on: a staff override wins over the student's
 * self-attestation; absent both, it is simply not complete.
 */
export interface EffectiveCompletion {
  completed: boolean;
  source: 'override' | 'student' | 'none';
  /** Present only when an override is in effect. */
  reason?: string;
}

export function effectiveCompletion(
  student: { completed: boolean } | undefined | null,
  override: { completed: boolean; reason: string } | undefined | null,
): EffectiveCompletion {
  if (override) return { completed: override.completed, source: 'override', reason: override.reason };
  if (student) return { completed: student.completed, source: 'student' };
  return { completed: false, source: 'none' };
}

/** Counts for a class-level / recording-level rollup. */
export interface LedgerRollup {
  total: number;
  complete: number;
  incomplete: number;
  overdue: number;
}

/**
 * Tally a set of obligations by effective completion and due state.
 *
 * `incomplete` is everything not (effectively) complete; `overdue` is the subset
 * of those past their due date — so an overdue item is always also incomplete.
 * A completed item is never overdue, however far past its due date.
 */
export function rollup(
  items: { completed: boolean; dueDate: string | null }[],
  today: string,
): LedgerRollup {
  let complete = 0;
  let overdue = 0;
  for (const it of items) {
    if (it.completed) complete++;
    else if (isOverdue(it.dueDate, today)) overdue++;
  }
  return {
    total: items.length,
    complete,
    incomplete: items.length - complete,
    overdue,
  };
}

/** The ledger row's status bucket, reusing the student-home classification. */
export function ledgerBucket(
  dueDate: string | null,
  completed: boolean,
  today: string,
): DueBucket {
  return dueBucket({ dueDate, completed }, today);
}

// ------------------------------------------------------- attendance report ---
// A course's attendance rolled up two ways — per session and per student — plus
// each student's catch-up progress on the recordings they were accountable for.
// Pure, so the whole report is unit-testable at the day boundary.

/** One session's row in the per-session summary. */
export interface SessionAttendanceRow {
  sessionId: string;
  title: string;
  date: string;
  /** false ⇒ attendance was never taken for this session (nobody accountable). */
  submitted: boolean;
  present: number;
  absent: number;
  excused: number;
}

/** One student's row: attendance tally across submitted sessions + catch-up. */
export interface StudentAttendanceRow {
  studentUid: string;
  present: number;
  absent: number;
  excused: number;
  /** Submitted sessions the student was not in the snapshot for (enrolled later). */
  notMarked: number;
  /** Recordings the student is accountable for (active assignments in the course). */
  assigned: number;
  /** …of which effectively complete. */
  completed: number;
  /** …of which incomplete and past due. */
  overdue: number;
}

export interface AttendanceReport {
  sessions: SessionAttendanceRow[];
  students: StudentAttendanceRow[];
  totalSessions: number;
  sessionsWithAttendance: number;
}

/**
 * Aggregate a course's attendance.
 *
 * `sessions` are all the course's sessions; `rosterUids` the active enrollment;
 * `assignments` the active catch-up obligations (one per accountable
 * student×recording) already reduced to their effective completion. Only
 * SUBMITTED sessions count toward a student's present/absent/excused tally — an
 * un-taken session marks nobody. Catch-up is grouped from the assignments, so it
 * counts exactly the recordings that exist and are required.
 */
export function attendanceReport(input: {
  sessions: {
    id: string;
    title: string;
    date: string;
    attendance: Record<string, AttendanceStatus>;
    attendanceSubmittedAt: number | null;
  }[];
  rosterUids: string[];
  assignments: { studentUid: string; completed: boolean; dueDate: string | null }[];
  today: string;
}): AttendanceReport {
  const { sessions, rosterUids, assignments, today } = input;

  const sessionRows: SessionAttendanceRow[] = sessions.map((s) => {
    const submitted = s.attendanceSubmittedAt !== null;
    // Only a submitted roster is real; an un-taken session counts nobody.
    const g = attendanceGroups(submitted ? s.attendance : {});
    return {
      sessionId: s.id,
      title: s.title,
      date: s.date,
      submitted,
      present: g.present.length,
      absent: g.absent.length,
      excused: g.excused.length,
    };
  });

  const submitted = sessions.filter((s) => s.attendanceSubmittedAt !== null);

  // Catch-up grouped per student from the active assignments.
  const catchUp = new Map<string, { assigned: number; completed: number; overdue: number }>();
  for (const a of assignments) {
    const c = catchUp.get(a.studentUid) ?? { assigned: 0, completed: 0, overdue: 0 };
    c.assigned++;
    if (a.completed) c.completed++;
    else if (isOverdue(a.dueDate, today)) c.overdue++;
    catchUp.set(a.studentUid, c);
  }

  const studentRows: StudentAttendanceRow[] = rosterUids.map((uid) => {
    let present = 0;
    let absent = 0;
    let excused = 0;
    let notMarked = 0;
    for (const s of submitted) {
      const st = s.attendance[uid];
      if (st === 'present') present++;
      else if (st === 'absent') absent++;
      else if (st === 'excused') excused++;
      else notMarked++;
    }
    const c = catchUp.get(uid) ?? { assigned: 0, completed: 0, overdue: 0 };
    return { studentUid: uid, present, absent, excused, notMarked, ...c };
  });

  return {
    sessions: sessionRows,
    students: studentRows,
    totalSessions: sessions.length,
    sessionsWithAttendance: submitted.length,
  };
}
