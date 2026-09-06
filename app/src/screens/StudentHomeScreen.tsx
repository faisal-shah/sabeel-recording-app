import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  INSTITUTE_TIMEZONE,
  bucketRank,
  dueBucket,
  todayInZone,
  type CourseDoc,
  type DueBucket,
  type RecordingDoc,
} from '@sabeel/shared';
import { Empty, Notice, Screen } from '../components/ui';
import { PushNudge } from '../components/PushNudge';
import { db } from '../firebase';
import { useListenerError } from '../liveQuery';
import { captureError } from '../sentry';
import { useMyAssignments, useMyCompletions } from '../completion';
import { drainCompletionOutbox } from '../completionOutbox';
import type { CourseRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * The student's task-ordered home.
 *
 * Every recording a student can reach is here, because a recording is granted by
 * being excused and that grant is exactly what makes it required. So this is at
 * once the to-do list and the whole of what they may listen to — there is no
 * separate browsable archive, and nothing to show that is "available but not
 * required".
 *
 * Grouped Missed → Due soon → Upcoming → Completed. A missed row is kept rather
 * than hidden: access closed, and a student is owed the record of what closed
 * and when. The grant's OWN due date is authoritative, so bucketing reads the
 * assignment, not the recording.
 */
export function StudentHomeScreen({
  uid,
  onOpen,
}: {
  uid: string;
  onOpen: (recording: RecordingRow, cls: CourseRow, dueDate: string) => void;
}) {
  const listenerError = useListenerError();
  const assignments = useMyAssignments(uid);
  const completions = useMyCompletions(uid);
  const resolved = useResolvedRecordings(assignments.map((a) => a.recordingId));

  // On launch, replay any completion this device marked offline and then lost to
  // an app kill before it synced (native only; a no-op on web). Runs once the
  // student is signed in, so the replayed writes carry their auth.
  useEffect(() => {
    void drainCompletionOutbox(uid);
  }, [uid]);

  const today = todayInZone(INSTITUTE_TIMEZONE);

  const rows = useMemo(() => {
    return assignments
      .map((a) => {
        const r = resolved.get(a.recordingId);
        if (!r) return null;
        const state = completions.get(a.recordingId);
        const bucket = dueBucket({ dueDate: a.dueDate, completed: state?.completed ?? false }, today);
        return {
          key: a.id,
          recording: r.recording,
          cls: r.cls,
          dueDate: a.dueDate,
          bucket,
          pending: state?.pending ?? false,
        };
      })
      .filter((x): x is TaskRow => x !== null)
      .sort(
        (a, b) =>
          bucketRank(a.bucket) - bucketRank(b.bucket) ||
          a.dueDate.localeCompare(b.dueDate) ||
          a.recording.title.localeCompare(b.recording.title),
      );
  }, [assignments, resolved, completions, today]);

  /**
   * The hero: the most urgent recording that can actually be OPENED.
   *
   * Not simply the first incomplete row. A missed recording sorts above
   * everything and is deliberately not a play target — the server refuses to
   * mint a URL past the deadline, so a big tappable card for one would look
   * like the app's most important action and then fail. It stays in the Missed
   * group, where the student is owed the record of what closed and when, and
   * the hero falls through to the first thing still open.
   */
  const next = rows.find((r) => r.bucket === 'dueSoon' || r.bucket === 'upcoming') ?? null;
  const listed = next ? rows.filter((r) => r.key !== next.key) : rows;

  const groups: { bucket: DueBucket; label: string; rows: TaskRow[] }[] = [
    { bucket: 'missed', label: 'Missed', rows: [] },
    { bucket: 'dueSoon', label: 'Due soon', rows: [] },
    { bucket: 'upcoming', label: 'Upcoming', rows: [] },
    { bucket: 'done', label: 'Completed', rows: [] },
  ];
  for (const row of listed) groups.find((g) => g.bucket === row.bucket)?.rows.push(row);

  /*
   * A READING COLUMN, not a card grid.
   *
   * This is a short, ordered task list — usually one or two items — and flowing
   * it into columns froze every row at a third of a 1400px window while leaving
   * the rest of the page empty and wrapping the titles to five lines. A capped,
   * centred column is the right shape for a list read top to bottom, and it is
   * what `Screen` does by default.
   */
  return (
    <Screen
      title="Your listening"
      /* NOT "recordings you were excused from". Being excused is what grants
         these — but read plainly it says "recordings you do not have to listen
         to", which is the opposite of what this list is, and it borrows a
         staff-side attendance word into the student's vocabulary. Say what the
         list is for. */
      subtitle="Classes to catch up on, soonest first"
    >
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}

      {/* Top of the content, below the listener error only. Same place in all
          three apps: first thing after anything that needs acting on today. */}
      <PushNudge uid={uid} />

      {/*
        The one recording to listen to next, at full size, above the grouped
        list of everything else.

        This list is usually one item long — a student is excused from a class
        now and then, not every week — so the common case is a single card under
        a heading with three empty groups implied around it, and the tap that
        matters is always the first one. The grouping below still carries the
        week somebody returns from a fortnight away with five to catch up on.
      */}
      {next ? (
        <Pressable
          testID={`next-up-${next.recording.title}`}
          accessibilityRole="button"
          accessibilityLabel={`Listen to ${next.recording.title}`}
          onPress={() => onOpen(next.recording, next.cls, next.dueDate)}
          style={({ pressed }) => [styles.hero, pressed ? styles.heroPressed : null]}
        >
          <Text style={styles.heroLabel}>NEXT TO LISTEN</Text>
          <Text style={styles.heroTitle}>{next.recording.title}</Text>
          <Text style={styles.heroCourse}>{next.cls.name}</Text>
          <Text style={styles.heroDue}>Listen by {next.dueDate}</Text>
          {/* THE CARD IS THE BUTTON, so it has to say so. Without this line the
              app's single most important action was a date in bold ivory — it
              looked like a button label and was not one, and nothing on the
              student's landing screen named the thing to do. */}
          <Text style={styles.heroAction}>Listen ›</Text>
        </Pressable>
      ) : null}

      {rows.length === 0 ? (
        <Empty>Nothing to listen to right now. New recordings will appear here.</Empty>
      ) : (
        groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <View key={g.bucket} style={styles.group}>
              {/* No special treatment. Alarm red on the one group a student
                  can do nothing about — sitting over cards deliberately quieted
                  for the same reason — made one of four peer headings read as an
                  error state. "Missed" is already the word. */}
              <Text style={styles.groupLabel}>{g.label}</Text>
              {g.rows.map((row) => (
                <TaskCard
                  key={row.key}
                  row={row}
                  onOpen={() => onOpen(row.recording, row.cls, row.dueDate)}
                />
              ))}
            </View>
          ))
      )}

    </Screen>
  );
}

