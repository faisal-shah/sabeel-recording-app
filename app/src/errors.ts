/**
 * What to put on screen when something a person asked for did not happen.
 *
 * THE SENTENCES THIS CODEBASE WROTE GET THROUGH; MACHINE TOKENS DO NOT. The
 * callables here carry real messages — "The due date for this recording has
 * passed.", "Only an admin can disable an account." — and those are exactly what
 * the person needs to read. A callable that throws without one surfaces its CODE
 * in the message's place instead, so the staff app rendered a full-width error
 * band whose entire text was `INTERNAL`, on a screen that then also offered
 * "widen your filters" as if the request had merely found nothing.
 *
 * Two shapes are turned away:
 *
 *  - a bare code, which has no spaces in it (`internal`, `unauthenticated`);
 *  - the Firebase SDK's own assembled string, `Firebase: <something>
 *    (service/code).`, which has spaces but is a library talking to a developer.
 *    Staff resending a password link were reading `Firebase: Error
 *    (auth/user-not-found).` off the screen.
 *
 * The raw value is logged either way, because it is the thing worth having in
 * Sentry.
 */
export function errorText(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const raw = (err?.message ?? '').trim();
  if (raw && /\s/.test(raw) && !/^Firebase:/.test(raw)) return raw;
  console.warn('request failed', err?.code || raw || 'unknown');
  return 'Something went wrong. Try again in a moment.';
}
