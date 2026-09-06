import { describe, it, expect } from 'vitest';
import { deriveTargets, pruneDetail } from '../../src/audited';

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

/**
 * Every audited callable's row names something it acted on.
 *
 * `deriveTargets` is what most callables rely on — they set no `audit.targets`
 * at all — so a payload whose id field is not in `ID_KEYS` audits as `{}`, and
 * `AuditCard` then renders no target line whatsoever. `deleteSession` shipped
 * that way: the log recorded that a session, its recording, its whole ledger and
 * the class's attendance for that day had been permanently destroyed, without
 * saying which session.
 *
 * The payloads below are the ones those callables actually validate — not a
 * restatement of the whole surface, but the cases that were empty and the two
 * whose target does not exist until the call has run.
 */
describe('deriveTargets', () => {
  it.each([
    ['deleteSession', { sessionId: 's1' }],
    ['updateSession', { sessionId: 's1', title: 'x', date: '2026-09-06' }],
    ['submitAttendance', { sessionId: 's1', attendance: {} }],
    ['createSession', { courseId: 'c1', title: 'x' }],
    ['setRecordingStatus', { recordingId: 'r1', status: 'published' }],
    ['createEnrollment', { studentUid: 'u1', courseId: 'c1' }],
    ['setStaffAccess', { uid: 'u1', status: 'disabled' }],
    ['setCohortArchived', { cohortId: 'k1', archived: true }],
  ])('names what %s acted on', (_callable, payload) => {
    expect(Object.keys(deriveTargets(payload)).length).toBeGreaterThan(0);
  });

  it('picks up every id in a payload, and nothing else', () => {
    expect(deriveTargets({ studentUid: 'u1', recordingId: 'r1', reason: 'because' })).toEqual({
      studentUid: 'u1',
      recordingId: 'r1',
    });
  });

  /*
   * The two whose target does not exist until the call has run — the id is
   * assigned by the create itself, so there is nothing in the request to derive
   * and the callable must set it. Asserted from the other side: these payloads
   * SHOULD derive nothing, which is what makes the explicit assignment load
   * bearing rather than belt and braces.
   */
  it.each([
    ['createStudent', { displayName: 'A Student', email: 'a@example.com' }],
    ['createCohort', { name: 'Autumn 2026' }],
  ])('has nothing to derive for %s, which is why it sets its own', (_callable, payload) => {
    expect(deriveTargets(payload)).toEqual({});
  });

  it('ignores an empty string and a non-string', () => {
    expect(deriveTargets({ sessionId: '', recordingId: 42, uid: null })).toEqual({});
  });
});
