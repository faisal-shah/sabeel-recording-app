import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two components draw a push, and each reads its own manifest keys.
 *
 * A message that arrives with the app in the background or closed is drawn
 * by the FCM SDK from `com.google.firebase.messaging.default_notification_*`.
 * One that arrives in the foreground, or a local notification, is drawn by
 * expo-notifications from `expo.modules.notifications.default_notification_*`
 * — and with those absent, `ExpoNotificationBuilder` falls back to the
 * launcher icon, whose silhouette is a full-bleed square, untinted. The
 * sibling kanban app shipped with only the FCM pair and showed two different
 * small icons from one app minutes apart (2026-09-16). This app shows a push
 * that arrives while it is open (push.ts), so both pairs are load-bearing;
 * whoever draws the push must draw the same icon.
 */
const manifest = readFileSync(
  resolve(import.meta.dirname, '../../../app/android/app/src/main/AndroidManifest.xml'),
  'utf8',
);
const meta = (name: string) =>
  manifest.match(new RegExp(`android:name="${name}"[^>]*android:resource="([^"]+)"`))?.[1];

describe('the push small icon', () => {
  it.each([
    ['com.google.firebase.messaging.default_notification_icon', 'expo.modules.notifications.default_notification_icon'],
    ['com.google.firebase.messaging.default_notification_color', 'expo.modules.notifications.default_notification_color'],
  ])('%s and %s point at one resource', (fcm, expo) => {
    expect(meta(fcm)).toBeTruthy();
    expect(meta(expo)).toBe(meta(fcm));
  });

  it('is a drawable with a silhouette, not the launcher mipmap', () => {
    expect(meta('com.google.firebase.messaging.default_notification_icon')).toMatch(/^@drawable\//);
  });
});
