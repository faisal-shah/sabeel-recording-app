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
