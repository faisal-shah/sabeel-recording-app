import type { RecordingRow } from './recordings';
import type { ClassRow, CohortRow } from './structure';

/** Routes reachable once signed in and active. Gate screens are not routes —
 *  they replace the whole navigator, so a gated account cannot be deep-linked
 *  past. */
export type RootStackParamList = {
  Home: undefined;
  Staff: undefined;
  Students: undefined;
  Cohorts: undefined;
  Classes: { cohort: CohortRow };
  ClassDetail: { cls: ClassRow };
  Recordings: { cls: ClassRow };
  RecordingLedger: { recording: RecordingRow; cls: ClassRow };
  StudentLedger: { studentUid: string; studentName: string; cls: ClassRow };
  Library: undefined;
  Audit: { classId: string | null; title: string };
  MyRecordings: undefined;
  Player: { recording: RecordingRow; cls: ClassRow };
  MyClasses: undefined;
  Tokens: undefined;
};
