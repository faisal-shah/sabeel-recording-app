import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CONTENT_MAX_WIDTH, LAYOUT_WIDTHS, getTheme, spacing, type LayoutWidth } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListenerError } from '../liveQuery';
import { useRoomy, useWide } from '../useWidth';
import { KbScroll } from './KbScroll';
import { Sheet } from './Sheet';

const t = getTheme();

/**
 * Shared primitives. Brand rules live here rather than in each screen:
 * chrome is ivory, raspberry is reserved for the primary action, and every
 * colour comes from a semantic token (ESLint rejects a literal anywhere else).
 */

/**
 * WHETHER THIS SCREEN MUST PAY FOR THE STATUS BAR ITSELF.
 *
 * True on the tab roots, which run with no stack header. Set by the navigation
 * shell, which is the only thing that knows which route is showing; a screen
 * cannot answer it, and hard-coding it per screen would be a second copy of the
 * shell's own list.
 */
export const ScreenOwnsTopInset = createContext(false);

/**
 * Page wrapper. Renders the latest live-data error above the content — a
 * rejected listener otherwise dies as a console warning nobody sees on a phone.
 */
export function Screen({ title, subtitle, status, parent, width = 'read', actions, children }: {
  title?: string;
  subtitle?: string;
  /**
   * Which maximum this screen's content stops growing at. See `LAYOUT_WIDTHS` —
   * prose and forms want a narrow reading column, collections want the room.
   * Defaulting to `read` is deliberate: a screen that has not thought about it
   * is far more likely to be a form than a grid, and an over-narrow column is a
   * cosmetic fault where an over-wide one is unreadable.
   */
  width?: LayoutWidth;
  /**
   * Screen-level actions, rendered beside the heading on a wide screen and
   * beneath it on a phone. A primary action belongs next to the title it acts
   * on, not stranded at the bottom of a 1400px window.
   */
  actions?: ReactNode;
  /** The state of the thing this screen is about. Rendered as a lamp on the
   *  LEFT of the heading, with the heading centred against it — the same shape
   *  on a phone and on a wide screen. */
  status?: string;
  /**
   * The thing this screen belongs to, as the first part of the subtitle and a
   * way back to it. The subtitle on a nested screen already NAMED its parent —
   * this makes that name the link rather than adding a second one, so the header
   * gains an affordance and no new line.
   *
   * Not a substitute for the header's Back arrow, which returns wherever you
   * came from: two screens down inside a course, that is the list you came
   * through, not the course. Both are useful and they do different things.
   */
  parent?: { label: string; testID: string; onPress: () => void };
  children: ReactNode;
}) {
  const listenerError = useListenerError();
  const wide = useWide();
  const insets = useSafeAreaInsets();
  const ownsTopInset = useContext(ScreenOwnsTopInset);
  const max = LAYOUT_WIDTHS[width];
  const heading =
    title || subtitle || parent ? (
      <View style={styles.headRow}>
        <View style={styles.headText}>
          {/* THE TITLE STARTS AT THE MARGIN. The status lamp used to hold a 56px
              gutter to its left, which pushed the H1 68px right of every section
              label beneath it — the page read as indented from its own content.
              It rides the lede line instead, where it is still the first thing
              under the name. */}
          {title ? <Text style={styles.h1}>{title}</Text> : null}
          {status ? <StatusLight status={status} /> : null}
          {parent || subtitle ? (
            <Text style={styles.lede}>
              {parent ? (
                // Underlined, not coloured alone: colour by itself does not say
                // "link" to anyone who cannot see it as different from the text
                // beside it. NESTED in the subtitle Text so it wraps with the
                // rest of the line instead of being a block of its own.
                <Text
                  style={styles.ledeLink}
                  role="link"
                  testID={parent.testID}
                  aria-label={`Go to ${parent.label}`}
                  onPress={parent.onPress}
                >
                  {parent.label}
                </Text>
              ) : null}
              {parent && subtitle ? ' · ' : ''}
              {subtitle}
            </Text>
          ) : null}
        </View>
        {/* ONE POSITION, at every width. Rendering these in the heading row on a
            wide screen and as a separate block below it on a phone put the same
            element at two different places in the tree, so dragging a browser
            across the breakpoint unmounted them — closing an open "Add a …"
            sheet and throwing away a half-typed form. The row wraps instead. */}
        {actions ? <View style={styles.headActions}>{actions}</View> : null}
      </View>
    ) : null;
  return (
    <KbScroll
      style={styles.canvas}
      contentContainerStyle={[
        styles.content,
        wide ? styles.contentWide : null,
        ownsTopInset ? { paddingTop: insets.top + spacing(8) } : null,
        { maxWidth: max },
      ]}
    >
      {/* Chrome is ivory with a dark title, never a raspberry app bar: a
          brand-coloured bar on every screen puts raspberry far past its share. */}
      {heading}
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
  block,
  hug,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  /** A row-level action sitting beside a name, not a full-width page action. */
  compact?: boolean;
  /**
   * Keep the phone's full-width shape at every width.
   *
   * The escape hatch for a button that SHOULD span its container whatever the
   * width — a sheet's own dismiss, and the form buttons inside one, where the
   * container is already a narrow panel. Everywhere else a standalone button
   * stretched to 1400px reads as an unfinished phone layout.
   */
  block?: boolean;
  /** Size to the label at EVERY width, not only on a wide screen. */
  hug?: boolean;
  testID?: string;
}) {
  const isDisabled = disabled || busy;
  const roomy = useRoomy();
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
        // A button laid out as a column child stretches to the column on a
        // phone, which is the right primary-action shape there and a bar across
        // the window on anything larger. Inside a Row it is already
        // content-width, so this only changes the stretched case.
        (hug || roomy) && !compact && !block ? styles.btnWide : null,
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
 * One entry in a list — a person, a cohort, anything with a name and a couple of
 * controls. Title (and status) on the first line, detail under it, actions on
 * the right of the same line, wrapping to their own line when the title needs
 * the width.
 *
 * `onPress` makes the identity block open the thing. The actions stay outside
 * that press target so tapping Archive cannot be mistaken for opening.
 */
export function ListRow({
  name,
  status,
  detail,
  actions,
  actionsPinned = false,
  onPress,
  openLabel,
  testID,
}: {
  name: string;
  status?: ReactNode;
  detail?: string;
  actions?: ReactNode;
  /**
   * Keep the actions on the name's line, pinned right and centred, letting a
   * long name WRAP instead of pushing them onto their own row. For a row whose
   * only action is a single icon, wrapping reads as a layout fault rather than
   * as making room.
   */
  actionsPinned?: boolean;
  onPress?: () => void;
  /** Accessibility name for the press target; visually the row speaks for itself. */
  openLabel?: string;
  testID?: string;
}) {
  const ident = (
    <>
      <View style={styles.rowTitleLine}>
        <Text style={styles.rowTitle}>{name}</Text>
        {status ?? null}
      </View>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
    </>
  );
  return (
    <View style={styles.rowCard}>
      <View style={[styles.rowHead2, actionsPinned ? styles.rowHeadPinned : null]}>
        {/* Title, status and detail are ONE block, so when the actions wrap to
            their own line they go below the whole identity rather than landing
            between the title and its detail. */}
        {onPress ? (
          <Pressable
            testID={testID}
            accessibilityRole="button"
            accessibilityLabel={openLabel ?? `Open ${name}`}
            onPress={onPress}
            style={[styles.rowIdent, actionsPinned ? styles.rowIdentPinned : null]}
          >
            {ident}
          </Pressable>
        ) : (
          <View style={[styles.rowIdent, actionsPinned ? styles.rowIdentPinned : null]}>
            {ident}
          </View>
        )}
        {actions ? (
          <View style={[styles.rowActions, actionsPinned ? styles.rowActionsPinned : null]}>
            {actions}
          </View>
        ) : null}
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
  multiline,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'words';
  keyboardType?: 'email-address' | 'default';
  /**
   * A paragraph, not a value. The field grows and wraps instead of scrolling a
   * single line sideways — a session's notes run to several sentences and were
   * being edited through a one-line box that truncated mid-word.
   */
  multiline?: boolean;
  testID?: string;
}) {
  const roomy = useRoomy();
  return (
    <View style={[styles.field, roomy ? styles.fieldWide : null]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={testID}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.text.muted}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 4 : undefined}
        textAlignVertical={multiline ? 'top' : undefined}
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

/** One place decides what a status colour means; chip and light both read it. */
function statusColour(status: string): string {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return tone === 'good'
    ? t.feedback.success
    : tone === 'bad'
      ? t.feedback.danger
      : tone === 'attention'
        ? t.feedback.warning
        : t.text.muted;
}

/**
 * A status word, in English.
 *
 * The chip prints a FIELD VALUE, and one of them is camelCase — so a recording
 * card read "needsAttention" beside a summary line that said the same thing in
 * words. Only the values that are not already a word need an entry.
 */
const STATUS_WORD: Record<string, string> = {
  needsAttention: 'needs attention',
};

export function StatusChip({ status }: { status: string }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: statusColour(status) }]} />
      <Text style={styles.chipText}>{STATUS_WORD[status] ?? status}</Text>
    </View>
  );
}

