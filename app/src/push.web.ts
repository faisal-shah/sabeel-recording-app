import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app } from './firebase';
import { VAPID_PUBLIC_KEY } from './firebase-config';

/**
 * Web side of the push seam (native sibling: push.ts).
 *
 * Web push needs three things the SDK does not supply, and missing any of them
 * fails silently rather than loudly:
 *
 *  1. A **service worker** at the origin root — `/firebase-messaging-sw.js`.
 *     It lives in `app/public/`, which `expo export` copies verbatim into
 *     `dist-web`. Firebase Hosting serves a matching real file before applying
 *     the `**` → `/index.html` rewrite, so no rewrite exception is needed, but
 *     the file must genuinely be in the export — verify against the exported
 *     bundle, never the dev server.
 *  2. A **VAPID key pair**, generated in the console. The public half is not a
 *     secret and ships in the bundle; without it `getToken` throws.
 *  3. **Notification permission**, which only a user gesture may request. The
 *     settings screen asks; nothing here prompts on load.
 *
 * Every failure returns null. A browser with notifications blocked, an
 * unsupported one, and a build with no VAPID key are all the same answer to the
 * caller — "this device cannot receive push" — and the settings screen says so
 * rather than showing switches that could never fire.
 */

export const pushPlatform = 'web' as const;

let cached: string | null | undefined;

export async function devicePushToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  cached = await resolveToken();
  return cached;
}

async function resolveToken(): Promise<string | null> {
  if (!VAPID_PUBLIC_KEY) return null;
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (!(await isSupported().catch(() => false))) return null;

  // Permission is requested here rather than on load: browsers ignore — and
  // Chrome permanently blocks — a prompt that did not follow a user gesture.
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== 'granted') return null;

  try {
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    // `register()` resolves as soon as the script is FETCHED, not once a worker
    // is running it. Handing that registration straight to getToken fails with
    // "Subscription failed - no active Service Worker" — on a first-ever visit
    // only, because every later load already has one activated. `ready` is the
    // promise that waits for an active worker in this page's scope.
    //
    // Raced against a timeout because `ready` never REJECTS: a worker that fails
    // to activate leaves it pending forever, and the settings screen would sit
    // on "checking" with no notice and no error — the worst of the three
    // outcomes, because it looks like it is still working.
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);
    if (!registration) return null;
    return await getToken(getMessaging(app), {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration,
    });
  } catch {
    // A missing service worker, a revoked key, a browser in a private mode that
    // refuses registration. None of them is worth an error banner over a
    // convenience feature.
    return null;
  }
}
