import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { reportError } from './sentry';

/**
 * The Sentry DSN, as a Secret Manager secret. Declared once here and attached to
 * every function that should report, so `process.env.SENTRY_DSN` is populated at
 * runtime only where it is needed.
 */
export const SENTRY_DSN = defineSecret('SENTRY_DSN');

/**
 * A callable that reports UNEXPECTED errors to Sentry and rethrows.
 *
 * `HttpsError`s are the normal, expected failures — invalid-argument,
 * permission-denied, failed-precondition — and are NOT reported: they are the
 * boundary doing its job, and would drown a real bug in noise. Anything else is
 * a genuine surprise worth an alert. The report is flushed before the error
 * propagates (see sentry.ts), and the whole thing is inert without the secret,
 * so the emulator and tests are unaffected.
 */
export function reportedCall<T>(handler: (req: CallableRequest) => Promise<T>) {
  return onCall({ secrets: [SENTRY_DSN] }, async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      if (!(e instanceof HttpsError)) await reportError(e);
      throw e;
    }
  });
}
