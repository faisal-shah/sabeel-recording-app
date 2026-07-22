import { describe, expect, it } from 'vitest';
import { validateCreateStudent } from '../../src/students';

const base = { displayName: 'Fatima Ahmed', email: 'Fatima@Example.com ' };

describe('validateCreateStudent', () => {
  it('normalises the name and address', () => {
    const out = validateCreateStudent({ ...base });
    expect(out).toEqual({ displayName: 'Fatima Ahmed', email: 'fatima@example.com' });
  });

  it('accepts a class id and keeps it', () => {
    expect(validateCreateStudent({ ...base, classId: 'abc123' }).classId).toBe('abc123');
  });

  it('treats a MISSING classId as no class', () => {
    expect(validateCreateStudent({ ...base }).classId).toBeUndefined();
  });

  it('treats an explicitly UNDEFINED classId as no class', () => {
    expect(validateCreateStudent({ ...base, classId: undefined }).classId).toBeUndefined();
  });

  it('treats a NULL classId as no class', () => {
    // The regression this file exists for. The callable client serializes an
    // explicitly-undefined property as null, so a UI that sends
    // `classId: someState ?? undefined` delivers `classId: null` — and a guard
    // testing only `!== undefined` rejected it with "classId must be a class
    // id.". It broke creating the very first student, before any class existed
    // to pick, which is precisely the moment a new institute starts.
    expect(validateCreateStudent({ ...base, classId: null }).classId).toBeUndefined();
  });

  it('still rejects a classId that is present but not a usable id', () => {
    for (const bad of ['', '   ', 42, {}, []]) {
      expect(() => validateCreateStudent({ ...base, classId: bad })).toThrow();
    }
  });

  it('requires a name and an address', () => {
    expect(() => validateCreateStudent({ ...base, displayName: '  ' })).toThrow();
    expect(() => validateCreateStudent({ ...base, email: 'nope' })).toThrow();
  });
});
