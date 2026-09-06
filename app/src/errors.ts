/**
 * What to put on screen when something a person asked for did not happen.
 *
 * THE SERVER'S OWN SENTENCES GET THROUGH, AND ONLY THOSE. This codebase writes
 * real messages into its callables — "The due date for this recording has
 * passed.", "Only an admin can disable an account." — and those are exactly what
 * the person needs to read. But a callable that throws without one surfaces its
 * CODE in the message's place, so the staff app rendered a full-width error band
 * whose entire text was `INTERNAL`: a machine token where a sentence goes, on a
 * screen that then also offered "widen your filters" as if the request had
 * merely found nothing.
 *
 * A code has no spaces in it and a sentence does, which is the whole test. The
 * raw value is still logged, because it is the thing worth having in Sentry.
 */
export function errorText(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const raw = (err?.message ?? '').trim();
  if (raw && /\s/.test(raw)) return raw;
  console.warn('request failed', err?.code ?? raw ?? 'unknown');
  return 'Something went wrong. Try again in a moment.';
}
