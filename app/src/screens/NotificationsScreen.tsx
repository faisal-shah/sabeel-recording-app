import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  NOTIFICATION_DESCRIPTION,
  NOTIFICATION_LABEL,
  STAFF_KINDS,
  STUDENT_KINDS,
  prefEnabled,
  type NotificationKind,
} from '@sabeel/shared';
import { Card, Notice, Screen, SectionTitle } from '../components/ui';
import { useListenerError } from '../liveQuery';
import { registerThisDevice, setNotificationPref, useNotificationPrefs } from '../notifications';
import { getTheme, spacing } from '../theme';

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
            <Toggle
              kind={kind}
              on={prefEnabled(prefs, kind)}
              onChange={(next) => toggle(kind, next)}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function Toggle({
  kind,
  on,
  onChange,
}: {
  kind: NotificationKind;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      testID={`notify-${kind}`}
      accessibilityRole="switch"
      // aria-checked, not accessibilityState: react-native-web has no mapping
      // for the latter and renders nothing at all, so a test would assert on an
      // attribute that never appears.
      aria-checked={on}
      accessibilityLabel={NOTIFICATION_LABEL[kind]}
      onPress={() => onChange(!on)}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.label}>{NOTIFICATION_LABEL[kind]}</Text>
        <Text style={styles.description}>{NOTIFICATION_DESCRIPTION[kind]}</Text>
      </View>
      <Text style={[styles.state, on ? styles.stateOn : null]}>{on ? 'On' : 'Off'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(2) },
  divided: { borderTopWidth: 1, borderTopColor: t.border.subtle, marginTop: spacing(2) },
  pressed: { opacity: 0.85 },
  rowMain: { flex: 1, paddingRight: spacing(3) },
  label: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  description: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  state: { fontSize: 14, fontWeight: '700', color: t.text.secondary },
  stateOn: { color: t.feedback.success },
});
