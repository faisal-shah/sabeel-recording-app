import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SKIP_BACK_MS, SKIP_FORWARD_MS } from '../playback';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Play / pause and the two skip controls.
 *
 * The glyphs are DRAWN, not typed. A "▶" character renders as a colour emoji on
 * some Android builds, which ignores the theme colour entirely and lands a blue
 * triangle in the middle of the brand palette — the `expo-firebase-stack` skill
 * calls this out. A bordered triangle and two bars are deterministic everywhere.
 */
/**
 * The play/pause mark, drawn rather than typed — see the note above.
 *
 * `scale` because the docked bar's button is 44px against the player's 72px,
 * and the same glyph in both filled the small one to its edges. The mark is
 * built from borders, so it cannot simply be given a font size; it is scaled.
 */
export function PlayPauseGlyph({
  playing,
  disabled,
  scale = 1,
}: {
  playing: boolean;
  disabled?: boolean;
  scale?: number;
}) {
  const sized = scale === 1 ? null : { transform: [{ scale }] };
  return playing ? (
    <View style={[styles.pauseGlyph, sized]}>
      <View style={styles.pauseBar} />
      <View style={styles.pauseBar} />
    </View>
  ) : (
    <View style={[styles.playGlyph, disabled ? styles.playGlyphDisabled : null, sized]} />
  );
}

export function Transport({
  playing,
  disabled,
  onPlayPause,
  onBack,
  onForward,
}: {
  playing: boolean;
  disabled?: boolean;
  onPlayPause: () => void;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <View style={styles.row}>
      <Skip
        label={String(SKIP_BACK_MS / 1000)}
        direction="back"
        disabled={disabled}
        onPress={onBack}
        testID="player-back"
      />

      <Pressable
        testID="player-play"
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause' : 'Play'}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPlayPause}
        style={({ pressed }) => [
          styles.playButton,
          pressed && !disabled ? styles.pressed : null,
          disabled ? styles.playDisabled : null,
        ]}
      >
        {/* Nudged right inside `playGlyph`: a triangle's visual centre sits
            left of its bounding box, so centring the box looks off-centre. */}
        <PlayPauseGlyph playing={playing} disabled={disabled} />
      </Pressable>

      <Skip
        label={String(SKIP_FORWARD_MS / 1000)}
        direction="forward"
        disabled={disabled}
        onPress={onForward}
        testID="player-forward"
      />
    </View>
  );
}

export function Skip({
  label,
  direction,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  direction: 'back' | 'forward';
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        direction === 'back' ? `Back ${label} seconds` : `Forward ${label} seconds`
      }
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => [
        styles.skip,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.skipDisabled : null,
      ]}
    >
      <Text style={[styles.skipArrow, disabled ? styles.skipTextDisabled : null]}>
        {direction === 'back' ? '‹' : '›'}
      </Text>
      <Text style={[styles.skipNumber, disabled ? styles.skipTextDisabled : null]}>{label}</Text>
    </Pressable>
  );
}

const PLAY = 72;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(7),
    marginTop: spacing(4),
  },
  playButton: {
    width: PLAY,
    height: PLAY,
    borderRadius: PLAY / 2,
    backgroundColor: t.accent.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisabled: { backgroundColor: t.bg.inset },
  pressed: { opacity: 0.85 },
  playGlyph: {
    width: 0,
    height: 0,
    marginLeft: 6,
    borderTopWidth: 13,
    borderBottomWidth: 13,
    borderLeftWidth: 22,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: t.accent.onAccent,
  },
  playGlyphDisabled: { borderLeftColor: t.text.muted },
  pauseGlyph: { flexDirection: 'row', gap: 7 },
  pauseBar: { width: 7, height: 26, borderRadius: 2, backgroundColor: t.accent.onAccent },
  skip: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: t.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipDisabled: { borderColor: t.bg.inset },
  skipArrow: { fontSize: 15, lineHeight: 16, color: t.text.secondary, fontWeight: '700' },
  skipNumber: { fontSize: 14, lineHeight: 16, color: t.text.primary, fontWeight: '700' },
  skipTextDisabled: { color: t.text.muted },
});
