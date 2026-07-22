import { Children, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getTheme, spacing } from '../theme';
import { useListenerError } from '../liveQuery';

const t = getTheme();

/**
 * Shared primitives. Brand rules live here rather than in each screen:
 * chrome is ivory, raspberry is reserved for the primary action, and every
 * colour comes from a semantic token (ESLint rejects a literal anywhere else).
 */

/**
 * Page wrapper. Renders the latest live-data error above the content — a
 * rejected listener otherwise dies as a console warning nobody sees on a phone.
 */
export function Screen({ title, subtitle, children }: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const listenerError = useListenerError();
  return (
    <ScrollView style={styles.canvas} contentContainerStyle={styles.content}>
      {/* Chrome is ivory with a dark title, never a raspberry app bar: a
          brand-coloured bar on every screen puts raspberry far past its share. */}
      {title ? <Text style={styles.h1}>{title}</Text> : null}
      {subtitle ? <Text style={styles.lede}>{subtitle}</Text> : null}
      {listenerError ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{listenerError}</Text>
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const isDisabled = disabled || busy;
  const style =
    variant === 'primary'
      ? styles.btnPrimary
      : variant === 'danger'
        ? styles.btnDanger
        : styles.btnSecondary;
  const textStyle = variant === 'secondary' ? styles.btnSecondaryText : styles.btnPrimaryText;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        style,
        pressed && !isDisabled ? styles.btnPressed : null,
        isDisabled ? styles.btnDisabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'secondary' ? t.text.primary : t.accent.onAccent} />
      ) : (
        <Text style={[styles.btnText, isDisabled ? styles.btnDisabledText : textStyle]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'none',
  keyboardType,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'words';
  keyboardType?: 'email-address' | 'default';
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.text.muted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
      />
    </View>
  );
}

/** An inline message. `tone` picks the functional colour, never a brand hue. */
export function Notice({ tone, children }: { tone: 'info' | 'error' | 'success'; children: ReactNode }) {
  const bg =
    tone === 'error' ? t.bg.dangerSoft : tone === 'success' ? t.bg.sage : t.bg.goldSoft;
  const fg =
    tone === 'error' ? t.text.danger : tone === 'success' ? t.feedback.success : t.text.secondary;
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Text style={[styles.noticeText, { color: fg }]}>{children}</Text>
    </View>
  );
}

/** A status word. The dot carries the colour; the label stays readable text. */
export function StatusChip({ status }: { status: string }) {
  const dot =
    status === 'active'
      ? t.feedback.success
      : status === 'disabled'
        ? t.feedback.danger
        : t.feedback.warning;
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: dot }]} />
      <Text style={styles.chipText}>{status}</Text>
    </View>
  );
}

/**
 * Lays controls out side by side, wrapping instead of overflowing.
 *
 * Each child is wrapped rather than styled directly, so the flex behaviour
 * belongs to the row: putting flexGrow on the button itself made every
 * standalone button stretch to fill the column it sat in.
 */
export function Row({ children }: { children: ReactNode }) {
  return (
    <View style={styles.row}>
      {Children.map(children, (child) =>
        child ? <View style={styles.rowItem}>{child}</View> : null,
      )}
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  // secondary, not muted: an empty-state message conveys information.
  return <Text style={styles.empty}>{children}</Text>;
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: t.bg.canvas },
  content: {
    padding: spacing(5),
    paddingBottom: spacing(12),
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  h1: { fontSize: 26, fontWeight: '700', color: t.text.primary },
  lede: { fontSize: 15, color: t.text.secondary, marginTop: spacing(1), marginBottom: spacing(4) },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
    marginTop: spacing(4),
    marginBottom: spacing(2),
  },
  card: {
    backgroundColor: t.bg.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border.subtle,
    padding: spacing(4),
    marginBottom: spacing(3),
  },
  btn: {
    borderRadius: 8,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(4),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing(2),
  },
  btnPrimary: { backgroundColor: t.accent.base },
  btnSecondary: { backgroundColor: t.bg.sage },
  btnDanger: { backgroundColor: t.feedback.danger },
  btnPressed: { opacity: 0.85 },
  // Neutral rather than a faded brand fill: a washed-out raspberry block still
  // pulls the eye harder than the live control next to it.
  btnDisabled: { backgroundColor: t.bg.inset },
  btnDisabledText: { color: t.text.muted },
  btnText: { fontSize: 15, fontWeight: '600' },
  btnPrimaryText: { color: t.accent.onAccent },
  btnSecondaryText: { color: t.text.primary },
  field: { marginTop: spacing(3) },
  fieldLabel: { fontSize: 13, color: t.text.secondary, marginBottom: spacing(1) },
  input: {
    backgroundColor: t.bg.inset,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border.subtle,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(3),
    fontSize: 15,
    color: t.text.primary,
    minHeight: 44,
  },
  notice: {
    borderRadius: 8,
    padding: spacing(3),
    marginTop: spacing(3),
  },
  noticeText: { fontSize: 14 },
  errorBanner: {
    backgroundColor: t.bg.dangerSoft,
    borderRadius: 8,
    padding: spacing(3),
    marginBottom: spacing(3),
  },
  errorText: { fontSize: 13, color: t.text.danger },
  chip: { flexDirection: 'row', alignItems: 'center' },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing(1.5) },
  chipText: { fontSize: 13, color: t.text.secondary },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: spacing(2),
    paddingVertical: spacing(1),
  },
  rowItem: { flexGrow: 1, flexShrink: 1, flexBasis: 150 },
  empty: { fontSize: 14, color: t.text.secondary, paddingVertical: spacing(3) },
});
