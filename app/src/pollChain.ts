import { nextPollDelay } from './pollDelay';

/**
 * The gate screen's poll: one self-re-arming timer, owned by one sign-in.
 *
 * `session.ts` polls an account that is not yet usable — a forced token
 * refresh and a profile read per tick — until the account is, and every path
 * into it is asynchronous, so a tick can be in the air when the credential
 * changes underneath it. The rules a tick has to obey are all here, where
 * they can be tested with fake timers; `session.ts` cannot be imported by the
 * unit suite at all.
 *
 *  - ONE TIMER AT A TIME. A tick re-arms itself when it finishes, so a tick
 *    that failed (a dropped connection on the gate screen) does not end the
 *    polling; two chains never run side by side.
 *  - A STRETCH ENDS WHEN `stop` SAYS SO — the account became usable, or the
 *    sign-in changed. The back-off counts from the start of the stretch.
 *  - A TICK RE-ARMS ONLY FOR THE OWNER THAT STARTED IT. Sign out with a tick
 *    in flight, sign a gated account in, let ITS first tick take off, and the
 *    old tick lands to find no timer and a stretch in progress — and re-armed
 *    ITSELF, carrying a `poll` closed over the previous user. Whichever
 *    continuation lost the race then dropped out, so the chain that survived
 *    could be the stale one: refreshing a signed-out user's token, failing,
 *    re-arming, for as long as the gate screen stayed open, while the account
 *    actually signed in was never polled. `claim` hands each sign-in a
 *    generation and a tick from an earlier one is not allowed back in.
 */
export interface PollChain {
  /** A new owner. Whatever was polling for the previous one stops for good. */
  claim(): number;
  /** Is `gen` still the sign-in that owns the session? */
  owns(gen: number): boolean;
  /**
   * Poll for `gen`, after a delay, and again after each tick until `stop` —
   * unless `gen` has been superseded, in which case nothing is armed.
   */
  arm(gen: number, poll: () => Promise<void>): void;
  /** End the current stretch of polling. The owner stays. */
  stop(): void;
}

export function createPollChain(): PollChain {
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** When the current stretch began, for the back-off; 0 between stretches. */
  let since = 0;
  let current = 0;

  const stop = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    since = 0;
  };

  const arm = (gen: number, poll: () => Promise<void>) => {
    if (gen !== current || timer) return;
    if (!since) since = Date.now();
    timer = setTimeout(async () => {
      timer = null;
      await poll();
      // `stop` zeroes `since`, which is what ends a stretch; a newer owner
      // fails the generation check inside `arm`.
      if (since) arm(gen, poll);
    }, nextPollDelay(Date.now() - since));
  };

  return {
    claim() {
      stop();
      current += 1;
      return current;
    },
    owns: (gen) => gen === current,
    arm,
    stop,
  };
}
