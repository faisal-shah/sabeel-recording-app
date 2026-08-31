import { Pressable, StyleSheet, Text, View } from 'react-native';
import { closePlayback, playback, usePlayback } from '../playback';
import { getTheme, spacing } from '../theme';
import { useWide } from '../useWidth';

const t = getTheme();

/**
 * The docked now-playing bar.
 *
 * This is the piece that makes app-wide playback VISIBLE, and it only became
 * possible once the session moved out of `PlayerScreen` (see `playback.ts`).
 * A two-hour lecture is not listened to in one sitting on one screen: people
 * check their attendance record, open another class, put the phone down. With
 * playback held by the app and this bar always showing what is loaded, leaving
 * the player screen stops being a decision.
 *
 * Two shapes, and the difference is not decoration:
 *
 *  - NARROW it sits directly on top of the tab bar as a single compact row —
 *    artwork-less, title plus one control — because that is all the vertical
 *    space a phone can give up. Tapping the row reopens the full player.
 *  - WIDE it spans the content area beneath the rail with the transport laid
 *    out inline: back 15 · play/pause · forward 30, elapsed and remaining, and
 *    a full-width progress line. There is room for the controls, so putting
 *    them behind a tap would be hiding them for no reason.
 *
 * A progress line runs along the TOP edge in both, so the bar reports position
 * without spending a row on it.
 */
export function MiniPlayer({ onOpen }: { onOpen: (recordingId: string) => void }) {
  const state = usePlayback();
  const wide = useWide();
  const now = state.now;
  if (!now) return null;

  const pct = now.durationMs > 0 ? Math.min(1, state.positionMs / now.durationMs) : 0;
  const remaining = Math.max(0, now.durationMs - state.positionMs);

  return (
    <View testID="mini-player" style={[styles.bar, wide ? styles.barWide : null]}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      <Pressable
        testID="mini-player-open"
        accessibilityRole="button"
        accessibilityLabel={`Open ${now.title}`}
        onPress={() => onOpen(now.recordingId)}
        style={styles.text}
      >
        <Text style={styles.title} numberOfLines={1}>
          {now.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {now.courseName}
          {wide ? ` · ${fmt(state.positionMs)} / −${fmt(remaining)}` : ''}
        </Text>
      </Pressable>

      {wide ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back 15 seconds"
          disabled={!state.ready}
          onPress={() => playback.seek(Math.max(0, state.positionMs - 15_000))}
          style={styles.skip}
        >
          <Text style={styles.skipText}>15</Text>
        </Pressable>
      ) : null}

      <Pressable
        testID="mini-player-toggle"
        accessibilityRole="button"
        accessibilityLabel={state.playing ? 'Pause' : 'Play'}
        disabled={!state.ready}
        onPress={playback.toggle}
        style={[styles.play, !state.ready ? styles.playDisabled : null]}
      >
        {/* Text-presentation glyphs, never emoji: an emoji renders as a colour
            bitmap that ignores `color`, so it would not read as an action. */}
        <Text style={styles.playGlyph}>{state.playing ? '❙❙' : '▶'}</Text>
      </Pressable>

      {wide ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Forward 30 seconds"
          disabled={!state.ready}
          onPress={() => playback.seek(Math.min(now.durationMs, state.positionMs + 30_000))}
          style={styles.skip}
        >
          <Text style={styles.skipText}>30</Text>
        </Pressable>
      ) : null}

      <Pressable
        testID="mini-player-close"
        accessibilityRole="button"
        accessibilityLabel="Stop listening"
        onPress={() => void closePlayback()}
        style={styles.close}
      >
        <Text style={styles.closeGlyph}>×</Text>
      </Pressable>
    </View>
  );
}

function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
    minHeight: 56,
    backgroundColor: t.bg.raised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border.strong,
  },
  barWide: { paddingHorizontal: spacing(6), minHeight: 64 },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: t.border.subtle,
  },
  progressFill: { height: 2, backgroundColor: t.accent.base },
  text: { flex: 1, justifyContent: 'center', minHeight: 40 },
  title: { fontSize: 14, fontWeight: '700', color: t.text.primary },
  sub: { fontSize: 12, color: t.text.secondary, marginTop: 1 },
  play: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent.base,
  },
  playDisabled: { backgroundColor: t.bg.inset },
  playGlyph: { color: t.accent.onAccent, fontSize: 13, fontWeight: '700' },
  skip: {
    minWidth: 44,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.bg.sage,
  },
  skipText: { fontSize: 13, fontWeight: '700', color: t.text.primary },
  close: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeGlyph: { fontSize: 20, color: t.text.muted },
});
