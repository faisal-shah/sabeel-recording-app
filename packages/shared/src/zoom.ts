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
  /**
   * Existing recording id if already imported, else null.
   *
   * Both a flag and a destination: the picker filters on it and the row it
   * renders is tappable through to that recording, which is what the brief
   * promises an already-imported row does.
   */
  alreadyImported: string | null;
  /** When already imported: the class it went into, for the row's sentence. */
  importedCourseName: string | null;
}
