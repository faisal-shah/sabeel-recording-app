import { describe, it, expect } from 'vitest';
import { effectiveCompletion, rollup, ledgerBucket } from '../src';

describe('effectiveCompletion', () => {
  it('an override wins over the student attestation, and carries its reason', () => {
    expect(effectiveCompletion({ completed: false }, { completed: true, reason: 'attended live' })).toEqual({
      completed: true,
      source: 'override',
      reason: 'attended live',
    });
    // Override can also FORCE not-complete over a student's self-mark.
    expect(effectiveCompletion({ completed: true }, { completed: false, reason: 'did not actually listen' })).toEqual({
      completed: false,
      source: 'override',
      reason: 'did not actually listen',
    });
  });

  it('falls back to the student completion when there is no override', () => {
    expect(effectiveCompletion({ completed: true }, null)).toEqual({ completed: true, source: 'student' });
  });

  it('is not-complete when neither exists', () => {
    expect(effectiveCompletion(null, null)).toEqual({ completed: false, source: 'none' });
  });
});

describe('rollup', () => {
  const TODAY = '2026-07-25';
  it('counts complete / incomplete / overdue with overdue ⊂ incomplete', () => {
    const items = [
      { completed: true, dueDate: '2020-01-01' }, // complete (never overdue though past)
      { completed: false, dueDate: '2026-07-24' }, // overdue
      { completed: false, dueDate: '2026-07-30' }, // incomplete, not overdue
      { completed: false, dueDate: null }, // incomplete, no due → never overdue
      { completed: true, dueDate: null }, // complete
    ];
    expect(rollup(items, TODAY)).toEqual({ total: 5, complete: 2, incomplete: 3, overdue: 1 });
  });

  it('a completed item is never overdue, however far past due', () => {
    expect(rollup([{ completed: true, dueDate: '2000-01-01' }], TODAY)).toEqual({
      total: 1,
      complete: 1,
      incomplete: 0,
      overdue: 0,
    });
  });

  it('due today is not yet overdue', () => {
    expect(rollup([{ completed: false, dueDate: '2026-07-25' }], TODAY).overdue).toBe(0);
  });

  it('empties to zeros', () => {
    expect(rollup([], TODAY)).toEqual({ total: 0, complete: 0, incomplete: 0, overdue: 0 });
  });
});

describe('ledgerBucket', () => {
  it('reuses the home classification', () => {
    expect(ledgerBucket('2026-07-24', false, '2026-07-25')).toBe('overdue');
    expect(ledgerBucket('2026-07-24', true, '2026-07-25')).toBe('done');
    expect(ledgerBucket(null, false, '2026-07-25')).toBe('noDue');
  });
});
