/**
 * How long the gate screen waits before polling an account that is not yet
 * usable again: three seconds for the first two minutes, while an admin is
 * likely acting on a fresh request, then a thirty-second heartbeat. Every tick
 * is a forced token refresh and a document read, and a tab left open overnight
 * on "Waiting for approval" was 28,800 of each. Pure, in its own module, so it
 * can be tested where `session.ts` (native modules) cannot be imported.
 */
export function nextPollDelay(elapsedMs: number): number {
  return elapsedMs < 2 * 60 * 1000 ? 3000 : 30_000;
}
