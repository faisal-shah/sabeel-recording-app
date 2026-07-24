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
