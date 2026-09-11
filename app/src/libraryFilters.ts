/**
 * The recording library's cohort and course filters — the pure part.
 *
 * Two dropdowns above the list, and one rule between them: the cohort narrows
 * the course list, never the other way round. Choose a cohort and leave the
 * course alone and you see everything in that term; choose a course as well
 * and you see that course; clear both and you are back to the whole library.
 * Kept out of the screen so the rule can be tested without a renderer, and so
 * the admin's flat list and the manager's per-course sections apply the SAME
 * scope — the manager's sections and the admin's rows both go through
 * `inScope`.
 *
 * `''` means "any". A real Firestore id can never be empty, and the web
 * `<select>` needs a string value for its "All …" row.
 */
import type { SelectOption } from './components/Select';

export const ANY = '';

export interface LibraryScope {
  cohortId: string;
  courseId: string;
}

export const WHOLE_LIBRARY: LibraryScope = { cohortId: ANY, courseId: ANY };

interface CohortLike {
  id: string;
  name: string;
  archived: boolean;
}

interface CourseLike {
  id: string;
  name: string;
  cohortId: string;
}

/**
 * The cohorts worth offering: those with at least one course the reader can
 * see, in the order the cohort list already has them (newest first). A cohort
 * with nothing in it filters to an empty page, and for a manager that is every
 * cohort but their own. An archived term is still offered — the library is
 * where an archived recording is found — and says so.
 */
export function cohortOptions(cohorts: readonly CohortLike[], courses: readonly CourseLike[]): SelectOption[] {
  const held = new Set(courses.map((c) => c.cohortId));
  return [
    { value: ANY, label: 'All cohorts' },
    ...cohorts
      .filter((c) => held.has(c.id))
      .map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name })),
  ];
}

/**
 * The courses to choose from: every course in the chosen cohort, or — with no
 * cohort chosen — every course there is, each carrying its cohort's name, since
 * the same course name recurs term after term. By name, because that is how a
 * person looks for one.
 */
export function courseOptions(
  courses: readonly CourseLike[],
  cohortId: string,
  cohortNameOf: (cohortId: string) => string,
): SelectOption[] {
  const inCohort = cohortId === ANY ? courses : courses.filter((c) => c.cohortId === cohortId);
  return [
    { value: ANY, label: 'All courses' },
    ...[...inCohort]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => {
        const cohortName = cohortId === ANY ? cohortNameOf(c.cohortId) : '';
        return { value: c.id, label: cohortName ? `${c.name} · ${cohortName}` : c.name };
      }),
  ];
}

/**
 * Choose a cohort, keeping the course only if it is in that cohort.
 *
 * Without this a course chosen under "All cohorts" would survive a cohort pick
 * it does not belong to, and the two dropdowns would together describe an empty
 * set that neither of them shows.
 */
export function pickCohort(
  scope: LibraryScope,
  cohortId: string,
  courses: readonly CourseLike[],
): LibraryScope {
  const course = courses.find((c) => c.id === scope.courseId);
  const keep = cohortId === ANY || course?.cohortId === cohortId;
  return { cohortId, courseId: keep ? scope.courseId : ANY };
}

/** Whether a recording falls inside the chosen scope. A course asks the same
 *  question of itself as `{ cohortId, courseId: id }`. */
export function inScope(row: { cohortId: string; courseId: string }, scope: LibraryScope): boolean {
  return (
    (scope.cohortId === ANY || row.cohortId === scope.cohortId) &&
    (scope.courseId === ANY || row.courseId === scope.courseId)
  );
}

/** Whether anything is narrowing the library — the one condition the clear
 *  control appears on, so it is never a dead button. */
export function isNarrowed(status: string, scope: LibraryScope): boolean {
  return status !== 'all' || scope.cohortId !== ANY || scope.courseId !== ANY;
}
