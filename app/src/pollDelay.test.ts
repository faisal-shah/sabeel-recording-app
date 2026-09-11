import { describe, expect, it } from 'vitest';
import { nextPollDelay } from './pollDelay';

describe('the gate screen\'s poll', () => {
  it('asks every three seconds while an approval is likely on its way', () => {
    expect(nextPollDelay(0)).toBe(3000);
    expect(nextPollDelay(119_999)).toBe(3000);
  });

  it('then settles to a heartbeat — a forgotten tab is not a token refresh every three seconds all night', () => {
    expect(nextPollDelay(120_000)).toBe(30_000);
    expect(nextPollDelay(8 * 60 * 60 * 1000)).toBe(30_000);
  });
});
