import type { Role, UserStatus } from './auth';

/**
 * Document shapes. Timestamps are epoch milliseconds everywhere — one
 * representation across client, functions and tests, so nothing has to remember
 * whether a given field is a Firestore Timestamp or a number.
 */

/** A staff member. Document id is the Firebase Auth uid. */
export interface StaffUserDoc {
  displayName: string;
  email: string;
  photoUrl: string | null;
  /** Mirror of the token claim; the token is what rules trust. */
  role: Extract<Role, 'admin' | 'manager'>;
  status: UserStatus;
  createdAt: number;
  approvedAt?: number;
  approvedBy?: string;
}

/** A student. Document id is the Firebase Auth uid. */
export interface StudentDoc {
  displayName: string;
  email: string;
  /**
   * Always 'student'. Present so the mirror carries the same two fields as the
   * token for both populations — the session compares them to detect a token
   * lagging behind an access change, and a missing field there would read as a
   * permanent mismatch and poll forever.
   */
  role: Extract<Role, 'student'>;
  /** Students are never pending — staff creating them is the approval. */
  status: Extract<UserStatus, 'active' | 'disabled'>;
  createdAt: number;
  createdBy: string;
}

export interface CohortDoc {
  name: string;
  /** Manually set when the cohort ends. Archiving cascades to its courses. */
  archived: boolean;
  createdAt: number;
  createdBy: string;
}

export interface CourseDoc {
  cohortId: string;
  name: string;
  /** The class's own state, independent of its cohort's. */
  archived: boolean;
  /**
   * Denormalised: `deriveEffectiveActive(cohort.archived, class.archived)`.
   *
   * Written by a Cloud Function whenever the class or its cohort changes.
   * Security rules cannot import TypeScript, so deriving this in rules would
   * mean a second implementation that drifts from the first. One canonical
   * function, one stored boolean, one cheap read.
   */
  effectiveActive: boolean;
  /**
   * When the class is archived, may students still play its recordings?
   * Defaults to false — archiving turns access off unless staff say otherwise.
   */
  archivedAccess: boolean;
  /**
   * Managers scoped to this class. Denormalised onto the class rather than kept
   * in a separate scopes collection so that a manager's LIST query can be
   * `where('managerUids','array-contains',uid)` — a rule depending on a
   * cross-document get() would force every listing client to carry a matching
   * where clause and cost a read per row.
   */
  managerUids: string[];
  createdAt: number;
  createdBy: string;
}

/**
 * Student membership in a class.
 *
 * Document id is `${studentUid}_${courseId}` so a rule can check membership with
 * a single exists(), and a student can list their own with
 * `where('studentUid','==',uid)` — no cross-document read either way.
 */
export interface EnrollmentDoc {
  studentUid: string;
  courseId: string;
  cohortId: string;
  /**
   * Unenrolling sets this false; it never deletes the row.
   *
   * The brief calls enrollment "membership … over time" and requires that
   * "listening history is preserved across enrollments" — a hard delete would
   * remove the record that history hangs off. Re-enrolling reactivates this same
   * document rather than creating a second one, which the composite id makes
   * automatic.
   */
  active: boolean;
  enrolledAt: number;
  enrolledBy: string;
  /** Set when `active` last became false; left in place on re-enrolment. */
  unenrolledAt?: number;
}

export function enrollmentId(studentUid: string, courseId: string): string {
  return `${studentUid}_${courseId}`;
}

/**
 * A student's attendance for one session.
 *
 * `present` exempts them from the recording (they were there). `absent` and
 * `excused` both make the recording required listening — they missed the
 * content either way — and differ only for attendance reporting.
 */
export type AttendanceStatus = 'present' | 'absent' | 'excused';

/** The two statuses that make a student accountable for the session's recording. */
export function isAccountableAttendance(s: AttendanceStatus): boolean {
  return s === 'absent' || s === 'excused';
}

/**
 * The uids from a session's attendance who must catch up (absent or excused) —
 * the assignment target. Students not in the map (e.g. enrolled after attendance
 * was taken) are intentionally excluded: accountability starts at enrollment.
 */
export function accountableUids(attendance: Record<string, AttendanceStatus>): string[] {
  return Object.entries(attendance)
    .filter(([, s]) => isAccountableAttendance(s))
    .map(([uid]) => uid);
}

/**
 * One dated meeting of a course.
 *
 * The organizing unit under a course: attendance lives here, and a recording
 * (0..1) attaches to it. It exists whether or not it was recorded.
 *
 * `attendance` is the submitted roster SNAPSHOT (present/absent/excused per
 * student). It is what makes obligations attendance-driven AND what implements
 * "accountable from enrollment onward": a student who was not enrolled when
 * attendance was taken is simply not in the map, so is never assigned this
 * session's recording. `attendanceSubmittedAt` is the explicit submit — until it
 * is set, nobody is assigned even if a recording is published. Staff-read only;
 * students never read a session or its attendance.
 */
export interface SessionDoc {
  courseId: string;
  cohortId: string;
  /** The meeting date, date-only `YYYY-MM-DD` in the institute timezone. */
  date: string;
  title: string;
  /** Date-only `YYYY-MM-DD` due date for absentees, or null ("required, never
   *  overdue"). Manual per session. */
  dueDate: string | null;
  /** Shared with everyone who can access the recording — not private staff notes. */
  notes: string;
  /** The session's recording, if one has been added yet. */
  recordingId: string | null;
  attendance: Record<string, AttendanceStatus>;
  /** The explicit-submit marker. Null until attendance is submitted. */
  attendanceSubmittedAt: number | null;
  attendanceSubmittedBy?: string;
  archived: boolean;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
}
