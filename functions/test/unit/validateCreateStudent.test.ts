import { describe, expect, it } from 'vitest';
import { validateCreateStudent } from '../../src/students';

const base = { displayName: 'Fatima Ahmed', email: 'Fatima@Example.com ' };

describe('validateCreateStudent', () => {
  it('normalises the name and address', () => {
    const out = validateCreateStudent({ ...base });
    expect(out).toEqual({ displayName: 'Fatima Ahmed', email: 'fatima@example.com' });
  });

  it('accepts a class id and keeps it', () => {
    expect(validateCreateStudent({ ...base, courseId: 'abc123' }).courseId).toBe('abc123');
  });

  it('treats a MISSING courseId as no class', () => {
    expect(validateCreateStudent({ ...base }).courseId).toBeUndefined();
  });

  it('treats an explicitly UNDEFINED courseId as no class', () => {
    expect(validateCreateStudent({ ...base, courseId: undefined }).courseId).toBeUndefined();
  });

  it('treats a NULL courseId as no class', () => {
    // The regression this file exists for. The callable client serializes an
    // explicitly-undefined property as null, so a UI that sends
    // `courseId: someState ?? undefined` delivers `courseId: null` — and a guard
    // testing only `!== undefined` rejected it with "courseId must be a class
    // id.". It broke creating the very first student, before any class existed
    // to pick, which is precisely the moment a new institute starts.
    expect(validateCreateStudent({ ...base, courseId: null }).courseId).toBeUndefined();
  });

  it('still rejects a courseId that is present but not a usable id', () => {
    for (const bad of ['', '   ', 42, {}, []]) {
      expect(() => validateCreateStudent({ ...base, courseId: bad })).toThrow();
    }
  });

  it('requires a name and an address', () => {
    expect(() => validateCreateStudent({ ...base, displayName: '  ' })).toThrow();
    expect(() => validateCreateStudent({ ...base, email: 'nope' })).toThrow();
  });
});
