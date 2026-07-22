import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { USE_EMULATORS } from './env';
import { captureError } from './sentry';

export type BackendStatus =
  | { state: 'checking' }
  | { state: 'ok'; region: string }
  | { state: 'notConfigured' }
  | { state: 'error'; detail: string };

/**
 * Calls the `ping` callable once and reports what happened.
 *
 * Phase 0 exists to prove the harness, and a screen that only draws colours
 * proves only that Metro bundled. This makes the app→functions path real, which
 * is where this stack hides two traps worth catching on day one:
 *
 *  - the functions emulator accepts connections on its port BEFORE it has
 *    registered any function, so an early call 404s; a 404 carries no CORS
 *    headers, so the browser blames CORS and the callable surfaces a bare
 *    "internal". Seeing `ok` here means registration actually completed.
 *  - the emulator partitions by project id, so a mismatch between the app and
 *    `emulators:exec --project` fails here rather than silently much later.
 */
export function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>(
    USE_EMULATORS ? { state: 'checking' } : { state: 'notConfigured' },
  );

  useEffect(() => {
    // Without the emulators there is nothing to reach: firebase-config.ts still
    // holds placeholders until the real project exists (see TODO.md).
    if (!USE_EMULATORS) return;
    let cancelled = false;

    httpsCallable<unknown, { ok: boolean; region: string }>(
      functions,
      'ping',
    )()
      .then(({ data }) => {
        if (!cancelled) setStatus({ state: 'ok', region: data.region });
      })
      .catch((e: unknown) => {
        const detail = e instanceof Error ? e.message : String(e);
        captureError(e, { source: 'ping' });
        if (!cancelled) setStatus({ state: 'error', detail });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