/**
 * The status of the thing a whole screen is about: a lamp with its word beneath
 * it, sitting to the LEFT of the heading with the title centred against it.
 *
 * Distinct from `StatusChip`, which is an inline tag in a list row. Set beside a
 * page heading a chip reads as an afterthought stuck to the end of the name; a
 * lamp reads as the state of the thing, is findable in the same spot on every
 * screen, and costs no vertical space of its own.
 */
function StatusLight({ status }: { status: string }) {
  return (
    <View style={styles.light} accessibilityLabel={`Status: ${status}`}>
      <View style={[styles.lightDot, { backgroundColor: statusColour(status) }]} />
      <Text style={styles.lightText} numberOfLines={1}>
        {status}
      </Text>
    </View>
  );
}

/**
 * A collection that flows into as many columns as fit.
 *
 * The single most visible difference between a designed desktop layout and a
 * stretched phone one: a list of cards down the middle of a 1500px window is
 * mostly empty space, and the same cards at 320px must be one per row. `min` is
 * the narrowest a cell may be before the row reflows — the cap on the SAME axis
 * stops a lone last card in a row from stretching to the full width and looking
 * like a different component.
 */
export function Grid({ min = 300, children }: { min?: number; children: ReactNode }) {
  const [width, setWidth] = useState(0);
  const cells = Children.toArray(children);

  /*
   * MEASURED, and measured against THE SPACE THIS GRID HAS — not against the
   * app's navigation breakpoint.
   *
   * Two things follow, and both were bugs. Gating on `useWide()` meant a 720px
   * window got one column however much room a cell needed, because the rail
   * appears at 900 — a number about navigation that has nothing to say about
   * whether two cards fit. And returning a bare fragment in that case put the
   * children at a different tree position, so dragging a window across 900px
   * unmounted and remounted every cell — which for cells holding live listeners
   * flashes an empty state across the whole list. One shape, always.
   *
   * `flexBasis` + `flexGrow` would share the row evenly, which is right until
   * the last row is short: a single leftover card grows to the full width and
   * reads as a different, more important component than the ones above it. So
   * the column count is computed and every cell gets the same fixed width, and
   * the last row lines up with the rest and simply ends.
   */
  const gap = spacing(3);
  const cols = width > 0 ? Math.max(1, Math.floor((width + gap) / (min + gap))) : 1;
  const cell = width > 0 && cols > 1 ? (width - gap * (cols - 1)) / cols : undefined;

  return (
    <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {cells.map((child, i) => (
        /*
         * KEYED BY THE CHILD'S OWN KEY, never by index.
         *
         * `Children.toArray` already carries each child's key, and an index key
         * over it throws that away: insert or remove one row and every cell
         * after it is a different component to React, so all of them remount.
         * Cells here hold live Firestore listeners (a student's class cards do),
         * and `liveQuery` resets to `empty` on resubscribe — so one enrolment
         * change flashed "No attendance taken yet" across the whole list.
         */
        <View
          key={(isValidElement(child) && child.key) || i}
          // One column: a full-width BASIS, so the cell takes the line and the
          // next one wraps beneath it. A percentage `width` on a flex item does
          // not reliably resolve against a wrapping row — the cards came out
          // sized to their own text, each a different width.
          style={[styles.gridCell, cell ? { width: cell } : styles.gridCellFull]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

/**
 * "Add a …" — a header action that opens the form in a sheet.
 *
 * The shape this replaced was a form pinned above the list on every one of
 * these screens. It is wrong at both widths and for the same reason: creating a
 * cohort, a course or a student is a few-times-a-term task, and the list is
 * what every other visit came for. On a phone the form pushed the list below
 * the fold; on a laptop it put a banner of empty fields across the top of a
 * 1400px window and left the content stranded under it.
 *
 * As a modal task it also gets two things for free. The form is the same at
 * every width, so there is no second layout to keep honest — and on a build
 * where the affordance must not exist at all (see `accountCreation.ts`) there
 * is exactly one thing to leave out.
 */
export function AddAction({
  label,
  title,
  testID,
  children,
}: {
  /** The button's words — "Add a student", not "Add" or "+". */
  label: string;
  /** The sheet's heading. Usually the same words. */
  title: string;
  testID?: string;
  /** The form. Close it from inside with `useAddAction`. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AddActionContext.Provider value={() => setOpen(false)}>
      {/* CONTENT-WIDTH AT EVERY WIDTH, which is the one place `hug` is used.
          A full-width raspberry bar above the list is the first thing on a phone
          screen, and it spends the accent well past its share on a page whose
          job is the list underneath. Not `compact` either: that shape belongs
          inside a list row and lands under the 44pt touch minimum. */}
      <Button testID={testID} label={label} hug onPress={() => setOpen(true)} />
      <Sheet visible={open} title={title} onClose={() => setOpen(false)} closeLabel="Cancel">
        {children}
      </Sheet>
    </AddActionContext.Provider>
  );
}

const AddActionContext = createContext<() => void>(() => {});

/** Close the sheet from inside the form, once the thing is created. */
export function useAddAction(): () => void {
  return useContext(AddActionContext);
}

/**
 * A two-or-three way switch between views of the same subject.
 *
 * Not navigation: every segment is the same screen showing a different slice,
 * so it must not push, must not appear in history, and must not get a Back. The
 * People tab is the case it exists for — students and staff are one destination
 * with two lists, and giving each its own tab would spend a permanent slot on a
 * screen an admin opens a few times a term.
 */
export function Segmented<T extends string>({
  value,
  options,
  testIdPrefix = 'segment',
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  /** Each segment gets `${testIdPrefix}-${value}`. */
  testIdPrefix?: string;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={`${testIdPrefix}-${o.value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [
              styles.segment,
              on ? styles.segmentOn : null,
              pressed ? styles.segmentPressed : null,
            ]}
          >
            <Text style={[styles.segmentText, on ? styles.segmentTextOn : null]}>{o.label}</Text>
          </Pressable>
        );
      })}
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
  const roomy = useRoomy();
  return (
    <View style={styles.row}>
      {Children.map(children, (child) =>
        child ? (
          /*
           * THE CELLS SHARE THE WIDTH ON A PHONE AND NOT ON A LAPTOP.
           *
           * Growing each cell is what makes two actions on a 320px screen come
           * out as two equal halves instead of one wide button and one narrow
           * one. At 1400px the same rule gives each cell 537px and leaves its
           * button sitting at its natural width in the middle of it — so a pair
           * of related actions ends up 400px apart with nothing between them,
           * reading as two unrelated controls. It is the single most visible
           * "stretched phone layout" tell in the app, and it was in the shared
           * primitive rather than in any screen, which is why it appeared on
           * five screens at once.
           */
          <View style={[styles.rowItem, roomy ? styles.rowItemWide : null]}>{child}</View>
        ) : null,
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

/**
 * A section that starts closed — for rows that must remain reachable without
 * being in the way: archived cohorts, disabled students.
 *
 * Closed content is UNMOUNTED, not hidden. Height-zero content still matches a
 * query and then swallows the click that was meant for whatever is drawn over
 * it, and the e2e drives these screens by testID — an unmounted section fails
 * honestly (the locator never resolves) instead of clicking something invisible.
 *
 * `aria-expanded`, not `accessibilityState`: react-native-web has no mapping for
 * accessibilityState, so it reaches the DOM as nothing at all and the control
 * announces no state. RN supports the aria props natively (see the manager
 * checkbox in CourseDetailScreen for the same fix).
 */
export function Collapsible({
  title,
  count,
  testID,
  children,
}: {
  title: string;
  count?: number;
  testID?: string;
  children: ReactNode;
}) {
  // Always starts closed. A `defaultOpen` prop went in with no caller, which is
  // the speculative infrastructure this repo keeps out on purpose.
  const [open, setOpen] = useState(false);
  const label = count === undefined ? title : `${title} (${count})`;
  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={`${open ? 'Hide' : 'Show'} ${label}`}
        onPress={() => setOpen((v) => !v)}
        style={styles.collapseHead}
      >
        {/* Text-presentation glyphs, not an icon font or emoji — same rule as
            IconButton. These two share a baseline, which the arrowhead pair
            (⌄ ›) did not: the open state sat visibly below the label. */}
        <Text style={styles.collapseCaret}>{open ? '▾' : '▸'}</Text>
        <Text style={styles.collapseTitle}>{label}</Text>
      </Pressable>
      {open ? children : null}
    </>
  );
}

/**
 * A labelled on/off row — the settings control.
 *
 * NOT React Native's `Switch`. On react-native-web that renders a browser
 * control whose track and thumb colours are only partly reachable from JS, so it
 * arrives on screen in system blue — and this app has a fixed palette and an
 * ESLint rule against stray colours precisely so that cannot happen. Two Views
 * and a transform give the same affordance, identical on both surfaces, in
 * brand colours.
 *
 * The WHOLE ROW is the target, not just the switch: a 52pt pill is a poor tap
 * target on a phone, and everyone expects the label to work.
 *
 * `aria-checked`, not `accessibilityState`: react-native-web has no mapping for
 * accessibilityState, so it reaches the DOM as nothing at all and the control
 * announces no state. RN supports the aria props natively (same fix as the
 * manager checkbox in CourseDetailScreen).
 */
export function SwitchRow({
  label,
  description,
  on,
  onChange,
  testID,
}: {
  label: string;
  description?: string;
  on: boolean;
  onChange: (next: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      aria-checked={on}
      accessibilityLabel={label}
      onPress={() => onChange(!on)}
      style={({ pressed }) => [styles.switchRow, pressed ? styles.switchRowPressed : null]}
    >
      <View style={styles.switchText}>
        <Text style={styles.switchLabel}>{label}</Text>
        {description ? <Text style={styles.switchDescription}>{description}</Text> : null}
      </View>
      {/* Decorative: the Pressable above owns the role and the state, so the
          track must not announce itself a second time. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.track, on ? styles.trackOn : null]}
      >
        <View style={[styles.knob, on ? styles.knobOn : null]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: t.bg.canvas },
  content: {
    padding: spacing(5),
    paddingBottom: spacing(12),
    maxWidth: CONTENT_MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
  },
  contentWide: { paddingHorizontal: spacing(8), paddingTop: spacing(7) },
  headActions: { flexDirection: 'row', gap: spacing(2), alignItems: 'flex-start' },
  h1: { fontSize: 26, fontWeight: '700', color: t.text.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 2,
    padding: 3,
    borderRadius: 9,
    backgroundColor: t.bg.inset,
    marginBottom: spacing(4),
  },
  segment: {
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(4),
    borderRadius: 7,
    minHeight: 36,
    justifyContent: 'center',
  },
  segmentOn: { backgroundColor: t.bg.surface },
  segmentPressed: { opacity: 0.7 },
  segmentText: { fontSize: 14, fontWeight: '600', color: t.text.secondary },
  segmentTextOn: { color: t.text.primary },
  /*
   * `minWidth: 0` IS LOAD-BEARING. A flex item's automatic minimum size is its
   * min-content width, and that beats any width set on it — so at 320px, where
   * one cell is the whole row, a cell grew to whatever its longest unbreakable
   * row needed and pushed its own actions past the right edge. As plain block
   * children, which is what the narrow case used to be, the question never came
   * up; as flex items it has to be answered.
   */
  gridCell: { flexShrink: 0, minWidth: 0 },
  // `flexBasis: '100%'`, not 0. With `flexWrap` a zero basis never fills a line,
  // so every cell landed on the SAME line — thirteen 21px slivers. A full-width
  // basis is what makes one item per line and fills it.
  gridCellFull: { flexGrow: 1, flexBasis: '100%' },
  lede: { fontSize: 15, color: t.text.secondary, marginTop: spacing(1) },
  // Raspberry is the primary action's colour, and this IS the header's action.
  // #83114F on the ivory canvas is far past 4.5:1, so it carries at 15pt.
  ledeLink: { color: t.text.accent, textDecorationLine: 'underline' },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
    marginTop: spacing(4),
    marginBottom: spacing(2),
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(3),
    gap: spacing(4),
  },
  switchRowPressed: { opacity: 0.7 },
  switchText: { flex: 1 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  switchDescription: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  track: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.bg.inset,
    borderWidth: 1,
    borderColor: t.border.strong,
    padding: 3,
    justifyContent: 'center',
  },
  // Raspberry on, recessed ivory off — the same pair the app uses everywhere for
  // selected vs not, so "on" needs no legend.
  trackOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  knob: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.bg.raised,
    // translateX rather than alignSelf: alignSelf jumps, and on web this
    // transitions for free.
    transform: [{ translateX: 0 }],
  },
  knobOn: { transform: [{ translateX: 20 }] },

  // Reads as a SectionTitle that happens to be tappable, so a closed section
  // still looks like part of the page rather than a stray button.
  collapseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    minHeight: 44,
    marginTop: spacing(4),
    marginBottom: spacing(2),
  },
  collapseCaret: { fontSize: 13, fontWeight: '700', color: t.text.secondary, width: 12 },
  collapseTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
  },
  card: {
    // Fills the grid cell it is given, so a row of these ends level instead
    // of ragged with its actions at three different heights.
    flexGrow: 1,
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
  btnWide: { alignSelf: 'flex-start', minWidth: 120 },
  btnPrimary: { backgroundColor: t.accent.base },
  btnSecondary: { backgroundColor: t.bg.sage },
  btnDanger: { backgroundColor: t.feedback.danger },
  btnPressed: { opacity: 0.85 },
  // Neutral rather than a faded brand fill: a washed-out raspberry block still
  // pulls the eye harder than the live control next to it.
  btnDisabled: { backgroundColor: t.bg.inset },
  btnDisabledText: { color: t.text.muted },
  // textAlign, not just the container's alignItems: that centres the text BOX,
  // and a label short enough to fit on one line looks centred either way. The
  // moment it wraps ("Submit / attendance") the second line hangs left inside a
  // box that is itself centred, which reads as a mistake.
  btnText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  btnPrimaryText: { color: t.accent.onAccent },
  btnSecondaryText: { color: t.text.primary },
  field: { marginTop: spacing(3) },
  // A single-line field stretched to 1100px is unreadable and looks unfinished;
  // the value in it is a name or an email, never a paragraph.
  fieldWide: { maxWidth: 440 },
  inputMultiline: { minHeight: 96, paddingTop: spacing(3) },
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
    justifyContent: 'flex-start',
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
  rowItemWide: { flexGrow: 0, flexBasis: 'auto' },

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
  // The heading: lamp on the left, title centred against it.
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(3),
    flexWrap: 'wrap',
    marginBottom: spacing(4),
  },
  headText: { flexShrink: 1, flexGrow: 1 },
  light: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    alignSelf: 'flex-start',
    marginTop: spacing(1),
  },
  // Bigger than the chip's 8pt dot — at a page heading this is the thing you
  // look for first.
  lightDot: { width: 12, height: 12, borderRadius: 6 },
  // secondary, not muted: the status word is content, and true taupe is ~2.7:1.
  lightText: { fontSize: 11, color: t.text.secondary, marginTop: spacing(1), textAlign: 'center' },
  rowCard: {
    // Fills its grid cell — see the note on `card`.
    flexGrow: 1,
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
  rowHead2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing(2),
    minHeight: 52,
  },
  rowIdent: { flexGrow: 1, flexShrink: 1, flexBasis: 180, gap: 2 },
  // The pinned variant: the name takes the room it needs and wraps within it,
  // while the actions hold their size at the right-hand end, vertically centred.
  rowHeadPinned: { flexWrap: 'nowrap' },
  rowIdentPinned: { flexBasis: 'auto', minWidth: 0 },
  // flexGrow MUST be cancelled, not just shrink: the base row lets the actions
  // grow and centres them inside, which parks a lone icon in mid-air instead of
  // at the edge — and only shows up next to a row whose name is short.
  rowActionsPinned: {
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'flex-end',
    alignSelf: 'center',
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing(2),
  },
  rowTitle: { fontSize: 16, fontWeight: '600', color: t.text.primary, flexShrink: 1 },
  // Centred when they wrap to their own line, right-hand end when they share the
  // name's line — one rule that reads correctly in both.
  rowActions: {
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
  rowDetail: { fontSize: 13, color: t.text.secondary },
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
