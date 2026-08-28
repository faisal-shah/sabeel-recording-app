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
import { Button, Empty, Notice, Screen } from '../components/ui';
import { PushNudge } from '../components/PushNudge';
import { db } from '../firebase';
import { signOut } from '../session';
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
  onBrowse,
  onNotifications,
}: {
  uid: string;
  onOpen: (recording: RecordingRow, cls: CourseRow, dueDate: string) => void;
  onBrowse: () => void;
  onNotifications: () => void;
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

  const groups: { bucket: DueBucket; label: string; rows: TaskRow[] }[] = [
    { bucket: 'missed', label: 'Missed', rows: [] },
    { bucket: 'dueSoon', label: 'Due soon', rows: [] },
    { bucket: 'upcoming', label: 'Upcoming', rows: [] },
    { bucket: 'done', label: 'Completed', rows: [] },
  ];
  for (const row of rows) groups.find((g) => g.bucket === row.bucket)?.rows.push(row);

  return (
    <Screen title="Your listening" subtitle="Recordings you were excused from, most urgent first">
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}

      {/* Top of the content, below the listener error only. Same place in all
          three apps: first thing after anything that needs acting on today. */}
      <PushNudge uid={uid} />

      {rows.length === 0 ? (
        <Empty>Nothing to listen to right now. New recordings will appear here.</Empty>
      ) : (
        groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <View key={g.bucket} style={styles.group}>
              <Text style={[styles.groupLabel, g.bucket === 'missed' ? styles.missedLabel : null]}>
                {g.label}
              </Text>
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

      <View style={styles.footer}>
        <Button
          testID="student-classes"
          label="My classes"
          variant="secondary"
          onPress={onBrowse}
        />
        <Button
          testID="nav-notifications"
          label="Notifications"
          variant="secondary"
          onPress={onNotifications}
        />
        <Button testID="sign-out" label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
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
  group: { marginBottom: spacing(5) },
  groupLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
    marginBottom: spacing(2),
  },
  missedLabel: { color: t.feedback.danger },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  pressed: { opacity: 0.85 },
  cardMissed: { backgroundColor: t.bg.inset },
  cardMain: { flex: 1, paddingRight: spacing(3) },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  titleDone: { color: t.text.secondary },
  course: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  cardMeta: { alignItems: 'flex-end' },
  due: { fontSize: 13, color: t.text.secondary, fontVariant: ['tabular-nums'] },
  missed: { color: t.feedback.danger, fontWeight: '600' },
  doneChip: { fontSize: 13, color: t.feedback.success, fontWeight: '600' },
  pending: { fontSize: 12, color: t.feedback.warning, fontWeight: '600', marginBottom: spacing(1) },
  footer: { marginTop: spacing(4), gap: spacing(2) },
});
