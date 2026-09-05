import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SKIP_BACK_MS,
  SKIP_FORWARD_MS,
  closePlayback,
  formatClock,
  playback,
  usePlayback,
} from '../playback';
import { useRecordingState } from '../recordings';
import { PlayPauseGlyph, Skip } from './Transport';
import { LAYOUT_WIDTHS, getTheme, spacing } from '../theme';
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
 *    artwork-less: the title, play/pause, and a dismiss. NO SKIP CONTROLS, and
 *    that is deliberate rather than a width that ran out: the whole strip is
 *    one tap from the full transport, and three more targets on a 320px row
 *    would leave the title too short to identify the lecture, which is the one
 *    thing the strip has to do. Pause is the control you reach for without
 *    looking; skipping is a control you look at.
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

  /*
   * STOP THE AUDIO IF THE RECORDING IS REVOKED WHILE THIS BAR IS SHOWING.
   *
   * The player screen already does this for the case where it is on screen, and
   * this covers the other half: playback outlives that screen now, so a student
   * listening from their class list would otherwise keep hearing a recording
   * that was unpublished — for as long as the signed URL lasts, with nothing on
   * screen saying anything changed.
   *
   * One document listener, and only while something is loaded. The two are
   * complementary rather than redundant: this bar is not rendered on the player
   * screen, and the player screen is not mounted anywhere else.
   */
  const loaded = useRecordingState(now?.recordingId ?? null);
  const revoked = !!now && loaded.resolved && !loaded.value;
  useEffect(() => {
    if (revoked) closePlayback();
  }, [revoked]);

  if (!now) return null;

  const pct = now.durationMs > 0 ? Math.min(1, state.positionMs / now.durationMs) : 0;
  const remaining = Math.max(0, now.durationMs - state.positionMs);
  const times = `${formatClock(state.positionMs)} / −${formatClock(remaining)}`;

  return (
    <View testID="mini-player" style={[styles.bar, wide ? styles.barWide : null]}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct * 100}%` }]} />
      </View>
      {/* CAPPED AND CENTRED, like the content above it. Left to span a 1400px
          window the title and the transport ended up an 800px canyon apart, and
          the controls sat outside the column every other control on the page
          lines up with. */}
      <View style={styles.inner}>
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
        onPress={closePlayback}
        style={styles.close}
      >
        <Text style={styles.closeGlyph}>×</Text>
      </Pressable>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2),
    minHeight: 56,
    backgroundColor: t.bg.raised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border.strong,
  },
  barWide: { paddingHorizontal: spacing(6), minHeight: 64 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    width: '100%',
    maxWidth: LAYOUT_WIDTHS.list,
    alignSelf: 'center',
  },
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
