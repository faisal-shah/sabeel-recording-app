import {
  AndroidImportance,
  getDevicePushTokenAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  setNotificationChannelAsync,
} from 'expo-notifications';

/**
 * Native side of the push seam (web sibling: push.web.ts).
 *
 * `getDevicePushTokenAsync` returns the **FCM device token**, which is what
 * `admin.messaging()` sends to. Its neighbour `getExpoPushTokenAsync` returns an
 * ExponentPushToken, which only Expo's own push service understands — sending
 * one of those to FCM fails with an invalid-token error that reads like a
 * configuration problem and is not one. This project sends from the Admin SDK,
 * so it is the device token or nothing.
 *
 * Every failure returns null: no permission, no Play Services, a build with no
 * messaging config. The settings screen then says this device cannot receive
 * push rather than showing switches that could never fire.
 */

export const pushPlatform = 'android' as const;

/** Android will not display a notification that has no channel to land in. */
const CHANNEL_ID = 'default';

/**
 * Only a SUCCESSFUL token is remembered. Caching the null too made every failure
 * permanent for the life of the process: someone who declined the Android prompt
 * and then enabled notifications in system settings stayed "unavailable" until
 * the app was killed.
 */
let cached: string | null = null;

/**
 * This device's push token, or null if it cannot have one.
 *
 * `prompt` decides whether someone who has not been asked yet IS asked. The
 * settings screen passes true — a user gesture, and the one moment a person has
 * plainly asked about notifications. Sign-out passes false: it must never raise
 * the permission dialog on the way out, and someone who never granted permission
 * has no registration to drop.
 */
/**
 * What the settings screen should offer: ask, explain, or say nothing can be
 * done here. Mirrors the web sibling; `canAskAgain` is Android's way of saying
 * the prompt has been spent, which is the same dead end as a browser 'denied'.
 */
export async function pushPromptState(): Promise<
  'granted' | 'denied' | 'default' | 'unsupported'
> {
  try {
    const existing = await getPermissionsAsync();
    if (existing.granted) return 'granted';
    return existing.canAskAgain ? 'default' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function devicePushToken(prompt: boolean): Promise<string | null> {
  if (cached) return cached;
  cached = await resolveToken(prompt);
  return cached;
}

async function resolveToken(prompt: boolean): Promise<string | null> {
  try {
    // Android 13+ requires the runtime permission. The manifest declaration is
    // already there for the lock-screen media controls (see player.ts), so this
    // is only the prompt — and it is asked from the settings screen, on a user
    // gesture, rather than on launch.
    const existing = await getPermissionsAsync();
    const granted =
      existing.granted || (prompt ? (await requestPermissionsAsync()).granted : false);
    if (!granted) return null;

    // Created before the first message arrives, not after: a notification
    // delivered to a channel that does not exist yet is dropped silently, and
    // the only symptom is the first one never appearing.
    await setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Class recordings',
      importance: AndroidImportance.DEFAULT,
    });

    const token = await getDevicePushTokenAsync();
    return typeof token.data === 'string' ? token.data : null;
  } catch {
    return null;
  }
}
