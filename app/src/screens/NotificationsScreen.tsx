import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  NOTIFICATION_DESCRIPTION,
  NOTIFICATION_LABEL,
  STAFF_KINDS,
  STUDENT_KINDS,
  prefEnabled,
  type NotificationKind,
} from '@sabeel/shared';
import { Card, Notice, Screen, SectionTitle, SwitchRow } from '../components/ui';
import { useListenerError } from '../liveQuery';
import { registerThisDevice, setNotificationPref, useNotificationPrefs } from '../notifications';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * One switch per message, for whichever population is looking.
 *
 * Registering this device happens HERE, on arrival, rather than at sign-in: the
 * permission prompt has to follow a user gesture (browsers block one that does
 * not, permanently), and opening the notification settings is the one moment a
 * person has plainly asked about notifications.
 *
 * A device that cannot receive push says so rather than showing switches that
 * could never fire — an off switch and a switch with nothing behind it look
 * identical, and the second one is a lie.
 */
export function NotificationsScreen({ uid, isStudent }: { uid: string; isStudent: boolean }) {
  const listenerError = useListenerError();
  const prefs = useNotificationPrefs(uid);
  const [device, setDevice] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await registerThisDevice(uid).catch(() => null);
      if (!cancelled) setDevice(token ? 'ready' : 'unavailable');
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

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

      {device === 'unavailable' ? (
        <Notice tone="info">
          This device can&apos;t receive notifications — either they&apos;re turned off for this app
          in your device settings, or this browser doesn&apos;t support them. Your choices below are
          saved either way, and apply on any device where you are signed in.
        </Notice>
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
  divided: { borderTopWidth: 1, borderTopColor: t.border.subtle },
});
