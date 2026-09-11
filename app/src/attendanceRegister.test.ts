import { describe, expect, it } from 'vitest';
import { attendancePayload, registerMark } from './attendanceRegister';

const fresh = { attendanceSubmittedAt: null, attendance: {} };
const submitted = { attendanceSubmittedAt: 1, attendance: { ali: 'excused' as const, sara: 'present' as const } };

describe('the register', () => {
  it('starts everyone as Present on a register never submitted', () => {
    expect(registerMark(fresh, {}, 'ali')).toBe('present');
    expect(attendancePayload(fresh, ['ali', 'sara'], { sara: 'absent' })).toEqual({
      ali: 'present',
      sara: 'absent',
    });
  });

  it('leaves a student who joined after a submitted session unmarked, and out of the payload', () => {
    // The correction that used to write "present" for a meeting they were not
    // enrolled for.
    expect(registerMark(submitted, {}, 'newcomer')).toBeNull();
    expect(attendancePayload(submitted, ['ali', 'sara', 'newcomer'], { sara: 'absent' })).toEqual({
      ali: 'excused',
      sara: 'absent',
    });
  });

  it('sends the newcomer once staff mark them', () => {
    expect(attendancePayload(submitted, ['ali', 'newcomer'], { newcomer: 'excused' })).toEqual({
      ali: 'excused',
      newcomer: 'excused',
    });
  });

  it('shows the stored mark until a local one replaces it', () => {
    expect(registerMark(submitted, {}, 'ali')).toBe('excused');
    expect(registerMark(submitted, { ali: 'absent' }, 'ali')).toBe('absent');
  });
});
