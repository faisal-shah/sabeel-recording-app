import { Pressable, StyleSheet, Text } from 'react-native';
import { Button, Card } from './ui';
import { usePushNudge } from '../pushNudge';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * The sign-in nudge. Renders nothing unless this device can still be asked and
 * the person has not already waved it away — see pushNudge.ts.
 *
 * "Not now" is deliberately a low-emphasis link rather than a second button:
 * it sits on the busiest screen in the app, above the listening list, and two
 * equal-weight buttons both out-shouted that list and doubled the height the
 * card steals from it.
 */
export function PushNudge({ uid }: { uid: string }) {
  const { visible, busy, enable, dismiss } = usePushNudge(uid);
  if (!visible) return null;
  return (
    <Card>
      <Text style={styles.text}>Notifications are not enabled on this device.</Text>
      <Button
        testID="nudge-enable-push"
        label="Enable notifications"
        busy={busy}
        onPress={enable}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Not now"
        onPress={dismiss}
        style={styles.dismiss}
      >
        <Text style={styles.dismissText}>Not now</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 14, color: t.text.primary },
  /** 44pt of real target, not hitSlop — neighbouring slops overlap. */
  dismiss: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dismissText: { fontSize: 14, color: t.text.muted },
});
