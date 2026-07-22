/**
 * Recording lifecycle.
 *
 * The states and the legal moves between them come straight from the diagram in
 * docs/PRODUCT_BRIEF.md § Recording lifecycle. Kept pure so every transition can
 * be tested without an emulator, and so the client and the callables cannot
 * disagree about what is allowed.
 */
export type RecordingStatus =
  | 'draft'
  | 'published'
  | 'archived'
  | 'unpublished'
  | 'needsAttention';

/** Where the audio came from. Zoom import arrives in Phase 6. */
export type RecordingSource = 'manual' | 'zoom';

export interface RecordingDoc {
  cohortId: string;
  classId: string;
  title: string;
  status: RecordingStatus;
  source: RecordingSource;
  /** When the class was recorded. From Zoom when available; staff-set otherwise. */
  recordedAt: number | null;
  /**
   * Date-only (`YYYY-MM-DD`) in the institute timezone, or null.
   *
   * Null means "required, but never overdue" — the brief is explicit that a
   * no-due assignment is still required listening. It does not mean optional.
   */
  dueDate: string | null;
  /** Shared with everyone who can access the recording — NOT private staff notes. */
  notes: string;
  /** Set by finalizeRecordingUpload once audio is actually in Storage. */
  audioPath: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
  /** Why it needs attention. Present only while status is needsAttention. */
  attentionReason?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  publishedAt?: number;
}

/**
 * Legal status moves, exactly as the brief's diagram draws them.
 *
 * Two shapes worth noticing, because both are deliberate and look like
 * omissions:
 *
 *  - `unpublished` goes back to `draft`, never straight to `published`. Bringing
 *    a withdrawn recording back forces a trip through the metadata gate, which
 *    is the point — it was withdrawn for a reason.
 *  - `archived` returns to `published` directly, because archiving is a
 *    filing decision rather than a correction.
 */
const TRANSITIONS: Record<RecordingStatus, readonly RecordingStatus[]> = {
  // A fresh upload, or a failed import that staff have retried.
  draft: ['published', 'needsAttention'],
  published: ['archived', 'unpublished'],
  archived: ['published'],
  unpublished: ['draft'],
  needsAttention: ['draft'],
};

export function canTransition(from: RecordingStatus, to: RecordingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** The moves available from a state — drives which buttons a screen offers. */
export function allowedTransitions(from: RecordingStatus): readonly RecordingStatus[] {
  return TRANSITIONS[from] ?? [];
}

export type PublishBlocker = 'title' | 'audio' | 'status';

/**
 * What still stands between a recording and being published.
 *
 * Returns the reasons rather than a boolean so the UI can say which field is
 * missing instead of leaving a disabled button unexplained. Cohort and class are
 * not checked: a recording cannot be created without them.
 *
 * Due date and notes are deliberately absent — the brief marks both optional.
 */
export function publishBlockers(recording: {
  title: string;
  audioPath: string | null;
  status: RecordingStatus;
}): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (!recording.title.trim()) blockers.push('title');
  // Publishing without audio would put a row in every student's list that plays
  // nothing — the one failure a student cannot work around.
  if (!recording.audioPath) blockers.push('audio');
  if (!canTransition(recording.status, 'published')) blockers.push('status');
  return blockers;
}

export function canPublish(recording: {
  title: string;
  audioPath: string | null;
  status: RecordingStatus;
}): boolean {
  return publishBlockers(recording).length === 0;
}

/** Students only ever see published recordings. */
export function isVisibleToStudents(status: RecordingStatus): boolean {
  return status === 'published';
}

/** Storage object path for a recording's audio. One definition, used by the
 *  upload client, the rules tests and the signing callable. */
export function audioStoragePath(recordingId: string): string {
  return `recordings/${recordingId}/audio.m4a`;
}

/**
 * A student's position in one recording.
 *
 * Document id is `${studentUid}_${recordingId}`, so resume is a single get and
 * the rules can check ownership without reading anything else.
 *
 * Written by the CLIENT rather than a callable, which is a deliberate departure
 * from this codebase's "all mutation through callables" rule. A callable every
 * fifteen seconds per listening student is pure overhead, and the stakes are
 * low: listened time is audit evidence, not the gate. Completion is
 * student-attested and blocked only if they never played, so inflating this
 * gains nothing that letting the audio run would not.
 */
export interface ListeningProgressDoc {
  studentUid: string;
  recordingId: string;
  classId: string;
  /** Where to resume from. */
  positionMs: number;
  /** Total time actually listened, which is NOT the same as position — seeking
   *  forward must not manufacture listening that did not happen. */
  listenedMs: number;
  updatedAt: number;
}

export function progressId(studentUid: string, recordingId: string): string {
  return `${studentUid}_${recordingId}`;
}

/** How often progress is persisted while audio is playing. */
export const PROGRESS_WRITE_INTERVAL_MS = 15_000;

/**
 * Merge a local progress reading with whatever the server already has.
 *
 * Two devices, or one device after a reinstall, will disagree. The rule is
 * **max listened, latest position wins**: total listening only ever grows,
 * while position follows whichever device reported most recently — that is the
 * one the person is actually using.
 */
export function mergeProgress(
  a: Pick<ListeningProgressDoc, 'positionMs' | 'listenedMs' | 'updatedAt'>,
  b: Pick<ListeningProgressDoc, 'positionMs' | 'listenedMs' | 'updatedAt'>,
): Pick<ListeningProgressDoc, 'positionMs' | 'listenedMs' | 'updatedAt'> {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  return {
    positionMs: newer.positionMs,
    listenedMs: Math.max(a.listenedMs, b.listenedMs),
    updatedAt: newer.updatedAt,
  };
}

/** Fraction listened, for a progress bar. Guards a missing or zero duration so
 *  a recording with no duration renders an empty bar rather than NaN. */
export function listenedFraction(listenedMs: number, durationSec: number | null): number {
  if (!durationSec || durationSec <= 0) return 0;
  return Math.min(1, listenedMs / (durationSec * 1000));
}
