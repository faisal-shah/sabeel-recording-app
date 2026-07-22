import { describe, it, expect } from 'vitest';
import {
  assignmentId,
  bucketRank,
  completionId,
  daysUntilDue,
  dueBucket,
  isOverdue,
  todayInZone,
  type DueBucket,
} from '../src';

describe('composite ids', () => {
  it('key assignments and completions by student+recording', () => {
    expect(assignmentId('stu', 'rec')).toBe('stu_rec');
    expect(completionId('stu', 'rec')).toBe('stu_rec');
  });
});

describe('todayInZone', () => {
  // 2026-07-25 05:30 UTC is still 2026-07-25 00:30 in Chicago (UTC-5, CDT).
  it('returns the local calendar date', () => {
    expect(todayInZone('America/Chicago', Date.parse('2026-07-25T05:30:00Z'))).toBe('2026-07-25');
  });

  it('rolls over at LOCAL midnight, not UTC', () => {
    // 04:30 UTC on the 25th is 23:30 on the 24th in Chicago — still the 24th.
    expect(todayInZone('America/Chicago', Date.parse('2026-07-25T04:30:00Z'))).toBe('2026-07-24');
    // One hour later it has ticked over.
    expect(todayInZone('America/Chicago', Date.parse('2026-07-25T05:30:00Z'))).toBe('2026-07-25');
  });
});

describe('daysUntilDue', () => {
  it('counts whole calendar days, signed', () => {
    expect(daysUntilDue('2026-07-25', '2026-07-24')).toBe(1);
    expect(daysUntilDue('2026-07-25', '2026-07-25')).toBe(0);
    expect(daysUntilDue('2026-07-25', '2026-07-26')).toBe(-1);
    expect(daysUntilDue('2026-08-01', '2026-07-25')).toBe(7);
  });

  it('is exact across a DST boundary (US DST ends 2026-11-01)', () => {
    expect(daysUntilDue('2026-11-02', '2026-10-31')).toBe(2);
  });
});

describe('isOverdue — the due date is the LAST on-time day', () => {
  it('is not overdue on the due date itself', () => {
    expect(isOverdue('2026-07-25', '2026-07-25')).toBe(false);
  });
  it('becomes overdue the next day', () => {
    expect(isOverdue('2026-07-25', '2026-07-26')).toBe(true);
  });
  it('is not overdue before the due date', () => {
    expect(isOverdue('2026-07-25', '2026-07-20')).toBe(false);
  });
  it('a no-due assignment is never overdue', () => {
    expect(isOverdue(null, '2999-01-01')).toBe(false);
  });
});

describe('dueBucket', () => {
  const TODAY = '2026-07-25';

  it('completed wins over any due state', () => {
    expect(dueBucket({ dueDate: '2026-01-01', completed: true }, TODAY)).toBe('done');
    expect(dueBucket({ dueDate: null, completed: true }, TODAY)).toBe('done');
  });

  it('no due date, incomplete → noDue', () => {
    expect(dueBucket({ dueDate: null, completed: false }, TODAY)).toBe('noDue');
  });

  it('past due, incomplete → overdue', () => {
    expect(dueBucket({ dueDate: '2026-07-24', completed: false }, TODAY)).toBe('overdue');
  });

  it('due today counts as dueSoon, not overdue', () => {
    expect(dueBucket({ dueDate: '2026-07-25', completed: false }, TODAY)).toBe('dueSoon');
  });

  it('within the 7-day window → dueSoon; the 7th day is still soon', () => {
    expect(dueBucket({ dueDate: '2026-08-01', completed: false }, TODAY)).toBe('dueSoon');
  });

  it('further out than the window → upcoming', () => {
    expect(dueBucket({ dueDate: '2026-08-02', completed: false }, TODAY)).toBe('upcoming');
  });
});

describe('bucketRank orders the home', () => {
  it('overdue first, done last', () => {
    const order: DueBucket[] = ['overdue', 'dueSoon', 'upcoming', 'noDue', 'done'];
    const ranks = order.map(bucketRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(order.length);
  });
});
