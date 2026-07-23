// Native side of the error-reporting seam (web sibling: sentry.web.ts).
//
// Same discipline as web: report only from a non-dev bundle, so debug builds and
// Metro dev runs stay console-only and never pollute the production Sentry
// project. The DSN is a client value from app/.env.local, baked into the release
// bundle; absent, this is a silent console-only no-op.
//
// `@sentry/react-native` links a native module via RN autolinking (no prebuild
// needed for capture). Source-map upload — which needs a Sentry auth token and
// the Gradle plugin — is deferred; until then, release stack traces are
// minified but the errors do report.
import * as Sentry from '@sentry/react-native';
import { IS_DEV } from './env';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN_ANDROID;
const ENABLED = !!DSN && !IS_DEV;
let started = false;

export function initSentry(): void {
  if (started || !ENABLED) return;
  Sentry.init({ dsn: DSN, tracesSampleRate: 0 });
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
