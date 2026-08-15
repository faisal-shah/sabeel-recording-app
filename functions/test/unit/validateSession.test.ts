import { describe, it, expect } from 'vitest';
import { validateCreateSession, validateUpdateSession } from '../../src/sessions';

/**
 * The due date is the day the excused lose access, so the validators enforce one
 * invariant: a deadline may become past by the passage of time, but nothing may
 * ever WRITE one that has already gone. `today` is injected so the day boundary
 * is exercised without a clock.
 */
const TODAY = '2026-07-25';

const create = (over: Record<string, unknown> = {}) =>
  validateCreateSession(
    { courseId: 'c1', date: '2026-07-20', title: 'Week 3', dueDate: '2026-08-01', notes: '', ...over },
    TODAY,
  );

describe('validateCreateSession', () => {
  it('accepts a due date in the future', () => {
    expect(create()).toMatchObject({ courseId: 'c1', dueDate: '2026-08-01' });
  });

  it('accepts a due date of today — it is the LAST on-time day', () => {
    expect(create({ dueDate: TODAY }).dueDate).toBe(TODAY);
  });

  it('refuses a due date already in the past', () => {
    expect(() => create({ dueDate: '2026-07-24' })).toThrow(/cannot be in the past/);
  });

  it('refuses a missing due date — a blank deadline would mean permanent access', () => {
    expect(() => create({ dueDate: null })).toThrow(/due date is required/);
    expect(() => create({ dueDate: undefined })).toThrow(/due date is required/);
  });

  it('refuses a malformed due date', () => {
    expect(() => create({ dueDate: '1 Aug 2026' })).toThrow(/YYYY-MM-DD/);
  });

  it('still refuses the pre-existing invalid inputs', () => {
    expect(() => create({ courseId: '' })).toThrow(/courseId/);
    expect(() => create({ date: 'soon' })).toThrow(/YYYY-MM-DD/);
    expect(() => create({ title: '   ' })).toThrow(/title is required/);
  });
});

describe('validateUpdateSession', () => {
  it('leaves the due date alone when it is not being changed', () => {
    const out = validateUpdateSession({ sessionId: 's1', title: 'Renamed' }, TODAY);
    expect(out).toEqual({ sessionId: 's1', title: 'Renamed' });
  });

  it('accepts moving the deadline forward — the documented way to reopen a session', () => {
    expect(validateUpdateSession({ sessionId: 's1', dueDate: '2026-09-01' }, TODAY).dueDate).toBe(
      '2026-09-01',
    );
  });

  it('refuses moving the deadline into the past', () => {
    expect(() => validateUpdateSession({ sessionId: 's1', dueDate: '2026-07-24' }, TODAY)).toThrow(
      /cannot be in the past/,
    );
  });

  it('refuses clearing the due date', () => {
    expect(() => validateUpdateSession({ sessionId: 's1', dueDate: null }, TODAY)).toThrow(
      /due date is required/,
    );
  });

  it('refuses an update that changes nothing', () => {
    expect(() => validateUpdateSession({ sessionId: 's1' }, TODAY)).toThrow(/Nothing to change/);
  });
});
