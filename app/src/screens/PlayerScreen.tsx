import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  INSTITUTE_TIMEZONE,
  canPlayFromCourse,
  isOverdue,
  listenedFraction,
  todayInZone,
} from '@sabeel/shared';
import { Notice } from '../components/ui';
import { Scrubber } from '../components/Scrubber';
import { Transport } from '../components/Transport';
import { openPlayback, playback, usePlayback } from '../playback';
import { useCompletion, setCompleted } from '../completion';
import { useListenerError } from '../liveQuery';
import { useCohortName, type CourseRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { useWide } from '../useWidth';
import { getTheme, spacing } from '../theme';

const t = getTheme();
const RATES = [1, 1.25, 1.5, 2];

/** What this screen shows before the app-wide session is about its recording. */
const IDLE_VIEW = {
  ready: false,
  playing: false,
  positionMs: 0,
  listenedMs: 0,
  rate: 1,
  error: null,
  now: null,
} as const;

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
  dueDate,
}: {
  recording: RecordingRow;
  cls: CourseRow;
  studentUid: string | null;
  /** The caller's due date: the session's for staff, the student's own
   *  assignment for students, or null when browsing something not assigned. */
  dueDate: string | null;
}) {
  const listenerError = useListenerError();
  // Two independent reasons the audio may be shut: the course was archived with
  // listening off, or this student's own deadline has passed. Either way the
  // server refuses to mint a URL, so the transport must not be drawn — a play
  // button that does nothing reads as a broken app rather than a closed door.
  const closed =
    studentUid !== null && dueDate !== null && isOverdue(dueDate, todayInZone(INSTITUTE_TIMEZONE));
  const allowed = canPlayFromCourse(cls) && !closed;
  const session = usePlayback();
  // The session is app-wide, so on the first render after arriving it may still
  // describe the PREVIOUS recording. Read it only once it is about this one;
  // otherwise the scrubber shows another lecture's position for a frame.
  const state = session.now?.recordingId === recording.id ? session : IDLE_VIEW;
  const wide = useWide();
  const { play, pause, seek, setRate } = playback;
  // Opening the session is an EFFECT, not a render-time call: this screen is one
  // view onto app-wide playback, and re-entering it for something already
  // playing must re-focus rather than restart. `openPlayback` is idempotent for
  // the loaded recording, so a re-render costs nothing.
  useEffect(() => {
    if (!allowed) return;
    openPlayback(
      {
        recordingId: recording.id,
        title: recording.title,
        courseName: cls.name,
        durationMs: (recording.durationSec ?? 0) * 1000,
        dueDate,
      },
      studentUid,
      recording.courseId,
    );
  }, [allowed, recording.id, recording.title, recording.durationSec, recording.courseId, cls.name, studentUid, dueDate]);
  // While the scrubber is being dragged it reports the previewed position; the
  // time readouts follow the thumb rather than the still-advancing playhead.
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  // Staff can reach this across cohorts, where a course name alone is ambiguous;
  // students can't read cohorts and arrive from their own single context, so the
  // lookup is disabled for them (returns '').
  const cohortName = useCohortName(studentUid === null)(recording.cohortId);

  if (!allowed) {
    return (
      <ScrollView style={styles.canvas} contentContainerStyle={styles.content}>
        <Hero recording={recording} courseName={cls.name} cohortName={cohortName} />
        <Notice tone="info">
          {closed
            ? `This recording closed on ${dueDate}. Your listening record is kept — ask your teacher if you need it reopened.`
            : 'This course has been archived and listening has been turned off. Your listening history is kept — ask your teacher if you need access again.'}
        </Notice>
      </ScrollView>
    );
  }

  const durationMs = (recording.durationSec ?? 0) * 1000;
  const shownPositionMs = scrubMs ?? state.positionMs;
  const remainingMs = Math.max(0, durationMs - shownPositionMs);
  const listened = listenedFraction(state.listenedMs, recording.durationSec);

  return (
    <ScrollView
      style={styles.canvas}
      contentContainerStyle={[styles.content, wide ? styles.contentWide : null]}
    >
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}

      {/*
        TWO COLUMNS ON A WIDE SCREEN.

        A phone has to stack this: the transport owns the first screenful and
        everything else — the listening bar, the completion control, the shared
        notes — sits below the fold. That ordering is right when there is one
        column and wrong when there are two: on a laptop the notes a teacher
        wrote for the session end up two scrolls below a play button, in a window
        with 700px of unused space beside it. Side by side, the whole recording
        is one screen and nothing is hidden behind a scroll.
      */}
      <View style={wide ? styles.columns : undefined}>
      <View style={wide ? styles.columnMain : undefined}>
      <Hero recording={recording} courseName={cls.name} cohortName={cohortName} />

      <Scrubber
        testID="player-scrubber"
        positionMs={shownPositionMs}
        durationMs={durationMs}
        disabled={!state.ready}
        onSeek={seek}
        onScrub={setScrubMs}
      />
      <View style={styles.times}>
        <Text testID="player-elapsed" style={styles.time}>{fmt(shownPositionMs)}</Text>
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
      </View>

      {/* ---- below the fold on a phone; beside it on a laptop ---- */}
      <View style={wide ? styles.columnSide : undefined}>
      {wide ? null : <View style={styles.divider} />}

      {/* Staff reach this player to preview/reference audio; there is no student
          to track, so the listening bar and completion control are student-only.
          A short note says why, rather than leaving a bare gap. */}
      {studentUid ? (
        <>
          <Text style={styles.sectionHeading}>Your listening</Text>
          <View style={styles.listenedTrack}>
            <View style={[styles.listenedFill, { width: `${Math.round(listened * 100)}%` }]} />
          </View>
          <Text style={styles.body}>
            {Math.round(listened * 100)}% of this recording listened. Your place is saved
            automatically, so you can carry on from another device.
          </Text>
          <CompletionControl
            studentUid={studentUid}
            recordingId={recording.id}
            courseId={recording.courseId}
            everPlayed={state.listenedMs > 0 || state.positionMs > 0}
          />
        </>
      ) : (
        <Text style={styles.staffNote}>
          Staff preview — your listening isn&apos;t recorded, and there&apos;s nothing to mark
          complete here.
        </Text>
      )}

      {recording.notes ? (
        <>
          <Text style={styles.sectionHeading}>About this recording</Text>
          <Text style={styles.body}>{recording.notes}</Text>
        </>
      ) : null}

      {/* For a student the due date is not a nag, it is the day this recording
          closes to them — so it is stated as an availability window rather than
          a deadline. Staff previewing see the session's date plainly. */}
      {dueDate ? (
        <Text style={styles.due}>
          {studentUid ? `Available to listen until ${dueDate}` : `Due ${dueDate}`}
        </Text>
      ) : null}
      </View>
      </View>
    </ScrollView>
  );
}

