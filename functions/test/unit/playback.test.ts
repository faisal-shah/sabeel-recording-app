import { describe, it, expect } from 'vitest';
import type { TokenClaims } from '@sabeel/shared';
import { playbackDenial } from '../../src/playback';

const activeClass = { effectiveActive: true, archivedAccess: false, managerUids: ['mgr'] };
const archivedClosed = { effectiveActive: false, archivedAccess: false, managerUids: ['mgr'] };
const archivedOpen = { effectiveActive: false, archivedAccess: true, managerUids: ['mgr'] };
const published = { status: 'published' as const, audioPath: 'recordings/r/audio.m4a' };

const ask = (over: Partial<Parameters<typeof playbackDenial>[0]>) =>
  playbackDenial({
    claims: { role: 'student', status: 'active' } as TokenClaims,
    recording: published,
    cls: activeClass,
    uid: 'stu',
    enrollmentActive: true,
    ...over,
  });

describe('students', () => {
  it('may play a published recording in a class they are enrolled in', () => {
    expect(ask({})).toBeNull();
  });

  it('may NOT play anything unpublished', () => {
    for (const status of ['draft', 'archived', 'unpublished', 'needsAttention'] as const) {
      expect(ask({ recording: { ...published, status } })).toBe('not-published');
    }
  });

  it('may not play without an active enrolment', () => {
    expect(ask({ enrollmentActive: false })).toBe('not-enrolled');
  });

  it('may not play from an archived class with listening turned off', () => {
    // The class is still visible in their history — this is about playback only.
    expect(ask({ cls: archivedClosed })).toBe('class-listening-off');
  });

  it('MAY play from an archived class when staff kept listening on', () => {
    expect(ask({ cls: archivedOpen })).toBeNull();
  });

  it('is refused before anything else when there is no audio', () => {
    // Checked first so a broken recording reports the real problem rather than
    // an access one, which would send staff looking in the wrong place.
    expect(ask({ recording: { status: 'published', audioPath: null } })).toBe('no-audio');
  });
});

describe('staff', () => {
  const manager = { role: 'manager', status: 'active' } as TokenClaims;
  const admin = { role: 'admin', status: 'active' } as TokenClaims;

  it('let a scoped manager play ANY status, so imports can be verified', () => {
    for (const status of ['draft', 'published', 'unpublished', 'needsAttention'] as const) {
      expect(ask({ claims: manager, uid: 'mgr', recording: { ...published, status } })).toBeNull();
    }
  });

  it('do not let a manager play a class they are not assigned to', () => {
    expect(ask({ claims: manager, uid: 'someone-else' })).toBe('not-your-class');
  });

  it('let an admin play anything', () => {
    expect(ask({ claims: admin, uid: 'admin', cls: archivedClosed })).toBeNull();
  });

  it('do not gate staff on the archived-listening switch', () => {
    // That switch governs STUDENT access. Staff still need to hear an archived
    // class's audio to answer questions about it.
    expect(ask({ claims: manager, uid: 'mgr', cls: archivedClosed })).toBeNull();
  });

  it('still refuses staff when there is no audio', () => {
    expect(
      ask({ claims: admin, uid: 'admin', recording: { status: 'draft', audioPath: null } }),
    ).toBe('no-audio');
  });
});
