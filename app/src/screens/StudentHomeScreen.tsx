import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  INSTITUTE_TIMEZONE,
  bucketRank,
  dueBucket,
  todayInZone,
  type ClassDoc,
  type DueBucket,
  type RecordingDoc,
} from '@sabeel/shared';
import { Button, Empty, Notice, Screen } from '../components/ui';
import { db } from '../firebase';
import { signOut } from '../session';
import { useListenerError } from '../liveQuery';
import { useMyAssignments, useMyCompletions } from '../completion';
import type { ClassRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * The student's task-ordered home (brief § Student home ordering).
 *
 * Shows only REQUIRED listening — recordings with an active assignment — grouped
 * Overdue → Due soon → Upcoming → No due date → Completed. Accessible-but-not-
 * required recordings live in the class archive ("Browse all recordings"),
 * never here. The obligation's OWN due date is authoritative (a catch-up may
 * differ from the recording's), so bucketing reads the assignment, not the
 * recording.
 */
export function StudentHomeScreen({
  uid,
  onOpen,
  onBrowse,
}: {
  uid: string;
  onOpen: (recording: RecordingRow, cls: ClassRow) => void;
  onBrowse: () => void;
}) {
  const listenerError = useListenerError();
  const assignments = useMyAssignments(uid);
  const completions = useMyCompletions(uid);
  const resolved = useResolvedRecordings(assignments.map((a) => a.recordingId));

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
          compareDue(a.dueDate, b.dueDate) ||
          a.recording.title.localeCompare(b.recording.title),
      );
  }, [assignments, resolved, completions, today]);

  const groups: { bucket: DueBucket; label: string; rows: TaskRow[] }[] = [
    { bucket: 'overdue', label: 'Overdue', rows: [] },
    { bucket: 'dueSoon', label: 'Due soon', rows: [] },
    { bucket: 'upcoming', label: 'Upcoming', rows: [] },
    { bucket: 'noDue', label: 'No due date', rows: [] },
    { bucket: 'done', label: 'Completed', rows: [] },
  ];
  for (const row of rows) groups.find((g) => g.bucket === row.bucket)?.rows.push(row);

  return (
    <Screen title="Your listening" subtitle="Required recordings, most urgent first">
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}

      {rows.length === 0 ? (
        <Empty>Nothing required right now. New recordings will appear here.</Empty>
      ) : (
        groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <View key={g.bucket} style={styles.group}>
              <Text style={[styles.groupLabel, g.bucket === 'overdue' ? styles.overdueLabel : null]}>
                {g.label}
              </Text>
              {g.rows.map((row) => (
                <TaskCard key={row.key} row={row} onOpen={() => onOpen(row.recording, row.cls)} />
              ))}
            </View>
          ))
      )}

      <View style={styles.footer}>
        <Button testID="nav-myrecordings" label="Browse all recordings" variant="secondary" onPress={onBrowse} />
        <Button testID="sign-out" label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

interface TaskRow {
  key: string;
  recording: RecordingRow;
  cls: ClassRow;
  dueDate: string | null;
  bucket: DueBucket;
  pending: boolean;
}

function TaskCard({ row, onOpen }: { row: TaskRow; onOpen: () => void }) {
  const done = row.bucket === 'done';
  return (
    <Pressable
      testID={`task-${row.recording.title}`}
      accessibilityRole="button"
      accessibilityLabel={`Listen to ${row.recording.title}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.cardMain}>
        <Text style={[styles.title, done ? styles.titleDone : null]}>{row.recording.title}</Text>
        <Text style={styles.class}>{row.cls.name}</Text>
      </View>
      <View style={styles.cardMeta}>
        {row.pending ? <Text style={styles.pending}>Pending sync</Text> : null}
        {done ? (
          <Text style={styles.doneChip}>Completed</Text>
        ) : (
          <Text style={[styles.due, row.bucket === 'overdue' ? styles.overdue : null]}>
            {row.dueDate ? `Due ${row.dueDate}` : 'No due date'}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * Resolve each assignment's recording and class for display and navigation.
 *
 * A plain get per id (not a live subscription): titles and class names change
 * rarely, and the accountability state that DOES change — assignment and
 * completion — is already live. Deduplicated and cached across renders.
 */
function useResolvedRecordings(
  recordingIds: string[],
): Map<string, { recording: RecordingRow; cls: ClassRow }> {
  const [resolved, setResolved] = useState<
    Map<string, { recording: RecordingRow; cls: ClassRow }>
  >(new Map());
  const key = useMemo(() => [...new Set(recordingIds)].sort().join(','), [recordingIds]);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(',') : [];
    void (async () => {
      const classCache = new Map<string, ClassRow | null>();
      const out = new Map<string, { recording: RecordingRow; cls: ClassRow }>();
      for (const id of ids) {
        const recSnap = await getDoc(doc(db, COLLECTIONS.recordings, id));
        if (!recSnap.exists()) continue;
        const recording = { id: recSnap.id, ...(recSnap.data() as RecordingDoc) };
        if (!classCache.has(recording.classId)) {
          const cSnap = await getDoc(doc(db, COLLECTIONS.classes, recording.classId));
          classCache.set(
            recording.classId,
            cSnap.exists() ? { id: cSnap.id, ...(cSnap.data() as ClassDoc) } : null,
          );
        }
        const cls = classCache.get(recording.classId);
        if (cls) out.set(id, { recording, cls });
      }
      if (!cancelled) setResolved(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return resolved;
}

/** Nulls (no due date) sort after real dates within their own bucket. */
function compareDue(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
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
  overdueLabel: { color: t.feedback.danger },
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
  cardMain: { flex: 1, paddingRight: spacing(3) },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  titleDone: { color: t.text.secondary },
  class: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  cardMeta: { alignItems: 'flex-end' },
  due: { fontSize: 13, color: t.text.secondary, fontVariant: ['tabular-nums'] },
  overdue: { color: t.feedback.danger, fontWeight: '600' },
  doneChip: { fontSize: 13, color: t.feedback.success, fontWeight: '600' },
  pending: { fontSize: 12, color: t.feedback.warning, fontWeight: '600', marginBottom: spacing(1) },
  footer: { marginTop: spacing(4), gap: spacing(2) },
});
