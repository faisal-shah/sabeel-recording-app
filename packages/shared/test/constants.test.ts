import { describe, it, expect } from 'vitest';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  REGION,
  SIGNED_URL_REFRESH_MS,
  SIGNED_URL_TTL_MS,
} from '../src';

describe('constants', () => {
  it('pins the region the functions deploy to', () => {
    expect(REGION).toBe('us-central1');
  });

  it('uses a demo- project id for the emulators', () => {
    // The emulator suite only treats a project as offline/demo when the id
    // starts with `demo-`; a real-looking id can reach live services.
    expect(EMULATOR_PROJECT_ID.startsWith('demo-')).toBe(true);
  });

  it('refreshes signed URLs well before they expire', () => {
    // A refresh window at or beyond the TTL would mean every URL is considered
    // stale the moment it is minted; one at zero would mean refreshing only
    // after playback has already failed.
    expect(SIGNED_URL_REFRESH_MS).toBeGreaterThan(0);
    expect(SIGNED_URL_REFRESH_MS).toBeLessThan(SIGNED_URL_TTL_MS);
  });

  it('gives a signed URL more life than the longest recording', () => {
    // Course recordings run about two hours; a URL must never die mid-playback.
    const longestSessionMs = 4 * 60 * 60 * 1000;
    expect(SIGNED_URL_TTL_MS).toBeGreaterThan(longestSessionMs);
  });
});

describe('collections', () => {
  it('maps every key to its own name', () => {
    for (const [key, value] of Object.entries(COLLECTIONS)) {
      expect(value).toBe(key);
    }
  });

  it('has no duplicate collection names', () => {
    const names = Object.values(COLLECTIONS);
    expect(new Set(names).size).toBe(names.length);
  });
});
