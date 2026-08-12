/**
 * Routes reachable once signed in and active. Gate screens are not routes —
 * they replace the whole navigator, so a gated account cannot be deep-linked
 * past.
 *
 * EVERY PARAM IS AN ID OR A PLAIN STRING, and must stay that way. React
 * Navigation builds the browser URL from these with `String(value)`, so a
 * document param becomes literally `[object Object]` in the address bar and
 * comes back as that string on reload — which is why Back exited the site
 * instead of going anywhere until this was fixed (see the linking config in
 * App.tsx). Documents are resolved from these ids in the App.tsx wrappers,
 * live, which also means no screen can render from a frozen copy of something
 * it edits.
 */
export type RootStackParamList = {
  Home: undefined;
  Staff: undefined;
  Students: undefined;
  /** The screen reads the student live, and their courses depend on who is
   *  looking (an admin queries; a manager walks their own courses). */
  StudentDetail: { studentUid: string };
  Cohorts: undefined;
  /** A cohort: its settings and the courses in it. */
  Courses: { cohortId: string };
  CourseDetail: { courseId: string };
  CourseAttendance: { courseId: string };
  Sessions: { courseId: string };
  /** courseId rides along so the header can name the course without waiting on
   *  the session to load first. */
  SessionDetail: { sessionId: string; courseId: string };
  /** The recording knows its own session and course, so one id is enough. */
  RecordingLedger: { recordingId: string };
  StudentLedger: { studentUid: string; courseId: string };
  Library: undefined;
  ZoomImport: { sessionId: string };
  /** Omit courseId for the admin's unscoped view; a manager passes their own. */
  Audit: { courseId?: string };
  MyRecordings: undefined;
  /** dueDate is passed by the caller: the session's for staff, the student's own
   *  assignment for students, or absent when browsing something not assigned. */
  Player: { recordingId: string; dueDate?: string | null };
  MyCourses: undefined;
  Tokens: undefined;
};
