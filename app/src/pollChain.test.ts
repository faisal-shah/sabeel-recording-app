import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollChain } from './pollChain';

/**
 * A poll that resolves when the test says so, so a tick can be held in the
 * air while the sign-in changes underneath it.
 */
function heldPoll() {
  const calls: (() => void)[] = [];
  const poll = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        calls.push(resolve);
      }),
  );
  return { poll, land: () => calls.shift()?.() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Let the microtasks behind a resolved poll run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the gate screen\'s poll chain', () => {
  it('re-arms itself after each tick, and stops when told', async () => {
    const chain = createPollChain();
    const gen = chain.claim();
    const { poll, land } = heldPoll();
    chain.arm(gen, poll);

    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(1);
    land();
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(2);

    land();
    await settle();
    chain.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('never runs two timers side by side', async () => {
    const chain = createPollChain();
    const gen = chain.claim();
    const { poll, land } = heldPoll();
    chain.arm(gen, poll);
    chain.arm(gen, poll);
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(1);
    land();
  });

  /*
   * THE RACE. Sign out with a tick in flight; sign a gated account in; its
   * first tick takes off; the old tick lands. Both continuations find no
   * timer and a stretch in progress — and the OLD one is first. A chain that
   * let it re-arm carried the previous user's `poll` for as long as the gate
   * screen stayed open, while the account actually signed in was never polled
   * again once its own continuation found the timer taken.
   */
  it('a tick from a previous sign-in never re-arms, however the race lands', async () => {
    const chain = createPollChain();
    const first = chain.claim();
    const old = heldPoll();
    chain.arm(first, old.poll);
    await vi.advanceTimersByTimeAsync(3000);
    expect(old.poll).toHaveBeenCalledTimes(1); // in flight

    const second = chain.claim();
    const fresh = heldPoll();
    chain.arm(second, fresh.poll);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fresh.poll).toHaveBeenCalledTimes(1); // in flight too; no timer armed

    old.land();
    await settle();
    fresh.land();
    await settle();

    await vi.advanceTimersByTimeAsync(3000);
    expect(old.poll).toHaveBeenCalledTimes(1);
    expect(fresh.poll).toHaveBeenCalledTimes(2);
    fresh.land();
  });

  it('refuses to arm at all for a sign-in that has been superseded', async () => {
    const chain = createPollChain();
    const first = chain.claim();
    chain.claim();
    const { poll } = heldPoll();
    chain.arm(first, poll);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).not.toHaveBeenCalled();
    expect(chain.owns(first)).toBe(false);
  });

  it('backs off after two minutes of one stretch, and starts fresh on the next', async () => {
    const chain = createPollChain();
    const gen = chain.claim();
    const { poll, land } = heldPoll();
    chain.arm(gen, poll);
    // Forty ticks at three seconds cover the first two minutes.
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(3000);
      land();
      await settle();
    }
    expect(poll).toHaveBeenCalledTimes(40);
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(40); // now on the thirty-second heartbeat
    await vi.advanceTimersByTimeAsync(27_000);
    expect(poll).toHaveBeenCalledTimes(41);
    land();
    await settle();

    chain.stop();
    chain.arm(gen, poll);
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(42); // a new stretch is quick again
    land();
  });
});
