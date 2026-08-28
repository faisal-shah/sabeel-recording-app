import { Pressable, StyleSheet, Text } from 'react-native';
import { Button, Card } from './ui';
import { usePushNudge } from '../pushNudge';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * The sign-in nudge. Renders nothing unless this device can still be asked and
 * the person has not already waved it away — see pushNudge.ts.
 *
 * "Not now" is a link rather than a second button: it sits above the listening
 * list, and two equal-weight buttons both out-shouted that list and doubled the
 * height the card steals from it. It uses this app's documented link treatment
 * — accent plus underline — so it reads as something to tap rather than as a
 * caption sitting under the button.
 */
export function PushNudge({ uid }: { uid: string }) {
  const { visible, busy, failed, enable, dismiss } = usePushNudge(uid);
  if (!visible) return null;
  return (
    <Card>
      <Text style={styles.text}>
        {failed
          ? "This device can't show notifications."
          : 'Notifications are not enabled on this device.'}
      </Text>
      {/* No Enable button once it has failed — pressing again would do the same
          nothing. Dismissing is the only useful action left. */}
      {failed ? null : (
        <Button
          testID="nudge-enable-push"
          label="Enable notifications"
          busy={busy}
          onPress={enable}
        />
      )}
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
  /**
   * Left, hugging its text — NOT centred across the card. Still a real 44pt box
   * rather than hitSlop, because neighbouring slops overlap.
   */
  dismiss: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  /** This app's link treatment (see ledeLink in ui.tsx): accent + underline. */
  dismissText: { fontSize: 14, color: t.text.accent, textDecorationLine: 'underline' },
});
