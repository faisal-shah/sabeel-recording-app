import { describe, it, expect } from 'vitest';
import {
  allowedTransitions,
  audioStoragePath,
  canPublish,
  canTransition,
  isVisibleToStudents,
  publishBlockers,
  type RecordingStatus,
} from '../src';

const ALL: RecordingStatus[] = [
  'draft',
  'published',
  'archived',
  'unpublished',
  'needsAttention',
];

describe('canTransition', () => {
  it('allows exactly the moves the brief draws', () => {
    const legal = new Set([
      'draft>published',
      'draft>needsAttention',
      'published>archived',
      'published>unpublished',
      'archived>published',
      'unpublished>draft',
      'needsAttention>draft',
    ]);
    for (const from of ALL) {
      for (const to of ALL) {
        expect({ from, to, ok: canTransition(from, to) }).toEqual({
          from,
          to,
          ok: legal.has(`${from}>${to}`),
        });
      }
    }
  });

  it('never allows a state to transition to itself', () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });

  it('does NOT let an unpublished recording go straight back to published', () => {
    // It has to pass through draft, so the metadata gate is re-applied. It was
    // withdrawn for a reason, and republishing blind would skip the review.
    expect(canTransition('unpublished', 'published')).toBe(false);
    expect(canTransition('unpublished', 'draft')).toBe(true);
    expect(canTransition('draft', 'published')).toBe(true);
  });

  it('lets an archived recording come straight back', () => {
    // Archiving is filing, not correction — nothing needs re-reviewing.
    expect(canTransition('archived', 'published')).toBe(true);
  });

  it('has no way out of a state except the listed ones', () => {
    expect(allowedTransitions('published')).toEqual(['archived', 'unpublished']);
    expect(allowedTransitions('needsAttention')).toEqual(['draft']);
  });

  it('rejects a status it has never heard of', () => {
    expect(canTransition('nonsense' as RecordingStatus, 'draft')).toBe(false);
    expect(allowedTransitions('nonsense' as RecordingStatus)).toEqual([]);
  });
});

describe('publishBlockers', () => {
  const ready = { title: 'Session 1', audioPath: 'recordings/r1/audio.m4a', status: 'draft' as const };

  it('clears a complete draft', () => {
    expect(publishBlockers(ready)).toEqual([]);
    expect(canPublish(ready)).toBe(true);
  });

  it('blocks a missing or blank title', () => {
    expect(publishBlockers({ ...ready, title: '' })).toContain('title');
    expect(publishBlockers({ ...ready, title: '   ' })).toContain('title');
  });

  it('blocks publishing with no audio', () => {
    // A published recording with no audio is a row in every student's list that
    // plays nothing — the one failure they cannot work around.
    expect(publishBlockers({ ...ready, audioPath: null })).toContain('audio');
  });

  it('blocks publishing from a state that cannot reach published', () => {
    expect(publishBlockers({ ...ready, status: 'unpublished' })).toContain('status');
    expect(publishBlockers({ ...ready, status: 'needsAttention' })).toContain('status');
    expect(publishBlockers({ ...ready, status: 'published' })).toContain('status');
  });

  it('reports every blocker at once, not just the first', () => {
    // The UI names what is missing; stopping at the first would make fixing them
    // a guessing game one round-trip at a time.
    expect(publishBlockers({ title: '', audioPath: null, status: 'unpublished' })).toEqual([
      'title',
      'audio',
      'status',
    ]);
  });

  it('does not require a due date or notes', () => {
    // Both are optional per the brief; a no-due recording is still required
    // listening, it simply never becomes overdue.
    expect(canPublish(ready)).toBe(true);
  });
});

describe('isVisibleToStudents', () => {
  it('is true only for published', () => {
    for (const s of ALL) expect(isVisibleToStudents(s)).toBe(s === 'published');
  });
});

describe('audioStoragePath', () => {
  it('is derived from the id, so the client, rules tests and signer agree', () => {
    expect(audioStoragePath('abc123')).toBe('recordings/abc123/audio.m4a');
  });
});
