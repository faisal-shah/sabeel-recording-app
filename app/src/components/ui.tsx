import { Children, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getTheme, spacing } from '../theme';
import { useListenerError } from '../liveQuery';
import { KbScroll } from './KbScroll';

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
    <KbScroll style={styles.canvas} contentContainerStyle={styles.content}>
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
    </KbScroll>
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
  compact,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  /** A row-level action sitting beside a name, not a full-width page action. */
  compact?: boolean;
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
        compact ? styles.btnCompact : null,
        style,
        pressed && !isDisabled ? styles.btnPressed : null,
        isDisabled ? styles.btnDisabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'secondary' ? t.text.primary : t.accent.onAccent} />
      ) : (
        // A label may wrap between words, but must never break INSIDE one:
        // "Submit att / endance" is what a phone at a large accessibility font
        // size does otherwise. Two lines are allowed, and if a single word still
        // does not fit, the text scales down rather than splitting — the person
        // asked for large text, so shrink only as the last resort and only as far
        // as minimumFontScale.
        <Text
          style={[styles.btnText, isDisabled ? styles.btnDisabledText : textStyle]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A single-glyph action for a list row — remove, disable, re-enable.
 *
 * Glyphs are TEXT-presentation characters (`×`, `↺`), never emoji: an emoji
 * renders as a colour bitmap that ignores `color`, so a destructive control
 * would not read as destructive. There is no icon font in this app, and adding
 * one to draw two shapes is not worth the bundle.
 *
 * Icon-only means the label is invisible, so `label` is required and becomes the
 * accessibility name — a screen reader gets "Remove Fatima Ahmed from the
 * course", not "times". The square is 44pt because that is the minimum touch
 * target, even though the glyph inside is small.
 */
export function IconButton({
  glyph,
  label,
  variant = 'secondary',
  busy,
  disabled,
  onPress,
  testID,
}: {
  glyph: string;
  /** Required: with no visible text this IS the button's name. */
  label: string;
  variant?: 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const isDisabled = disabled || busy;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.iconBtn,
        variant === 'danger' ? styles.iconBtnDanger : styles.iconBtnSecondary,
        pressed && !isDisabled ? styles.btnPressed : null,
        isDisabled ? styles.btnDisabled : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'danger' ? t.text.danger : t.text.primary} />
      ) : (
        <Text
          style={[
            styles.iconGlyph,
            variant === 'danger' ? styles.iconGlyphDanger : styles.iconGlyphSecondary,
            isDisabled ? styles.btnDisabledText : null,
          ]}
        >
          {glyph}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * One person in a list: name (and status) on the first line, details under it,
 * actions on the right of the same line — wrapping to their own line when the
 * name needs the width.
 */
export function PersonRow({
  name,
  status,
  detail,
  actions,
}: {
  name: string;
  status?: ReactNode;
  detail?: string;
  actions: ReactNode;
}) {
  return (
    <View style={styles.personCard}>
      <View style={styles.personHead}>
        {/* Name, status and detail are ONE block, so when the actions wrap to
            their own line they go below the whole identity rather than landing
            between the name and the email. */}
        <View style={styles.personIdent}>
          <View style={styles.personNameLine}>
            <Text style={styles.personName}>{name}</Text>
            {status ?? null}
          </View>
          {detail ? <Text style={styles.personDetail}>{detail}</Text> : null}
        </View>
        <View style={styles.personActions}>{actions}</View>
      </View>
    </View>
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

/**
 * A status word. The dot carries the colour; the label stays readable text —
 * colouring the label itself fails the moment the colour is a light one.
 *
 * Mapped explicitly rather than "anything unrecognised is a warning": that
 * default painted `published` amber, which reads as a problem on a recording
 * that is working exactly as intended. Amber is reserved for states a human
 * has to act on.
 */
const STATUS_TONE: Record<string, 'good' | 'bad' | 'attention' | 'neutral'> = {
  active: 'good',
  published: 'good',
  disabled: 'bad',
  needsAttention: 'attention',
  pending: 'attention',
  draft: 'neutral',
  unpublished: 'neutral',
  archived: 'neutral',
  inactive: 'neutral',
};

export function StatusChip({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  const dot =
    tone === 'good'
      ? t.feedback.success
      : tone === 'bad'
        ? t.feedback.danger
        : tone === 'attention'
          ? t.feedback.warning
          : t.text.muted;
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
 *
 * Items GROW to share a line but never SHRINK (see `rowItem`). Shrinking is what
 * produced a Publish button squeezed to a third of its neighbour with its label
 * broken mid-word — "Publ / ish" — on a real phone. A row is allowed to wrap; it
 * is not allowed to crush a control below the width of its own text.
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

/**
 * A destructive action that TAKES OVER while it is being confirmed.
 *
 * `children` are the card's normal actions. While the confirm is open they are
 * not rendered at all — which is the whole point. The first version of this was
 * hand-rolled twice and simply appended the warning BELOW the live buttons, so
 * during "permanently delete this?" the Listen/Publish/Back-to-draft row stayed
 * tappable and two red panels stacked. A confirmation that leaves the thing it
 * is guarding still operable is not a confirmation.
 *
 * Owns its own open state so a caller cannot forget to reset it, and renders
 * nothing at all when `enabled` is false (e.g. a published recording, which must
 * be unpublished first).
 */
export function ConfirmDanger({
  enabled = true,
  label,
  confirmLabel,
  warning,
  busy,
  onConfirm,
  testID,
  confirmTestID,
  children,
}: {
  enabled?: boolean;
  /** The button that opens the confirm. */
  label: string;
  /** The button that performs it. */
  confirmLabel: string;
  warning: string;
  busy?: boolean;
  onConfirm: () => void;
  testID?: string;
  confirmTestID?: string;
  /** The actions this replaces while confirming. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // If the underlying thing stops being deletable while the confirm is open
  // (someone else published it), close it — otherwise the stale `open` would
  // spring the confirm back the moment it became deletable again.
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  if (open) {
    return (
      <View style={styles.confirm}>
        <Notice tone="error">{warning}</Notice>
        <Row>
          <Button
            testID={confirmTestID}
            label={confirmLabel}
            variant="danger"
            busy={busy}
            onPress={onConfirm}
          />
          <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => setOpen(false)} />
        </Row>
      </View>
    );
  }

  return (
    <>
      {children}
      <View style={styles.dangerZone}>
        <Button testID={testID} label={label} variant="danger" onPress={() => setOpen(true)} />
      </View>
    </>
  );
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
  // flexShrink 0 is load-bearing, not a tidy-up: with shrink enabled a line that
  // does not quite fit squeezes its items instead of wrapping, and a squeezed
  // button breaks its label mid-word. Refusing to shrink means the line either
  // fits or wraps — both readable. maxWidth caps the one case shrink used to
  // cover: a basis wider than the container itself, on a very narrow screen.
  rowItem: { flexGrow: 1, flexShrink: 0, flexBasis: 150, maxWidth: '100%' },

  // --- compact row actions -------------------------------------------------
  btnCompact: { paddingVertical: spacing(2), paddingHorizontal: spacing(3), minHeight: 40 },
  iconBtn: {
    width: 44,
    height: 44, // minimum touch target, whatever the glyph's size
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnSecondary: { backgroundColor: t.bg.sage },
  iconBtnDanger: { backgroundColor: t.bg.dangerSoft },
  iconGlyph: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
  iconGlyphSecondary: { color: t.text.primary },
  iconGlyphDanger: { color: t.text.danger },

  // --- a person in a list --------------------------------------------------
  personCard: {
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  // Wraps rather than squeezes: a long name pushes the actions onto their own
  // line instead of crushing them (see `rowItem` for why shrink is never on).
  personHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing(2),
    minHeight: 52,
  },
  personIdent: { flexGrow: 1, flexShrink: 1, flexBasis: 180, gap: 2 },
  personNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing(2),
  },
  personName: { fontSize: 16, fontWeight: '600', color: t.text.primary, flexShrink: 1 },
  // Centred when they wrap to their own line, right-hand end when they share the
  // name's line — one rule that reads correctly in both.
  personActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(2),
    flexGrow: 1,
    flexBasis: 'auto',
  },
  // secondary, not muted: an email address is content someone reads, and true
  // taupe on ivory is ~2.7:1 — reserved for text you could delete without
  // losing anything.
  personDetail: { fontSize: 13, color: t.text.secondary },
  empty: { fontSize: 14, color: t.text.secondary, paddingVertical: spacing(3) },
  // Separated from the actions above it, so a destructive button is never the
  // one you hit by muscle memory.
  dangerZone: {
    marginTop: spacing(4),
    paddingTop: spacing(3),
    borderTopWidth: 1,
    borderTopColor: t.border.subtle,
  },
  confirm: { gap: spacing(2) },
});
