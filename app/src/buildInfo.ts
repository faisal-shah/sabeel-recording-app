import appConfig from '../app.json';

/**
 * Build identity shown on the sign-in screen (see SignInScreen).
 *
 * Faisal's standing rule: every app surfaces its version and build commit on the
 * login screen, so a screenshot of a problem always says which build produced
 * it. The version is the single source of truth in `app.json`; the commit is
 * injected at build time via `EXPO_PUBLIC_COMMIT` (Metro inlines it into the
 * bundle) and falls back to `dev` for a local bundle that skipped the release
 * path. Keep both wired whenever this app is rebuilt or exported.
 */
const APP_VERSION: string = appConfig.expo.version;
const APP_COMMIT: string = process.env.EXPO_PUBLIC_COMMIT ?? 'dev';
export const BUILD_LABEL = `v${APP_VERSION} · ${APP_COMMIT}`;
