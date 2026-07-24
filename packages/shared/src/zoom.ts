/**
 * A Zoom cloud recording (audio-only) as the import picker sees it — shared so
 * the callable's return type and the screen's row type cannot drift.
 */
export interface ZoomImportRow {
  meetingUuid: string;
  topic: string;
  startTime: string; // ISO 8601
  durationSec: number;
  fileId: string;
  sizeBytes: number;
  /** Existing recording id if already imported, else null. */
  alreadyImported: string | null;
}
