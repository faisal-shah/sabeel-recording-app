// Web side of the error-reporting seam (native sibling: sentry.ts).
//
// Reports only from a real (non-dev) bundle: `expo export` sets __DEV__ false, so
// the deployed web app reports while `expo start` and the e2e/test runs stay on
// the console. Without that gate every local run would pollute the production
// Sentry project. The DSN is a client value baked in at build time (see
// app/.env.local); if it is absent the seam is a silent console-only no-op.
import * as Sentry from '@sentry/browser';
import { IS_DEV } from './env';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN_WEB;
const ENABLED = !!DSN && !IS_DEV;
let started = false;

export function initSentry(): void {
  if (started || !ENABLED) return;
  Sentry.init({ dsn: DSN, tracesSampleRate: 0, environment: 'production' });
  started = true;
}

export function captureError(e: unknown, context?: Record<string, string>): void {
  if (ENABLED) {
    initSentry();
    Sentry.captureException(e, context ? { tags: context } : undefined);
  } else {
    console.warn('captureError', context ?? {}, e);
  }
}
