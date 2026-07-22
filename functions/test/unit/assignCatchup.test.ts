import { describe, expect, it } from 'vitest';
import { validateAssignCatchup } from '../../src/assignments';

const base = { studentUid: 'stu', recordingId: 'rec' };

describe('validateAssignCatchup', () => {
  it('accepts a valid date-only due date', () => {
    expect(validateAssignCatchup({ ...base, dueDate: '2026-08-01' })).toEqual({
      ...base,
      dueDate: '2026-08-01',
    });
  });

  it('treats a missing due date as null (required, no deadline)', () => {
    expect(validateAssignCatchup({ ...base }).dueDate).toBeNull();
  });

  it('treats a null due date as null', () => {
    expect(validateAssignCatchup({ ...base, dueDate: null }).dueDate).toBeNull();
  });

  it('rejects a non-date-only due date', () => {
    for (const bad of ['2026-8-1', '2026/08/01', 'tomorrow', '2026-08-01T00:00:00Z', 42]) {
      expect(() => validateAssignCatchup({ ...base, dueDate: bad })).toThrow();
    }
  });

  it('requires studentUid and recordingId', () => {
    expect(() => validateAssignCatchup({ recordingId: 'rec' })).toThrow();
    expect(() => validateAssignCatchup({ studentUid: 'stu' })).toThrow();
    expect(() => validateAssignCatchup(null)).toThrow();
  });
});
