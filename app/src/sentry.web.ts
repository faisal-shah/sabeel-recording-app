// Web side of the error-reporting seam (native sibling: sentry.ts).
//
// Reports only from a real (non-dev) bundle: `expo export` sets __DEV__ false, so
// the deployed web app reports while `expo start` and the e2e/test runs stay on
// the console. Without that gate every local run would pollute the production
// Sentry project. The DSN is a client value baked in at build time (see
// app/.env.local); if it is absent the seam is a silent console-only no-op.
import * as Sentry from '@sentry/browser';
import { IS_DEV } from './env';
import { BUILD_LABEL } from './buildInfo';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN_WEB;
const ENABLED = !!DSN && !IS_DEV;
let started = false;

export function initSentry(): void {
  if (started || !ENABLED) return;
  // `release` is the sign-in screen's own label — version and commit — so an
  // event says which build produced it. Three WEB-4 incidents arrived without
  // one, and the first question about each was "which build was that?".
  Sentry.init({ dsn: DSN, tracesSampleRate: 0, environment: 'production', release: BUILD_LABEL });
  started = true;
}

/**
 * The account's ROLE on every event from here on — never who they are.
 *
 * The privacy policy promises that crash reports carry no name, no email
 * address and no account identifier, and that this is enforced in the code:
 * `app/src/sentry.test.ts` holds that line. A role is not an identity, and it
 * is the one fact that tells a refused admin read from a refused manager read
 * when the two share a listener label.
 */
export function setSentryRole(role: string | null): void {
  if (!ENABLED) return;
  initSentry();
  Sentry.setTag('role', role ?? 'none');
}

export function captureError(
  e: unknown,
  context?: Record<string, string>,
  extra?: Record<string, unknown>,
): void {
  if (ENABLED) {
    initSentry();
    // `fingerprint`, when the caller sets one, groups the event by what it
    // names rather than by the reporting frame; everything else in `extra`
    // rides along as event data.
    const { fingerprint, ...rest } = extra ?? {};
    Sentry.captureException(e, {
      ...(context ? { tags: context } : {}),
      ...(Object.keys(rest).length ? { extra: rest } : {}),
      ...(Array.isArray(fingerprint) ? { fingerprint: fingerprint as string[] } : {}),
    });
  } else {
    console.warn('captureError', context ?? {}, extra ?? {}, e);
  }
}
