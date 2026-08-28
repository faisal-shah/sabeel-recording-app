import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  NOTIFICATION_DESCRIPTION,
  NOTIFICATION_LABEL,
  STAFF_KINDS,
  STUDENT_KINDS,
  prefEnabled,
  type NotificationKind,
} from '@sabeel/shared';
import { Button, Card, Notice, Screen, SectionTitle, SwitchRow } from '../components/ui';
import { useListenerError } from '../liveQuery';
import { registerThisDevice, setNotificationPref, useNotificationPrefs } from '../notifications';
import { canOpenPushSettings, openPushSettings, pushPromptState } from '../push';
import { getTheme } from '../theme';

const t = getTheme();

type DeviceState = 'checking' | 'ready' | 'canAsk' | 'blocked' | 'unavailable';

/**
 * One switch per message, for whichever population is looking.
 *
 * Permission is asked on the BUTTON below, never on arrival. Opening a screen
 * is not a user gesture: the effect that runs on mount is a later task than the
 * tap that navigated here, so it carries no user activation, and Safari refuses
 * a permission request that far from a click — silently, leaving permission at
 * 'default' and the site in neither the allowed nor the blocked list. Mounting
 * therefore only registers a device that is ALREADY permitted, which needs no
 * gesture and keeps every working device working with no extra click.
 *
 * A device that cannot receive push says so rather than showing switches that
 * could never fire — an off switch and a switch with nothing behind it look
 * identical, and the second one is a lie.
 */
export function NotificationsScreen({ uid, isStudent }: { uid: string; isStudent: boolean }) {
  const listenerError = useListenerError();
  const prefs = useNotificationPrefs(uid);
  const [device, setDevice] = useState<DeviceState>('checking');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const state = await pushPromptState();
      if (cancelled) return;
      if (state !== 'granted') {
        setDevice(state === 'default' ? 'canAsk' : state === 'denied' ? 'blocked' : 'unavailable');
        return;
      }
      // Already permitted: claim the token silently so a device that granted
      // permission in an earlier visit keeps receiving without being asked
      // again.
      const token = await registerThisDevice(uid, false).catch(() => null);
      if (!cancelled) setDevice(token ? 'ready' : 'unavailable');
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  // The permission request must be the FIRST thing this handler does — see
  // resolveToken in push.web.ts. setAsking is synchronous, so it does not
  // separate the press from the request; an await here would.
  const turnOn = () => {
    setAsking(true);
    setError(null);
    void (async () => {
      const token = await registerThisDevice(uid, true).catch(() => null);
      setAsking(false);
      if (token) return setDevice('ready');
      // A null is not necessarily a refusal — permission can be granted and the
      // token still unobtainable — so re-read rather than assuming. It also
      // keeps the button when an Android dialog was dismissed rather than
      // refused, instead of sending someone to un-block what they never blocked.
      const state = await pushPromptState();
      setDevice(state === 'denied' ? 'blocked' : state === 'default' ? 'canAsk' : 'unavailable');
    })();
  };

  const kinds: NotificationKind[] = isStudent ? STUDENT_KINDS : STAFF_KINDS;

  const toggle = (kind: NotificationKind, next: boolean) =>
    void (async () => {
      setError(null);
      try {
        await setNotificationPref(uid, kind, next);
      } catch (e) {
        setError((e as Error).message);
      }
    })();

  return (
    <Screen title="Notifications" subtitle="What this app may send you">
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {device === 'canAsk' ? (
        <Card>
          <Notice tone="info">Notifications are not enabled on this device.</Notice>
          <Button
            testID="enable-push"
            label="Enable notifications"
            onPress={turnOn}
            busy={asking}
          />
        </Card>
      ) : null}

      {device === 'ready' ? (
        <Notice tone="info">Notifications are enabled on this device.</Notice>
      ) : null}

      {device === 'blocked' ? (
        <Card>
          <Notice tone="info">
            Notifications are blocked for this app on this device.
          </Notice>
          {/* Native can open its own settings page; a browser cannot, so there
              it is instructions or nothing. */}
          {canOpenPushSettings ? (
            <Button label="Open settings" variant="secondary" onPress={openPushSettings} />
          ) : (
            /* Plain text, not a second Notice: two stacked gold blocks in one
               card read as two separate alerts. The siblings pair a line with a
               lighter hint, and so does this. */
            <Text style={styles.deviceHint}>
              Allow them in your browser&apos;s site settings, then reopen this screen.
            </Text>
          )}
        </Card>
      ) : null}

      {device === 'unavailable' ? (
        <Notice tone="info">This device can&apos;t show notifications.</Notice>
      ) : null}

      <SectionTitle>Send me</SectionTitle>
      <Card>
        {kinds.map((kind, i) => (
          <View key={kind} style={i > 0 ? styles.divided : undefined}>
            <SwitchRow
              testID={`notify-${kind}`}
              label={NOTIFICATION_LABEL[kind]}
              description={NOTIFICATION_DESCRIPTION[kind]}
              on={prefEnabled(prefs, kind)}
              onChange={(next) => toggle(kind, next)}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /** secondary, not muted: muted is the caption token and fails AA on this surface. */
  deviceHint: { fontSize: 13, color: t.text.secondary },
  divided: { borderTopWidth: 1, borderTopColor: t.border.subtle },
});
