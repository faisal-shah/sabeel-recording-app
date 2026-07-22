/**
 * Error-reporting seam. No-op until a Sentry DSN exists (see TODO.md).
 *
 * It exists now so call sites — liveQuery.ts first — are written against the
 * real shape from day one, and wiring Sentry later is a one-file change rather
 * than an edit to every caller. `.web.ts` sibling follows when the web SDK
 * differs from the native one.
 */
export function captureError(e: unknown, context?: Record<string, string>): void {
  console.warn('captureError', context ?? {}, e);
}
