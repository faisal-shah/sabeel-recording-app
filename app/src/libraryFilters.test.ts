import { describe, expect, it } from 'vitest';
import {
  ANY,
  WHOLE_LIBRARY,
  cohortOptions,
  courseOptions,
  inScope,
  isNarrowed,
  pickCohort,
} from './libraryFilters';

/**
 * The promise: choose a cohort and leave the course alone and you see that
 * cohort's recordings; choose a course as well and you see that course's;
 * clear and you see everything. Every case below is asserted on WHICH
 * RECORDINGS SURVIVE the scope, because that is what a person sees — not on
 * the scope object, which is the mechanism.
 */
const cohorts = [
  { id: 'spring27', name: 'Spring 2027', archived: false },
  { id: 'autumn26', name: 'Autumn 2026', archived: false },
  { id: 'spring26', name: 'Spring 2026', archived: true },
  { id: 'empty', name: 'Nothing here yet', archived: false },
];
const courses = [
  { id: 'hikam26', name: 'Hikam Foundations', cohortId: 'autumn26' },
  { id: 'arabic26', name: 'Arabic I', cohortId: 'autumn26' },
  { id: 'hikam27', name: 'Hikam Foundations', cohortId: 'spring27' },
  { id: 'seerah', name: 'Seerah Survey', cohortId: 'spring26' },
];
const recordings = [
  { id: 'r1', cohortId: 'autumn26', courseId: 'hikam26' },
  { id: 'r2', cohortId: 'autumn26', courseId: 'arabic26' },
  { id: 'r3', cohortId: 'spring27', courseId: 'hikam27' },
  { id: 'r4', cohortId: 'spring26', courseId: 'seerah' },
];
const cohortNameOf = (id: string) => cohorts.find((c) => c.id === id)?.name ?? '';
const visible = (scope: Parameters<typeof inScope>[1]) =>
  recordings.filter((r) => inScope(r, scope)).map((r) => r.id);

describe('the library scope', () => {
  it('shows everything until something is chosen', () => {
    expect(visible(WHOLE_LIBRARY)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(isNarrowed('all', WHOLE_LIBRARY)).toBe(false);
  });

  it('a cohort alone shows every recording in that cohort', () => {
    const scope = pickCohort(WHOLE_LIBRARY, 'autumn26', courses);
    expect(visible(scope)).toEqual(['r1', 'r2']);
  });

  it('a course inside the cohort narrows it to that course', () => {
    const scope = { ...pickCohort(WHOLE_LIBRARY, 'autumn26', courses), courseId: 'hikam26' };
    expect(visible(scope)).toEqual(['r1']);
  });

  it('a course chosen with no cohort narrows to that course wherever it is', () => {
    expect(visible({ cohortId: ANY, courseId: 'hikam27' })).toEqual(['r3']);
  });

  /*
   * THE RULE BETWEEN THE TWO DROPDOWNS. A course chosen under "All cohorts" and
   * then a cohort it is not in would otherwise describe a set nothing is in —
   * an empty page with two controls each looking reasonable on its own.
   */
  it('choosing a cohort the chosen course is not in lets the course go', () => {
    const scope = pickCohort({ cohortId: ANY, courseId: 'hikam27' }, 'autumn26', courses);
    expect(visible(scope)).toEqual(['r1', 'r2']);
  });

  it('choosing the cohort the course IS in keeps the course', () => {
    const scope = pickCohort({ cohortId: ANY, courseId: 'hikam27' }, 'spring27', courses);
    expect(visible(scope)).toEqual(['r3']);
  });

  it('going back to every cohort keeps the course', () => {
    const scope = pickCohort({ cohortId: 'spring27', courseId: 'hikam27' }, ANY, courses);
    expect(visible(scope)).toEqual(['r3']);
  });

  it('the clear control is offered for any of the three filters, and only then', () => {
    expect(isNarrowed('published', WHOLE_LIBRARY)).toBe(true);
    expect(isNarrowed('all', { cohortId: 'autumn26', courseId: ANY })).toBe(true);
    expect(isNarrowed('all', { cohortId: ANY, courseId: 'hikam26' })).toBe(true);
  });
});

describe('what the dropdowns offer', () => {
  it('offers only cohorts that hold a course the reader can see, archived ones marked', () => {
    expect(cohortOptions(cohorts, courses)).toEqual([
      { value: ANY, label: 'All cohorts' },
      { value: 'spring27', label: 'Spring 2027' },
      { value: 'autumn26', label: 'Autumn 2026' },
      { value: 'spring26', label: 'Spring 2026 (archived)' },
    ]);
  });

  // A manager sees only their own courses, so for them this is the cohorts
  // those courses are in and nothing else.
  it("narrows the cohorts to the courses given — a manager's own", () => {
    expect(cohortOptions(cohorts, [courses[3]]).map((o) => o.value)).toEqual([ANY, 'spring26']);
  });

  it('offers every course, by name, each saying which term it is in, until a cohort is chosen', () => {
    expect(courseOptions(courses, ANY, cohortNameOf)).toEqual([
      { value: ANY, label: 'All courses' },
      { value: 'arabic26', label: 'Arabic I · Autumn 2026' },
      { value: 'hikam26', label: 'Hikam Foundations · Autumn 2026' },
      { value: 'hikam27', label: 'Hikam Foundations · Spring 2027' },
      { value: 'seerah', label: 'Seerah Survey · Spring 2026' },
    ]);
  });

  it("offers a chosen cohort's courses alone, with no term to repeat", () => {
    expect(courseOptions(courses, 'autumn26', cohortNameOf)).toEqual([
      { value: ANY, label: 'All courses' },
      { value: 'arabic26', label: 'Arabic I' },
      { value: 'hikam26', label: 'Hikam Foundations' },
    ]);
  });
});