interface TaskRow {
  key: string;
  recording: RecordingRow;
  cls: CourseRow;
  dueDate: string;
  bucket: DueBucket;
  pending: boolean;
}

/**
 * A missed card is deliberately not a button. The server refuses to mint a URL
 * past the due date, so opening it could only produce an error — and a card that
 * looks tappable and then refuses reads as a fault in the app rather than a
 * deadline the student missed.
 */
function TaskCard({ row, onOpen }: { row: TaskRow; onOpen: () => void }) {
  const done = row.bucket === 'done';
  const missed = row.bucket === 'missed';
  const body = (
    <>
      <View style={styles.cardMain}>
        <Text style={[styles.title, done || missed ? styles.titleDone : null]}>
          {row.recording.title}
        </Text>
        <Text style={styles.course}>{row.cls.name}</Text>
      </View>
      <View style={styles.cardMeta}>
        {row.pending ? <Text style={styles.pending}>Pending sync</Text> : null}
        {done ? (
          <Text style={styles.doneChip}>Completed</Text>
        ) : (
          <Text style={[styles.due, missed ? styles.missed : null]}>
            {missed ? `Closed ${row.dueDate}` : `Listen by ${row.dueDate}`}
          </Text>
        )}
      </View>
    </>
  );

  if (missed) {
    return (
      <View testID={`task-${row.recording.title}`} style={[styles.card, styles.cardMissed]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={`task-${row.recording.title}`}
      accessibilityRole="button"
      accessibilityLabel={`Listen to ${row.recording.title}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Read one document, treating a refusal as an answer.
 *
 * `permission-denied` is not a failure here: a student may read a recording only
 * while it is PUBLISHED, so an assignment pointing at one staff have just
 * unpublished comes back refused rather than absent. That is the same "it is not
 * available to you" the missing-document branch already handles, so it skips the
 * row the same way.
 *
 * Anything else rethrows on purpose. An offline or failed read must never be
 * mistaken for an empty syllabus — the caller keeps its last good list instead
 * of publishing a short one.
 */
async function readIfPermitted(collectionPath: string, id: string) {
  try {
    const snap = await getDoc(doc(db, collectionPath, id));
    return snap.exists() ? snap : null;
  } catch (e) {
    if ((e as { code?: string }).code === 'permission-denied') return null;
    throw e;
  }
}

/**
 * Resolve each assignment's recording and course for display and navigation.
 *
 * A plain get per id (not a live subscription): titles and course names change
 * rarely, and the accountability state that DOES change — assignment and
 * completion — is already live. Deduplicated and cached across renders.
 *
 * Every read is individually survivable. When one throw could abandon the loop,
 * a single unpublished recording emptied the ENTIRE screen: the rejection escaped
 * before setResolved ran, so no assignment resolved and the student read
 * "Nothing required right now". The fan-out deactivates those assignments a few
 * seconds later, which cleared the screen up again and made the whole thing look
 * like nothing had happened.
 */
function useResolvedRecordings(
  recordingIds: string[],
): Map<string, { recording: RecordingRow; cls: CourseRow }> {
  const [resolved, setResolved] = useState<
    Map<string, { recording: RecordingRow; cls: CourseRow }>
  >(new Map());
  const key = useMemo(() => [...new Set(recordingIds)].sort().join(','), [recordingIds]);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    void (async () => {
      const courseCache = new Map<string, CourseRow | null>();
      const out = new Map<string, { recording: RecordingRow; cls: CourseRow }>();
      try {
        for (const id of ids) {
          const recSnap = await readIfPermitted(COLLECTIONS.recordings, id);
          if (!recSnap) continue;
          const recording = { id: recSnap.id, ...(recSnap.data() as RecordingDoc) };
          if (!courseCache.has(recording.courseId)) {
            const cSnap = await readIfPermitted(COLLECTIONS.courses, recording.courseId);
            courseCache.set(
              recording.courseId,
              cSnap ? { id: cSnap.id, ...(cSnap.data() as CourseDoc) } : null,
            );
          }
          const cls = courseCache.get(recording.courseId);
          if (cls) out.set(id, { recording, cls });
        }
      } catch (e) {
        // Keep the last good list rather than showing a short one, and say so
        // off-device — this used to be an unhandled rejection nobody could see.
        captureError(e, { source: 'resolveAssignedRecordings' });
        return;
      }
      if (!cancelled) setResolved(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return resolved;
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: t.accent.base,
    borderRadius: 12,
    padding: spacing(5),
    marginBottom: spacing(5),
  },
  heroPressed: { opacity: 0.9 },
  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: t.accent.onAccentMuted,
  },
  heroTitle: { fontSize: 22, fontWeight: '700', color: t.accent.onAccent, marginTop: spacing(2) },
  heroCourse: { fontSize: 14, color: t.accent.onAccentMuted, marginTop: 2 },
  heroDue: { fontSize: 14, color: t.accent.onAccentMuted, marginTop: spacing(3) },
  heroAction: { fontSize: 15, fontWeight: '700', color: t.accent.onAccent, marginTop: spacing(2) },
  group: { marginBottom: spacing(5) },
  groupLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
    marginBottom: spacing(2),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    // WRAPS AT 320. Side by side, a title of any length gets 117px beside a
    // one-line date — this app's real titles then break into seven lines
    // against 140px of empty card. Wrapping drops the date under the title,
    // where it has the whole width.
    flexWrap: 'wrap',
    rowGap: spacing(2),
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  pressed: { opacity: 0.85 },
  cardMissed: { backgroundColor: t.bg.inset },
  // `minWidth` is what makes the wrap happen: below it the two blocks cannot
  // share a line, so the date moves to its own.
  cardMain: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 220, paddingRight: spacing(3) },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  titleDone: { color: t.text.secondary },
  course: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  cardMeta: { alignItems: 'flex-end', flexGrow: 1 },
  /*
   * THE LIVE DATE IS THE LOUD ONE.
   *
   * It was the other way round: "Closed 2026-08-28" came out danger-red and
   * bold while "Listen by 2026-09-11" was quiet secondary — the app shouting
   * about the one thing the student can no longer do anything about, and
   * whispering the three they can. A closed grant is information; the tone the
   * brief asks for is "missed", not a reprimand.
   */
  due: { fontSize: 13, fontWeight: '600', color: t.text.primary, fontVariant: ['tabular-nums'] },
  missed: { color: t.text.secondary, fontWeight: '400' },
  doneChip: { fontSize: 13, color: t.feedback.success, fontWeight: '600' },
  pending: { fontSize: 12, color: t.feedback.warning, fontWeight: '600', marginBottom: spacing(1) },
});
