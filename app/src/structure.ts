import { useMemo } from 'react';
import { collection, doc, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type CourseDoc,
  type CohortDoc,
  type EnrollmentDoc,
} from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveDocState, useLiveQuery } from './liveQuery';

export interface CohortRow extends CohortDoc {
  id: string;
}
export interface CourseRow extends CourseDoc {
  id: string;
}

export interface EnrollmentRow extends EnrollmentDoc {
  id: string;
}

/**
 * Staff-only: a `cohortId -> name` resolver, for disambiguating a class name in
 * cross-cohort views (the same class name recurs across cohorts). Cohorts are
 * not student-readable, so this only works on staff screens.
 */
export function useCohortName(enabled = true): (cohortId: string) => string {
  const cohorts = useCohorts(enabled);
  return useMemo(() => {
    const byId = new Map(cohorts.map((c) => [c.id, c.name]));
    return (cohortId: string) => byId.get(cohortId) ?? '';
  }, [cohorts]);
}

/**
 * One cohort, live — a DOCUMENT listener, so it is a `get` rather than a list.
 *
 * The cohort screen edits the cohort it displays (archive/reactivate), so it
 * must not render from the navigation param it arrived with: that is a copy
 * frozen at the tap, and a control that both renders and computes its next
 * value from a frozen copy never appears to work. See useCourse.
 *
 * Returns `resolved` too: the cohort screen is reachable by URL, so it has to be
 * able to tell "still loading" from "no such cohort".
 */
export function useCohortState(cohortId: string | null) {
  return useLiveDocState<CohortRow | null>(
    () => (cohortId ? doc(db, COLLECTIONS.cohorts, cohortId) : null),
    [cohortId],
    {
      label: 'cohort',
      map: (snap) => ({ id: snap.id, ...(snap.data() as CohortDoc) }),
      empty: null,
    },
  );
}

export function useCohorts(enabled: boolean): CohortRow[] {
  return useLiveQuery<CohortRow[]>(
    () =>
      enabled
        ? query(collection(db, COLLECTIONS.cohorts), orderBy('createdAt', 'desc'))
        : null,
    [enabled],
    {
      label: 'cohorts',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as CohortDoc) })),
      empty: [],
    },
  );
}

/** Every class in a cohort. Admin-only: the rule has no scoped arm for this shape. */
export function useCoursesInCohort(cohortId: string | null): CourseRow[] {
  return useLiveQuery<CourseRow[]>(
    () =>
      cohortId
        ? query(
            collection(db, COLLECTIONS.courses),
            where('cohortId', '==', cohortId),
            orderBy('createdAt', 'asc'),
          )
        : null,
    [cohortId],
    {
      label: 'coursesInCohort',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as CourseDoc) })),
      empty: [],
    },
  );
}

/**
 * One course, live — a DOCUMENT listener, which is what makes it usable by
 * everyone who needs it.
 *
 * It must not be a `where('__name__','==',id)` query: that is a LIST, and the
 * courses rule grants students `get` without `list`. The player and the course
 * screens are reached by staff AND students, so a list here fails closed on a
 * student — an empty screen and a console warning, not an error anyone notices.
 * The e2e caught exactly that.
 *
 * The screens that EDIT a course also read it through this, so none of them
 * renders from the navigation param it arrived with — a copy frozen at the tap,
 * which is how the manager toggles came to do nothing.
 */
export function useCourse(courseId: string | null): CourseRow | null {
  return useCourseState(courseId).value;
}

/** As useCourse, plus whether the listener has answered — for a screen resolving
 *  a course from a URL, which must be able to say "no such course". */
export function useCourseState(courseId: string | null) {
  return useLiveDocState<CourseRow | null>(
    () => (courseId ? doc(db, COLLECTIONS.courses, courseId) : null),
    [courseId],
    {
      label: 'course',
      map: (snap) => ({ id: snap.id, ...(snap.data() as CourseDoc) }),
      empty: null,
    },
  );
}

/**
 * Every class in every cohort, oldest first — ADMIN ONLY.
 *
 * The rules' admin arm lists the whole `courses` collection without a per-row
 * read (a manager must go cohort by cohort). Used where the admin needs courses
 * across cohorts at once: the cohort class-counts and the student-enrolment
 * picker. Single-field `createdAt` order needs no composite index.
 */
export function useAllCourses(enabled: boolean): CourseRow[] {
  return useLiveQuery<CourseRow[]>(
    () =>
      enabled
        ? query(collection(db, COLLECTIONS.courses), orderBy('createdAt', 'asc'))
        : null,
    [enabled],
    {
      label: 'allCourses',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as CourseDoc) })),
      empty: [],
    },
  );
}

/**
 * The courses a manager is scoped to.
 *
 * The `array-contains` constraint is not a convenience — the security rule's
 * manager arm reads `resource.data.managerUids`, so Firestore rejects this
 * query without it. Dropping the constraint does not widen the results; it
 * fails the query outright.
 */
export function useMyCourses(uid: string | null): CourseRow[] {
  return useLiveQuery<CourseRow[]>(
    () =>
      uid
        ? query(collection(db, COLLECTIONS.courses), where('managerUids', 'array-contains', uid))
        : null,
    [uid],
    {
      label: 'myCourses',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as CourseDoc) })),
      empty: [],
    },
  );
}

/**
 * A class roster.
 *
 * Constrained to one courseId, which is also what makes the rule affordable:
 * its staff arm resolves a class lookup per row, and only a single-class query
 * lets that resolve one cached path.
 */
export function useRoster(courseId: string | null): EnrollmentRow[] {
  return useLiveQuery<EnrollmentRow[]>(
    () =>
      courseId
        ? query(collection(db, COLLECTIONS.enrollments), where('courseId', '==', courseId))
        : null,
    [courseId],
    {
      label: 'roster',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as EnrollmentDoc) })),
      empty: [],
    },
  );
}


/**
 * Every enrollment of one student, across courses. Must carry the studentUid
 * constraint — the rule depends on resource.data, so Firestore rejects an
 * unconstrained list.
 *
 * Legal for the STUDENT THEMSELVES and for an ADMIN, and for nobody else. Both
 * satisfy the enrollments rule with zero document reads. A manager does not:
 * their arm resolves a course get() per row, so this query denies the moment the
 * student is in a course they do not run, and blows the per-query
 * document-access cap even when they run them all. A manager who needs this
 * inverts the loop — see StudentDetailScreen.
 */
export function useStudentEnrollments(uid: string | null): EnrollmentRow[] {
  return useLiveQuery<EnrollmentRow[]>(
    () =>
      uid
        ? query(collection(db, COLLECTIONS.enrollments), where('studentUid', '==', uid))
        : null,
    [uid],
    {
      label: 'studentEnrollments',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as EnrollmentDoc) })),
      empty: [],
    },
  );
}

const call = <T,>(name: string) => (input: T) => httpsCallable(functions, name)(input).then(() => undefined);

export const createCohort = call<{ name: string }>('createCohort');
export const setCohortArchived = call<{ cohortId: string; archived: boolean }>('setCohortArchived');
export const createCourse = call<{ cohortId: string; name: string }>('createCourse');
export const updateCourse =
  call<{ courseId: string; name?: string; archived?: boolean; archivedAccess?: boolean }>('updateCourse');
export const setCourseManagers = call<{ courseId: string; managerUids: string[] }>('setCourseManagers');
export const createEnrollment = call<{ studentUid: string; courseId: string }>('createEnrollment');
export const setEnrollmentActive =
  call<{ studentUid: string; courseId: string; active: boolean }>('setEnrollmentActive');
