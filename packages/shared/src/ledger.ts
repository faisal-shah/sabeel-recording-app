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

/**
 * A staff override of a student's completion — separate from the student's own
 * completion doc so the student can never touch it. Server-written only.
 */
export interface CompletionOverrideDoc {
  studentUid: string;
  recordingId: string;
  classId: string;
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
