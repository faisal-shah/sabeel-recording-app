import { describe, expect, it } from 'vitest';
import { validateOverride } from '../../src/overrides';

const base = { studentUid: 'stu', recordingId: 'rec', completed: true, reason: 'attended live' };

describe('validateOverride', () => {
  it('accepts a complete override with a reason', () => {
    expect(validateOverride({ ...base })).toEqual(base);
  });

  it('trims the reason', () => {
    expect(validateOverride({ ...base, reason: '  attended live  ' }).reason).toBe('attended live');
  });

  it('allows overriding to NOT complete (with a reason)', () => {
    expect(validateOverride({ ...base, completed: false }).completed).toBe(false);
  });

  it('REQUIRES a reason — empty or whitespace is rejected', () => {
    for (const reason of ['', '   ', undefined, null, 42]) {
      expect(() => validateOverride({ ...base, reason })).toThrow();
    }
  });

  it('rejects a non-boolean completed', () => {
    expect(() => validateOverride({ ...base, completed: 'yes' })).toThrow();
  });

  it('requires studentUid and recordingId', () => {
    expect(() => validateOverride({ ...base, studentUid: '' })).toThrow();
    expect(() => validateOverride({ ...base, recordingId: '' })).toThrow();
  });

  it('rejects an over-long reason', () => {
    expect(() => validateOverride({ ...base, reason: 'x'.repeat(501) })).toThrow();
  });
});
