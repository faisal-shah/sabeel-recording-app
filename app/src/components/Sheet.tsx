import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Button } from './ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * A centred, size-bounded dialog. Ported from the sibling kanban app, whose
 * comments carry the reasoning; the two rules worth restating here are that it
 * bounds its own height and scrolls INSIDE that bound (so it can never run off
 * a short viewport), and that the backdrop is a pointer affordance with NO
 * accessibility role — react-native-web turns a role="button" into a real
 * <button> element, and nesting the panel's controls inside one makes a space
 * keypress dismiss the sheet.
 */
export function Sheet({
  visible,
  title,
  onClose,
  closeLabel = 'Close',
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} focusable={false}>
        {/* Absorbs taps so a press inside does not dismiss via the backdrop. */}
        <Pressable style={styles.panel} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {/* Quiet, and deliberately: this is the sheet's way OUT, sitting
              under a form whose primary is the reason the sheet is open. Filled,
              full width, it outweighed a disabled "Create account" above it. */}
          <Button label={closeLabel} variant="quiet" onPress={onClose} block />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One row inside a Sheet. */
export function SheetOption({
  label,
  detail,
  tone = 'normal',
  testID,
  onPress,
}: {
  label: string;
  detail?: string;
  tone?: 'normal' | 'danger';
  testID?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}
    >
      <Text style={[styles.optionLabel, tone === 'danger' ? styles.optionDanger : null]}>
        {label}
      </Text>
      {detail ? <Text style={styles.optionDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

/** A quiet divider label grouping rows inside a Sheet. */
export function SheetSection({ label }: { label: string }) {
  return <Text style={styles.section}>{label.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(4),
    backgroundColor: t.effect.overlay,
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: t.bg.raised,
    borderColor: t.border.strong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: spacing(4),
    gap: spacing(2),
  },
  title: { fontSize: 18, fontWeight: '700', color: t.text.primary },
  body: { flexGrow: 0 },
  bodyContent: { gap: spacing(1) },
  option: {
    borderRadius: 8,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(3),
    minHeight: 44,
    justifyContent: 'center',
  },
  optionPressed: { backgroundColor: t.bg.inset },
  optionLabel: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  optionDanger: { color: t.text.danger },
  optionDetail: { fontSize: 13, color: t.text.secondary, marginTop: 2 },
  section: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: t.text.secondary,
    marginTop: spacing(3),
    marginBottom: spacing(1),
    paddingHorizontal: spacing(3),
  },
});
