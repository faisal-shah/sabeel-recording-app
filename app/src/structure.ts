import { useMemo } from 'react';
import { collection, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type ClassDoc,
  type CohortDoc,
  type EnrollmentDoc,
} from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveQuery } from './liveQuery';

export interface CohortRow extends CohortDoc {
  id: string;
}
export interface ClassRow extends ClassDoc {
  id: string;
}

/** Load one class by id (for opening a recording's class directly). */
export async function loadClass(id: string): Promise<ClassRow | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.classes, id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as ClassDoc) } : null;
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

export function useCohorts(enabled: boolean): CohortRow[] {
  return useLiveQuery<CohortRow[]>(
    'cohorts',
    () =>
      enabled
        ? query(collection(db, COLLECTIONS.cohorts), orderBy('createdAt', 'desc'))
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as CohortDoc) })),
    [],
    [enabled],
  );
}

/** Every class in a cohort. Admin-only: the rule has no scoped arm for this shape. */
export function useClassesInCohort(cohortId: string | null): ClassRow[] {
  return useLiveQuery<ClassRow[]>(
    'classesInCohort',
    () =>
      cohortId
        ? query(
            collection(db, COLLECTIONS.classes),
            where('cohortId', '==', cohortId),
            orderBy('createdAt', 'asc'),
          )
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClassDoc) })),
    [],
    [cohortId],
  );
}

/**
 * Every class in every cohort, oldest first — ADMIN ONLY.
 *
 * The rules' admin arm lists the whole `classes` collection without a per-row
 * read (a manager must go cohort by cohort). Used where the admin needs classes
 * across cohorts at once: the cohort class-counts and the student-enrolment
 * picker. Single-field `createdAt` order needs no composite index.
 */
export function useAllClasses(enabled: boolean): ClassRow[] {
  return useLiveQuery<ClassRow[]>(
    'allClasses',
    () =>
      enabled
        ? query(collection(db, COLLECTIONS.classes), orderBy('createdAt', 'asc'))
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClassDoc) })),
    [],
    [enabled],
  );
}

/**
 * The classes a manager is scoped to.
 *
 * The `array-contains` constraint is not a convenience — the security rule's
 * manager arm reads `resource.data.managerUids`, so Firestore rejects this
 * query without it. Dropping the constraint does not widen the results; it
 * fails the query outright.
 */
export function useMyClasses(uid: string | null): ClassRow[] {
  return useLiveQuery<ClassRow[]>(
    'myClasses',
    () =>
      uid
        ? query(collection(db, COLLECTIONS.classes), where('managerUids', 'array-contains', uid))
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClassDoc) })),
    [],
    [uid],
  );
}

/**
 * A class roster.
 *
 * Constrained to one classId, which is also what makes the rule affordable:
 * its staff arm resolves a class lookup per row, and only a single-class query
 * lets that resolve one cached path.
 */
export function useRoster(classId: string | null): EnrollmentRow[] {
  return useLiveQuery<EnrollmentRow[]>(
    'roster',
    () =>
      classId
        ? query(collection(db, COLLECTIONS.enrollments), where('classId', '==', classId))
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as EnrollmentDoc) })),
    [],
    [classId],
  );
}


/**
 * A student's own enrollments. Must carry the studentUid constraint — the rule
 * depends on resource.data, so Firestore rejects an unconstrained list.
 */
export function useMyEnrollments(uid: string | null): EnrollmentRow[] {
  return useLiveQuery<EnrollmentRow[]>(
    'myEnrollments',
    () =>
      uid
        ? query(collection(db, COLLECTIONS.enrollments), where('studentUid', '==', uid))
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as EnrollmentDoc) })),
    [],
    [uid],
  );
}

const call = <T,>(name: string) => (input: T) => httpsCallable(functions, name)(input).then(() => undefined);

export const createCohort = call<{ name: string }>('createCohort');
export const setCohortArchived = call<{ cohortId: string; archived: boolean }>('setCohortArchived');
export const createClass = call<{ cohortId: string; name: string }>('createClass');
export const updateClass =
  call<{ classId: string; name?: string; archived?: boolean; archivedAccess?: boolean }>('updateClass');
export const setClassManagers = call<{ classId: string; managerUids: string[] }>('setClassManagers');
export const createEnrollment = call<{ studentUid: string; classId: string }>('createEnrollment');
export const setEnrollmentActive =
  call<{ studentUid: string; classId: string; active: boolean }>('setEnrollmentActive');
