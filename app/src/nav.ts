import type { RecordingRow } from './recordings';
import type { SessionRow } from './sessions';
import type { CourseRow, CohortRow } from './structure';

/** Routes reachable once signed in and active. Gate screens are not routes —
 *  they replace the whole navigator, so a gated account cannot be deep-linked
 *  past. */
export type RootStackParamList = {
  Home: undefined;
  Staff: undefined;
  Students: undefined;
  /** By uid: the screen reads the student live, and their courses depend on who
   *  is looking (an admin queries; a manager walks their own courses). */
  StudentDetail: { studentUid: string };
  Cohorts: undefined;
  Courses: { cohort: CohortRow };
  CourseDetail: { cls: CourseRow };
  CourseAttendance: { cls: CourseRow };
  Sessions: { cls: CourseRow };
  /** By id, not by document: the screen re-reads the session live, so a snapshot
   *  in the params would only ever be a staler copy of what it already has — and
   *  carrying the id lets any screen that knows one (the attendance report) open
   *  it. */
  SessionDetail: { sessionId: string; cls: CourseRow };
  RecordingLedger: { recording: RecordingRow; session: SessionRow; cls: CourseRow };
  StudentLedger: { studentUid: string; studentName: string; cls: CourseRow };
  Library: undefined;
  ZoomImport: { session: SessionRow; cls: CourseRow };
  Audit: { courseId: string | null; title: string };
  MyRecordings: undefined;
  /** dueDate is passed by the caller: the session's for staff, the student's own
   *  assignment for students, or null when browsing something not assigned. */
  Player: { recording: RecordingRow; cls: CourseRow; dueDate?: string | null };
  MyCourses: undefined;
  Tokens: undefined;
};
