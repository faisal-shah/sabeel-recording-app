import { describe, it, expect } from 'vitest';
import { canPlayFromCourse, deriveEffectiveActive, enrollmentId } from '../src';

describe('deriveEffectiveActive', () => {
  it('is active only when both the cohort and the class are active', () => {
    expect(deriveEffectiveActive(false, false)).toBe(true);
    expect(deriveEffectiveActive(true, false)).toBe(false);
    expect(deriveEffectiveActive(false, true)).toBe(false);
    expect(deriveEffectiveActive(true, true)).toBe(false);
  });

  it('lets a cohort round-trip without disturbing per-class state', () => {
    // The behaviour the brief requires: archiving a cohort deactivates its
    // courses, and reactivating it restores each class to its OWN state rather
    // than switching them all on. That only holds because the cascade is
    // derived, never written into the class's `archived` flag.
    const courses = [{ archived: false }, { archived: true }];
    const whileCohortArchived = courses.map((c) => deriveEffectiveActive(true, c.archived));
    const afterCohortRestored = courses.map((c) => deriveEffectiveActive(false, c.archived));

    expect(whileCohortArchived).toEqual([false, false]);
    expect(afterCohortRestored).toEqual([true, false]);
  });
});

describe('canPlayFromCourse', () => {
  it('allows playback from an active class', () => {
    expect(canPlayFromCourse({ effectiveActive: true, archivedAccess: false })).toBe(true);
  });

  it('blocks playback from an archived class by default', () => {
    expect(canPlayFromCourse({ effectiveActive: false, archivedAccess: false })).toBe(false);
  });

  it('allows playback from an archived class when staff kept access on', () => {
    expect(canPlayFromCourse({ effectiveActive: false, archivedAccess: true })).toBe(true);
  });
});

describe('enrollmentId', () => {
  it('is deterministic, so rules can check membership with one exists()', () => {
    expect(enrollmentId('student1', 'classA')).toBe('student1_classA');
    expect(enrollmentId('student1', 'classA')).toBe(enrollmentId('student1', 'classA'));
  });

  it('does not collide across different pairs', () => {
    expect(enrollmentId('a', 'b')).not.toBe(enrollmentId('b', 'a'));
  });
});
