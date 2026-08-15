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

let cached: string | null | undefined;

export async function devicePushToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  cached = await resolveToken();
  return cached;
}

async function resolveToken(): Promise<string | null> {
  try {
    // Android 13+ requires the runtime permission. The manifest declaration is
    // already there for the lock-screen media controls (see player.ts), so this
    // is only the prompt — and it is asked from the settings screen, on a user
    // gesture, rather than on launch.
    const existing = await getPermissionsAsync();
    const granted =
      existing.granted || (await requestPermissionsAsync()).granted;
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
