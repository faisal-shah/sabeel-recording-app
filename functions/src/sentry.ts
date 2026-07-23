import * as Sentry from '@sentry/node';

// Server error reporting. The DSN is a SECRET (server-side, not shipped to any
// client) — set with `firebase functions:secrets:set SENTRY_DSN`. It reaches a
// function only when that function declares the secret (see reported.ts), so
// `process.env.SENTRY_DSN` is undefined everywhere else, including the emulator,
// where this stays a silent no-op.
let started = false;

function ensureStarted(): boolean {
  const dsn = process.env.SENTRY_DSN;
  // A real DSN is an https URL. Anything else — unset, or the `disabled`
  // sentinel that `functions/.secret.local` uses so the emulator stops probing
  // Secret Manager — leaves reporting off without letting a bad value reach
  // Sentry.init (which throws on a malformed DSN).
  if (!dsn || !dsn.startsWith('https://')) return false;
  if (!started) {
    Sentry.init({ dsn, tracesSampleRate: 0 });
    started = true;
  }
  return true;
}

/**
 * Report an unexpected error, then FLUSH — a Cloud Functions instance can freeze
 * the moment the handler returns, so an un-flushed event is lost. Awaited by the
 * wrapper before the error propagates.
 */
export async function reportError(e: unknown, context?: Record<string, string>): Promise<void> {
  if (!ensureStarted()) return;
  Sentry.captureException(e, context ? { tags: context } : undefined);
  await Sentry.flush(2000);
}
