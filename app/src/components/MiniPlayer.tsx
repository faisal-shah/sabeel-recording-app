import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SKIP_BACK_MS,
  SKIP_FORWARD_MS,
  closePlayback,
  formatClock,
  playback,
  usePlayback,
} from '../playback';
import { PlayPauseGlyph, Skip } from './Transport';
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
 *    artwork-less: the title, play/pause, and a dismiss — because that is
 *    all the vertical space a phone can give up. Tapping the row reopens the
 *    full player.
 *  - WIDE it spans the content area beneath the rail with the transport laid
 *    out inline: back 15 · play/pause · forward 30, elapsed and remaining, and
 *    a full-width progress line. There is room for the controls, so putting
 *    them behind a tap would be hiding them for no reason.
 *
 * A progress line runs along the TOP edge in both, so the bar reports position
 * without spending a row on it.
 */
export function MiniPlayer({
  onOpen,
}: {
  /** Carries the deadline as well as the id: the player screen gates the audio
   *  on it, and re-opening without it would draw a live transport for a student
   *  whose access closed while they were listening. */
  onOpen: (recordingId: string, dueDate: string | null) => void;
}) {
  const state = usePlayback();
  const wide = useWide();
  const now = state.now;
  if (!now) return null;

  const pct = now.durationMs > 0 ? Math.min(1, state.positionMs / now.durationMs) : 0;
  const remaining = Math.max(0, now.durationMs - state.positionMs);
  const times = `${formatClock(state.positionMs)} / −${formatClock(remaining)}`;

  return (
    <View testID="mini-player" style={[styles.bar, wide ? styles.barWide : null]}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      <Pressable
        testID="mini-player-open"
        accessibilityRole="button"
        accessibilityLabel={`Open ${now.title}`}
        onPress={() => onOpen(now.recordingId, now.dueDate)}
        style={styles.text}
      >
        <Text style={styles.title} numberOfLines={1}>
          {now.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {now.courseName}
          {wide ? ` · ${times}` : ''}
        </Text>
      </Pressable>

      {/* THE SAME CONTROLS THE FULL PLAYER USES, not lookalikes. Bare "15" and
          "30" read as inert tags, and a typed "▶" renders as a colour emoji on
          some Android builds — which is exactly why `Transport` draws its
          glyphs. Sharing them is how the two views cannot drift. */}
      {wide ? (
        <Skip
          label={String(SKIP_BACK_MS / 1000)}
          direction="back"
          disabled={!state.ready}
          onPress={playback.skipBack}
          testID="mini-player-back"
        />
      ) : null}

      <Pressable
        testID="mini-player-toggle"
        accessibilityRole="button"
        accessibilityLabel={state.playing ? 'Pause' : 'Play'}
        disabled={!state.ready}
        onPress={playback.toggle}
        style={[styles.play, !state.ready ? styles.playDisabled : null]}
      >
        <PlayPauseGlyph playing={state.playing} disabled={!state.ready} />
      </Pressable>

      {wide ? (
        <Skip
          label={String(SKIP_FORWARD_MS / 1000)}
          direction="forward"
          disabled={!state.ready}
          onPress={playback.skipForward}
          testID="mini-player-forward"
        />
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent.base,
  },
  playDisabled: { backgroundColor: t.bg.inset },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeGlyph: { fontSize: 20, color: t.text.muted },
});
