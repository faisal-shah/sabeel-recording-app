import { Pressable, StyleSheet, Text, View } from 'react-native';
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
      <Skip label="15" direction="back" disabled={disabled} onPress={onBack} testID="player-back" />

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
        {playing ? (
          <View style={styles.pauseGlyph}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        ) : (
          // Nudged right: a triangle's visual centre sits left of its bounding
          // box, so centring the box leaves it looking off-centre.
          <View style={[styles.playGlyph, disabled ? styles.playGlyphDisabled : null]} />
        )}
      </Pressable>

      <Skip label="30" direction="forward" disabled={disabled} onPress={onForward} testID="player-forward" />
    </View>
  );
}

function Skip({
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
