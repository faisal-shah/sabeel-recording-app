import { describe, it, expect } from 'vitest';
import {
  assignmentId,
  bucketRank,
  completionId,
  addDays,
  daysUntilDue,
  dueBucket,
  hasRecordingAccess,
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

describe('addDays', () => {
  it('shifts a civil date forward', () => {
    expect(addDays('2026-07-25', 7)).toBe('2026-08-01');
  });
  it('crosses a month and a year end', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
  });
  it('is exact across a DST boundary (US DST ends 2026-11-01)', () => {
    expect(addDays('2026-10-29', 7)).toBe('2026-11-05');
  });
  it('round-trips with daysUntilDue', () => {
    expect(daysUntilDue(addDays('2026-07-25', 7), '2026-07-25')).toBe(7);
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
});

describe('hasRecordingAccess — the whole of a student access decision', () => {
  const OPEN = { active: true, dueDate: '2026-07-25' };

  it('opens up to and including the due date', () => {
    expect(hasRecordingAccess(OPEN, '2026-07-01')).toBe(true);
    expect(hasRecordingAccess(OPEN, '2026-07-25')).toBe(true);
  });

  it('closes the day after the due date', () => {
    expect(hasRecordingAccess(OPEN, '2026-07-26')).toBe(false);
  });

  it('an inactive grant is closed however far ahead of the due date', () => {
    expect(hasRecordingAccess({ active: false, dueDate: '2999-01-01' }, '2026-07-25')).toBe(false);
  });
});

describe('dueBucket', () => {
  const TODAY = '2026-07-25';

  it('completed wins over any due state', () => {
    expect(dueBucket({ dueDate: '2026-01-01', completed: true }, TODAY)).toBe('done');
  });

  it('past due, incomplete → missed', () => {
    expect(dueBucket({ dueDate: '2026-07-24', completed: false }, TODAY)).toBe('missed');
  });

  it('due today counts as dueSoon, not missed', () => {
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
  it('missed first, done last', () => {
    const order: DueBucket[] = ['missed', 'dueSoon', 'upcoming', 'done'];
    const ranks = order.map(bucketRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(order.length);
  });
});
