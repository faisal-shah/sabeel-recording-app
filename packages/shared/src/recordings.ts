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

/**
 * The audio artifact of a session — media, lifecycle, and the student-facing
 * display copy of its session.
 *
 * The `SessionDoc` is the source of truth for the meeting metadata (and owns the
 * private attendance map). But students CANNOT read sessions — that is what keeps
 * attendance private — so the display fields a student needs to see what they are
 * listening to (`title`, `notes`, `date`) are denormalized here, on the
 * published recording they are allowed to read. `dueDate` is likewise
 * denormalized onto the student's own assignment. Staff edit the session; the
 * create/update-session paths keep these copies in sync. `courseId`/`cohortId`
 * are denormalized too, for queries and the assignment fan-out.
 */
export interface RecordingDoc {
  sessionId: string;
  courseId: string;
  cohortId: string;
  /** Denormalized from the session (source of truth) so students can display it. */
  title: string;
  notes: string;
  /** The session's meeting date, `YYYY-MM-DD`. Denormalized for student display. */
  date: string;
  status: RecordingStatus;
  source: RecordingSource;
  /** Set by finalizeRecordingUpload once audio is actually in Storage. */
  audioPath: string | null;
  durationSec: number | null;
  sizeBytes: number | null;
  /** Why it needs attention. Present only while status is needsAttention. */
  attentionReason?: string;
  /**
   * Zoom source refs, present only when `source === 'zoom'`. `zoomUuid` (the Zoom
   * meeting UUID) is the dedupe key — one Zoom recording maps to at most one app
   * recording. `zoomFileId` identifies the audio-only file so a failed import can
   * be retried without re-listing.
   */
  zoomUuid?: string;
  zoomFileId?: string;
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

export type PublishBlocker = 'audio' | 'status';

/**
 * What still stands between a recording and being published.
 *
 * Returns the reasons rather than a boolean so the UI can say which is missing
 * instead of leaving a disabled button unexplained. The title now lives on the
 * session (which always has one), so only audio + a legal transition are checked.
 */
export function publishBlockers(recording: {
  audioPath: string | null;
  status: RecordingStatus;
}): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  // Publishing without audio would put a row in every student's list that plays
  // nothing — the one failure a student cannot work around.
  if (!recording.audioPath) blockers.push('audio');
  if (!canTransition(recording.status, 'published')) blockers.push('status');
  return blockers;
}

export function canPublish(recording: {
  audioPath: string | null;
  status: RecordingStatus;
}): boolean {
  return publishBlockers(recording).length === 0;
}

/**
 * A recording that holds nothing yet: no audio, and not live.
 *
 * Such a recording provably has NO dependent history — `publishBlockers` refuses
 * to publish without audio, and assignments only fan out once published — so
 * there is no completion, progress or assignment doc that could point at it.
 * That is what makes discarding one non-destructive, and why it does not need
 * the admin-only guard that permanent deletion otherwise carries: whoever had
 * the course scope to create it may discard it.
 *
 * Also what the UI keys "needs audio" off: this is a normal, recoverable state
 * (a just-created draft mid-upload, an upload that failed, audio removed for
 * replacement), not an error.
 */
export function isEmptyDraft(recording: {
  audioPath: string | null;
  status: RecordingStatus;
}): boolean {
  return (
    recording.audioPath === null &&
    (recording.status === 'draft' || recording.status === 'needsAttention')
  );
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
  courseId: string;
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
