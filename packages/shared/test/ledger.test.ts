import { describe, it, expect } from 'vitest';
import {
  accountableUids,
  attendanceGroups,
  attendanceReport,
  effectiveCompletion,
  rollup,
  ledgerBucket,
  type AttendanceStatus,
} from '../src';

describe('attendanceReport', () => {
  const mkSession = (
    id: string,
    attendance: Record<string, AttendanceStatus>,
    submitted: boolean,
  ) => ({ id, title: id, date: '2026-07-10', attendance, attendanceSubmittedAt: submitted ? 1 : null });

  const report = () =>
    attendanceReport({
      sessions: [
        mkSession('s1', { a: 'present', b: 'absent', c: 'excused' }, true),
        mkSession('s2', { a: 'absent', b: 'present' }, true), // c not in snapshot (late)
        mkSession('s3', { a: 'present', b: 'present', c: 'present' }, false), // not taken
      ],
      rosterUids: ['a', 'b', 'c'],
      assignments: [
        { studentUid: 'a', completed: false, dueDate: '2026-07-01' }, // overdue
        { studentUid: 'b', completed: true, dueDate: '2026-07-01' }, // done
        { studentUid: 'c', completed: false, dueDate: '2026-08-01' }, // pending, not overdue
      ],
      today: '2026-07-15',
    });

  it('per-session counts, and marks the un-taken session', () => {
    const r = report();
    expect(r.totalSessions).toBe(3);
    expect(r.sessionsWithAttendance).toBe(2);
    expect(r.sessions[0]).toMatchObject({ sessionId: 's1', submitted: true, present: 1, absent: 1, excused: 1 });
    expect(r.sessions[2]).toMatchObject({ sessionId: 's3', submitted: false, present: 0, absent: 0, excused: 0 });
  });

  it('per-student tallies over SUBMITTED sessions only, with notMarked for late enrollees', () => {
    const r = report();
    const a = r.students.find((s) => s.studentUid === 'a')!;
    expect(a).toMatchObject({ present: 1, absent: 1, excused: 0, notMarked: 0 });
    const c = r.students.find((s) => s.studentUid === 'c')!;
    // c was excused in s1 and absent from the s2 snapshot; s3 untaken doesn't count.
    expect(c).toMatchObject({ present: 0, absent: 0, excused: 1, notMarked: 1 });
  });

  it('catch-up grouped from active assignments, overdue at the day boundary', () => {
    const r = report();
    const byUid = Object.fromEntries(r.students.map((s) => [s.studentUid, s]));
    expect(byUid.a).toMatchObject({ assigned: 1, completed: 0, overdue: 1 });
    expect(byUid.b).toMatchObject({ assigned: 1, completed: 1, overdue: 0 });
    expect(byUid.c).toMatchObject({ assigned: 1, completed: 0, overdue: 0 });
  });
});

describe('attendance split', () => {
  const roster: Record<string, AttendanceStatus> = {
    a: 'present',
    b: 'absent',
    c: 'excused',
    d: 'present',
    e: 'absent',
  };

  it('accountable = absent ∪ excused; present are exempt', () => {
    expect(accountableUids(roster).sort()).toEqual(['b', 'c', 'e']);
  });

  it('groups the roster into present / absent / excused', () => {
    expect(attendanceGroups(roster)).toEqual({
      present: ['a', 'd'],
      absent: ['b', 'e'],
      excused: ['c'],
    });
  });

  it('an empty roster yields empty groups and no accountable', () => {
    expect(attendanceGroups({})).toEqual({ present: [], absent: [], excused: [] });
    expect(accountableUids({})).toEqual([]);
  });
});

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
