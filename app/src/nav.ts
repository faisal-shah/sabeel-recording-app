import type { RecordingRow } from './recordings';
import type { CourseRow, CohortRow } from './structure';

/** Routes reachable once signed in and active. Gate screens are not routes —
 *  they replace the whole navigator, so a gated account cannot be deep-linked
 *  past. */
export type RootStackParamList = {
  Home: undefined;
  Staff: undefined;
  Students: undefined;
  Cohorts: undefined;
  Coursees: { cohort: CohortRow };
  CourseDetail: { cls: CourseRow };
  Recordings: { cls: CourseRow };
  RecordingLedger: { recording: RecordingRow; cls: CourseRow };
  StudentLedger: { studentUid: string; studentName: string; cls: CourseRow };
  Library: undefined;
  ZoomImport: undefined;
  Audit: { courseId: string | null; title: string };
  MyRecordings: undefined;
  Player: { recording: RecordingRow; cls: CourseRow };
  MyCoursees: undefined;
  Tokens: undefined;
};