/**
 * Stands where Spotify puts album art. A lecture has none, so the panel carries
 * the type instead — same visual anchor, nothing invented.
 */
function Hero({
  recording,
  courseName,
  cohortName,
}: {
  recording: RecordingRow;
  courseName: string;
  cohortName: string;
}) {
  return (
    <View style={styles.hero}>
      <Text style={styles.heroCourse}>
        {courseName.toUpperCase()}
        {cohortName ? ` · ${cohortName.toUpperCase()}` : ''}
      </Text>
      <Text style={styles.heroTitle}>{recording.title}</Text>
      {recording.date ? <Text style={styles.heroDate}>Recorded {recording.date}</Text> : null}
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
  courseId,
  everPlayed,
}: {
  studentUid: string;
  recordingId: string;
  courseId: string;
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
          onPress={() => void setCompleted(studentUid, recordingId, courseId, false)}
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
        onPress={() => void setCompleted(studentUid, recordingId, courseId, true)}
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
  // Wider than the phone column and still capped: two 480px columns plus a
  // gutter. Past that the notes run to line lengths nobody reads.
  contentWide: { maxWidth: 1060, paddingHorizontal: spacing(8), paddingTop: spacing(7) },
  columns: { flexDirection: 'row', gap: spacing(8), alignItems: 'flex-start' },
  columnMain: { flex: 1, minWidth: 0 },
  columnSide: { flex: 1, minWidth: 0 },
  hero: {
    backgroundColor: t.bg.sage,
    borderRadius: 16,
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(5),
    marginBottom: spacing(5),
    minHeight: 200,
    justifyContent: 'center',
  },
  heroCourse: {
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
  staffNote: { fontSize: 14, color: t.text.muted, fontStyle: 'italic', lineHeight: 20 },
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
