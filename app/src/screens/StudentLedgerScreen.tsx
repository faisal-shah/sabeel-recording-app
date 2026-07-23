import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { INSTITUTE_TIMEZONE, isOverdue, todayInZone } from '@sabeel/shared';
import { Button, Empty, Notice, Screen } from '../components/ui';
import { useStudentLedger, type StudentLedgerItem } from '../ledger';
import { useClassRecordings } from '../recordings';
import { exportCsv } from '../exportCsv';
import { useListenerError } from '../liveQuery';
import type { ClassRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();
type Filter = 'all' | 'notComplete' | 'overdue';

/** One student's required listening in one class. */
export function StudentLedgerScreen({
  studentUid,
  studentName,
  cls,
}: {
  studentUid: string;
  studentName: string;
  cls: ClassRow;
}) {
  const listenerError = useListenerError();
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const items = useStudentLedger(studentUid, cls.id);
  const recordings = useClassRecordings(cls.id);
  const titleById = useMemo(() => new Map(recordings.map((r) => [r.id, r.title])), [recordings]);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const withTitle = items.map((it) => ({ ...it, title: titleById.get(it.recordingId) ?? it.recordingId }));
    if (filter === 'notComplete') return withTitle.filter((r) => !r.completed);
    if (filter === 'overdue') return withTitle.filter((r) => !r.completed && isOverdue(r.dueDate, today));
    return withTitle;
  }, [items, titleById, filter, today]);

  const exportRows = () => {
    const header = ['Recording', 'Status', 'Due', 'Override reason'];
    const body = rows.map((r) => [r.title, statusLabel(r, today), r.dueDate ?? '', r.overrideReason ?? '']);
    void exportCsv(`${cls.name} - ${studentName} ledger.csv`, [header, ...body]);
  };

  return (
    <Screen title={studentName} subtitle={`${cls.name} · required listening`}>
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      <View style={styles.chips}>
        {(['all', 'notComplete', 'overdue'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            testID={`student-filter-${f}`}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, filter === f ? styles.chipTextOn : null]}>
              {f === 'notComplete' ? 'Not complete' : f === 'overdue' ? 'Overdue' : 'All'}
            </Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Button testID="student-export" label="Export CSV" variant="secondary" disabled={rows.length === 0} onPress={exportRows} />
      </View>

      {rows.length === 0 ? (
        <Empty>No required recordings here.</Empty>
      ) : (
        rows.map((r) => (
          <View key={r.recordingId} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{r.title}</Text>
              {r.source === 'override' ? <Text style={styles.override}>Override: {r.overrideReason}</Text> : null}
            </View>
            <Text style={[styles.status, styleFor(r, today)]}>{statusLabel(r, today)}</Text>
          </View>
        ))
      )}
    </Screen>
  );
}

function statusLabel(r: StudentLedgerItem, today: string): string {
  if (r.completed) return r.source === 'override' ? 'Complete (override)' : 'Complete';
  if (isOverdue(r.dueDate, today)) return 'Overdue';
  return r.dueDate ? `Due ${r.dueDate}` : 'No due date';
}
function styleFor(r: StudentLedgerItem, today: string) {
  if (r.completed) return styles.ok;
  if (isOverdue(r.dueDate, today)) return styles.bad;
  return styles.warn;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(4), flexWrap: 'wrap' },
  chip: { paddingVertical: spacing(1), paddingHorizontal: spacing(3), borderRadius: 999, borderWidth: 1, borderColor: t.border.strong },
  chipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  chipText: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  chipTextOn: { color: t.accent.onAccent },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  override: { fontSize: 13, color: t.text.accent, marginTop: spacing(1) },
  status: { fontSize: 13, fontWeight: '700' },
  ok: { color: t.feedback.success },
  bad: { color: t.feedback.danger },
  warn: { color: t.text.secondary },
});
