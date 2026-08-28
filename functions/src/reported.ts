import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { reportError } from './sentry';

/** A `defineSecret` handle — bound to a function so its value is in the env. */
export type Secret = ReturnType<typeof defineSecret>;

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
/**
 * Non-default runtime limits for one callable.
 *
 * Everything here runs on the platform defaults — 60 s and 256 MiB — which is
 * right for a callable that writes a few documents and wrong for one that moves
 * media. Opt in per function rather than raising the floor for all of them: a
 * long timeout on a handler that should return instantly hides a hang.
 */
export interface CallableRuntime {
  timeoutSeconds?: number;
  memory?: '256MiB' | '512MiB' | '1GiB' | '2GiB';
}

export function reportedCall<T>(
  handler: (req: CallableRequest) => Promise<T>,
  extraSecrets: Secret[] = [],
  runtime: CallableRuntime = {},
) {
  return onCall({ secrets: [SENTRY_DSN, ...extraSecrets], ...runtime }, async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      if (!(e instanceof HttpsError)) await reportError(e);
      throw e;
    }
  });
}
