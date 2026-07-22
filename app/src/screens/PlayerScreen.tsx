import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { canPlayFromClass, listenedFraction } from '@sabeel/shared';
import { Notice } from '../components/ui';
import { Scrubber } from '../components/Scrubber';
import { Transport } from '../components/Transport';
import { usePlayback } from '../playback';
import { useCompletion, setCompleted } from '../completion';
import { useListenerError } from '../liveQuery';
import type { ClassRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();
const RATES = [1, 1.25, 1.5, 2];

/**
 * Listening to one recording.
 *
 * Laid out like a video page rather than a dashboard: the controls own the top
 * of the screen and everything else — notes, listening detail — sits BELOW the
 * fold, reached by scrolling. Notes are shared with everyone who can access the
 * recording and can run long, so putting them inline would push the transport
 * off a phone screen.
 */
export function PlayerScreen({
  recording,
  cls,
  studentUid,
}: {
  recording: RecordingRow;
  cls: ClassRow;
  studentUid: string | null;
}) {
  const listenerError = useListenerError();
  const allowed = canPlayFromClass(cls);
  const { state, play, pause, seek, setRate } = usePlayback(
    recording.id,
    studentUid,
    recording.classId,
  );

  if (!allowed) {
    return (
      <ScrollView style={styles.canvas} contentContainerStyle={styles.content}>
        <Hero recording={recording} className={cls.name} />
        <Notice tone="info">
          This class has been archived and listening has been turned off. Your listening
          history is kept — ask your teacher if you need access again.
        </Notice>
      </ScrollView>
    );
  }

  const durationMs = (recording.durationSec ?? 0) * 1000;
  const remainingMs = Math.max(0, durationMs - state.positionMs);
  const listened = listenedFraction(state.listenedMs, recording.durationSec);

  return (
    <ScrollView style={styles.canvas} contentContainerStyle={styles.content}>
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      <Hero recording={recording} className={cls.name} />

      <Scrubber
        testID="player-scrubber"
        positionMs={state.positionMs}
        durationMs={durationMs}
        disabled={!state.ready}
        onSeek={seek}
      />
      <View style={styles.times}>
        <Text testID="player-elapsed" style={styles.time}>{fmt(state.positionMs)}</Text>
        {/* Remaining, not total: mid-lecture, "how much is left" is the question
            anyone actually has. */}
        <Text style={styles.time}>−{fmt(remainingMs)}</Text>
      </View>

      <Transport
        playing={state.playing}
        disabled={!state.ready}
        onPlayPause={state.playing ? pause : play}
        onBack={() => seek(Math.max(0, state.positionMs - 15_000))}
        onForward={() => seek(Math.min(durationMs, state.positionMs + 30_000))}
      />

      <View style={styles.speedRow}>
        {RATES.map((r) => {
          const on = state.rate === r;
          return (
            <Pressable
              key={r}
              testID={`player-rate-${r}`}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Playback speed ${r} times`}
              disabled={!state.ready}
              onPress={() => setRate(r)}
              style={[styles.speedChip, on ? styles.speedChipOn : null]}
            >
              <Text style={[styles.speedText, on ? styles.speedTextOn : null]}>{r}×</Text>
            </Pressable>
          );
        })}
      </View>

      {!state.ready && !state.error ? <Text style={styles.preparing}>Preparing…</Text> : null}

      {/* ---- below the fold ---- */}
      <View style={styles.divider} />

      <Text style={styles.sectionHeading}>Your listening</Text>
      <View style={styles.listenedTrack}>
        <View style={[styles.listenedFill, { width: `${Math.round(listened * 100)}%` }]} />
      </View>
      <Text style={styles.body}>
        {Math.round(listened * 100)}% of this recording listened. Your place is saved
        automatically, so you can carry on from another device.
      </Text>

      {studentUid ? (
        <CompletionControl
          studentUid={studentUid}
          recordingId={recording.id}
          classId={recording.classId}
          everPlayed={state.listenedMs > 0 || state.positionMs > 0}
        />
      ) : null}

      {recording.notes ? (
        <>
          <Text style={styles.sectionHeading}>About this recording</Text>
          <Text style={styles.body}>{recording.notes}</Text>
        </>
      ) : null}

      {recording.dueDate ? (
        <Text style={styles.due}>Due {recording.dueDate}</Text>
      ) : (
        <Text style={styles.due}>No due date</Text>
      )}
    </ScrollView>
  );
}

/**
 * Stands where Spotify puts album art. A lecture has none, so the panel carries
 * the type instead — same visual anchor, nothing invented.
 */
function Hero({ recording, className }: { recording: RecordingRow; className: string }) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroClass}>{className.toUpperCase()}</Text>
      <Text style={styles.heroTitle}>{recording.title}</Text>
      {recording.recordedAt ? (
        <Text style={styles.heroDate}>
          Recorded {new Date(recording.recordedAt).toLocaleDateString()}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Mark complete / completed, with the never-played gate.
 *
 * Completion is student-attested (brief): there is no listened-% threshold. The
 * ONE precondition is that the student has played at all — enforced here, in the
 * app, deliberately not in the rules, so an offline completion is never
 * false-rejected on sync. Writes go straight to Firestore and work offline; a
 * queued write shows as "Pending sync" until it lands.
 */
function CompletionControl({
  studentUid,
  recordingId,
  classId,
  everPlayed,
}: {
  studentUid: string;
  recordingId: string;
  classId: string;
  everPlayed: boolean;
}) {
  const { completed, pending } = useCompletion(studentUid, recordingId);

  if (completed) {
    return (
      <View style={styles.completeRow}>
        <Text style={styles.completedText}>✓ Completed</Text>
        {pending ? <Text style={styles.pendingText}>Pending sync</Text> : null}
        <Pressable
          testID="mark-incomplete"
          accessibilityRole="button"
          accessibilityLabel="Mark not complete"
          onPress={() => void setCompleted(studentUid, recordingId, classId, false)}
        >
          <Text style={styles.unmark}>Unmark</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <Pressable
        testID="mark-complete"
        accessibilityRole="button"
        accessibilityLabel="Mark complete"
        accessibilityState={{ disabled: !everPlayed }}
        disabled={!everPlayed}
        onPress={() => void setCompleted(studentUid, recordingId, classId, true)}
        style={({ pressed }) => [
          styles.completeButton,
          pressed ? styles.completePressed : null,
          !everPlayed ? styles.completeDisabled : null,
        ]}
      >
        <Text style={[styles.completeLabel, !everPlayed ? styles.completeLabelDisabled : null]}>
          Mark complete
        </Text>
      </Pressable>
      {!everPlayed ? (
        <Text style={styles.gateHint}>Play the recording before marking it complete.</Text>
      ) : null}
      {pending ? <Text style={styles.pendingText}>Pending sync</Text> : null}
    </View>
  );
}

function fmt(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  canvas: { flex: 1, backgroundColor: t.bg.canvas },
  content: {
    padding: spacing(5),
    paddingBottom: spacing(12),
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  hero: {
    backgroundColor: t.bg.sage,
    borderRadius: 16,
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(5),
    marginBottom: spacing(5),
    minHeight: 200,
    justifyContent: 'center',
  },
  heroClass: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: t.text.secondary,
    marginBottom: spacing(2),
  },
  heroTitle: { fontSize: 28, fontWeight: '700', color: t.text.primary },
  heroDate: { fontSize: 14, color: t.text.secondary, marginTop: spacing(2) },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -spacing(1) },
  time: { fontSize: 13, color: t.text.secondary, fontVariant: ['tabular-nums'] },
  speedRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing(2),
    marginTop: spacing(5),
  },
  speedChip: {
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(3),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border.strong,
    minWidth: 56,
    alignItems: 'center',
  },
  speedChipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  speedText: { fontSize: 14, fontWeight: '600', color: t.text.secondary },
  speedTextOn: { color: t.accent.onAccent },
  preparing: { fontSize: 13, color: t.text.secondary, textAlign: 'center', marginTop: spacing(3) },
  divider: { height: 1, backgroundColor: t.accent.gold, marginVertical: spacing(7) },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
    marginBottom: spacing(2),
    marginTop: spacing(4),
  },
  listenedTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: t.bg.inset,
    overflow: 'hidden',
    marginBottom: spacing(2),
  },
  listenedFill: { height: 6, backgroundColor: t.feedback.success },
  body: { fontSize: 15, color: t.text.secondary, lineHeight: 22 },
  due: { fontSize: 14, color: t.text.secondary, marginTop: spacing(5) },

  completeButton: {
    marginTop: spacing(4),
    backgroundColor: t.accent.base,
    borderRadius: 12,
    paddingVertical: spacing(3),
    alignItems: 'center',
  },
  completePressed: { opacity: 0.85 },
  completeDisabled: { backgroundColor: t.bg.inset },
  completeLabel: { fontSize: 16, fontWeight: '700', color: t.accent.onAccent },
  completeLabelDisabled: { color: t.text.muted },
  gateHint: { fontSize: 13, color: t.text.secondary, marginTop: spacing(2), textAlign: 'center' },
  completeRow: {
    marginTop: spacing(4),
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
  },
  completedText: { fontSize: 16, fontWeight: '700', color: t.feedback.success, flex: 1 },
  unmark: { fontSize: 14, color: t.text.secondary, fontWeight: '600' },
  pendingText: { fontSize: 13, color: t.feedback.warning, fontWeight: '600' },
});
