import { describe, it, expect } from 'vitest';
import { pruneDetail } from '../../src/audited';

/**
 * Firestore rejects an `undefined` field value, and the audit write is
 * best-effort — so an unpruned undefined does not fail the call, it silently
 * loses the entry. `setStaffAccess` takes role and status independently and
 * reports both, which is how this shipped.
 */
describe('pruneDetail', () => {
  it('drops the keys the caller did not send', () => {
    expect(pruneDetail({ role: 'admin', status: undefined })).toEqual({ role: 'admin' });
    expect(pruneDetail({ role: undefined, status: 'disabled' })).toEqual({ status: 'disabled' });
  });

  it('keeps falsy values that are not undefined', () => {
    expect(pruneDetail({ completed: false, reason: '', count: 0, cleared: null })).toEqual({
      completed: false,
      reason: '',
      count: 0,
      cleared: null,
    });
  });

  it('returns undefined when nothing is left, so no empty detail is written', () => {
    expect(pruneDetail({ role: undefined, status: undefined })).toBeUndefined();
    expect(pruneDetail({})).toBeUndefined();
  });
});
