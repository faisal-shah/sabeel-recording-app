import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isVisibleToStudents, type RecordingStatus } from '@sabeel/shared';
import { Card, Empty, Notice, Screen, SectionTitle, StatusChip } from '../components/ui';
import { useAllRecordings, useClassRecordings, type RecordingRow } from '../recordings';
import { useMyClasses, type ClassRow } from '../structure';
import { useListenerError } from '../liveQuery';
import { getTheme, spacing } from '../theme';

const t = getTheme();
type StatusFilter = 'all' | RecordingStatus;
const STATUSES: StatusFilter[] = ['all', 'published', 'draft', 'archived', 'unpublished', 'needsAttention'];

/**
 * The cross-cohort recording library with status counts (deferred from Phase 3).
 * Admin sees a flat list of everything; a manager sees a section per class they
 * run (the rules forbid an unconstrained recordings list to a manager).
 */
export function LibraryScreen({
  uid,
  isAdmin,
  onOpen,
}: {
  uid: string;
  isAdmin: boolean;
  onOpen: (recording: RecordingRow, cls: ClassRow) => void;
}) {
  const listenerError = useListenerError();
  const [status, setStatus] = useState<StatusFilter>('all');
  const myClasses = useMyClasses(isAdmin ? null : uid);

  return (
    <Screen title="Recording library" subtitle={isAdmin ? 'All recordings' : 'Your classes'}>
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      <View style={styles.chips}>
        {STATUSES.map((s) => (
          <Pressable
            key={s}
            testID={`library-filter-${s}`}
            onPress={() => setStatus(s)}
            style={[styles.chip, status === s ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, status === s ? styles.chipTextOn : null]}>{s}</Text>
          </Pressable>
        ))}
      </View>

      {isAdmin ? (
        <AdminLibrary status={status} onOpen={onOpen} />
      ) : myClasses.length === 0 ? (
        <Empty>You are not assigned to any classes.</Empty>
      ) : (
        myClasses.map((cls) => (
          <ClassSection key={cls.id} cls={cls} status={status} onOpen={onOpen} />
        ))
      )}
    </Screen>
  );
}

function AdminLibrary({
  status,
  onOpen,
}: {
  status: StatusFilter;
  onOpen: (r: RecordingRow, c: ClassRow) => void;
}) {
  const all = useAllRecordings(true);
  const filtered = useMemo(
    () => (status === 'all' ? all : all.filter((r) => r.status === status)),
    [all, status],
  );
  // The library needs a class row to open a recording; admin opening the ledger
  // resolves the class in ClassDetail, so a minimal row by id is enough here.
  const clsFor = (r: RecordingRow): ClassRow =>
    ({ id: r.classId, name: r.classId, cohortId: r.cohortId } as ClassRow);
  return (
    <>
      <Counts recordings={all} />
      {filtered.length === 0 ? (
        <Empty>No recordings with that status.</Empty>
      ) : (
        filtered.map((r) => <RecordingLine key={r.id} r={r} onOpen={() => onOpen(r, clsFor(r))} />)
      )}
    </>
  );
}

function ClassSection({
  cls,
  status,
  onOpen,
}: {
  cls: ClassRow;
  status: StatusFilter;
  onOpen: (r: RecordingRow, c: ClassRow) => void;
}) {
  const recordings = useClassRecordings(cls.id);
  const filtered = status === 'all' ? recordings : recordings.filter((r) => r.status === status);
  return (
    <>
      <SectionTitle>{cls.name}</SectionTitle>
      <Counts recordings={recordings} />
      {filtered.length === 0 ? (
        <Empty>No recordings with that status.</Empty>
      ) : (
        filtered.map((r) => <RecordingLine key={r.id} r={r} onOpen={() => onOpen(r, cls)} />)
      )}
    </>
  );
}

function Counts({ recordings }: { recordings: RecordingRow[] }) {
  const published = recordings.filter((r) => isVisibleToStudents(r.status)).length;
  const attention = recordings.filter((r) => r.status === 'needsAttention').length;
  return (
    <Text style={styles.counts}>
      {recordings.length} total · {published} published
      {attention > 0 ? ` · ${attention} need attention` : ''}
    </Text>
  );
}

function RecordingLine({ r, onOpen }: { r: RecordingRow; onOpen: () => void }) {
  return (
    <Card>
      <Pressable testID={`library-open-${r.title}`} accessibilityRole="button" onPress={onOpen}>
        <Text style={styles.title}>{r.title}</Text>
        <View style={styles.meta}>
          <StatusChip status={r.status} />
          <Text style={styles.sub}>
            {r.durationSec ? `${Math.round(r.durationSec / 60)} min` : 'no audio'}
            {r.dueDate ? ` · due ${r.dueDate}` : ''}
          </Text>
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginBottom: spacing(4) },
  chip: { paddingVertical: spacing(1), paddingHorizontal: spacing(3), borderRadius: 999, borderWidth: 1, borderColor: t.border.strong },
  chipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  chipText: { fontSize: 12, fontWeight: '600', color: t.text.secondary },
  chipTextOn: { color: t.accent.onAccent },
  counts: { fontSize: 13, color: t.text.secondary, marginBottom: spacing(2) },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginTop: spacing(2) },
  sub: { fontSize: 13, color: t.text.secondary },
});
