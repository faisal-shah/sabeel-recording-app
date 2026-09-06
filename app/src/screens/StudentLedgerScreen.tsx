import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { INSTITUTE_TIMEZONE, isOverdue, todayInZone } from '@sabeel/shared';
import { Button, Empty, Grid, Notice, Screen } from '../components/ui';
import { useStudentLedger, type StudentLedgerItem } from '../ledger';
import { useCourseRecordings } from '../recordings';
import { exportCsv } from '../exportCsv';
import { useListenerError } from '../liveQuery';
import type { CourseRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();
// "Missed", never "overdue": once the deadline passes access has closed, so the
// work is not still outstanding. The word matches the recording ledger, the
// course detail, the student's own home and the CSV export.
type Filter = 'all' | 'notComplete' | 'missed';

/** One student's required listening in one course. */
export function StudentLedgerScreen({
  studentUid,
  studentName,
  cls,
}: {
  studentUid: string;
  studentName: string;
  cls: CourseRow;
}) {
  const listenerError = useListenerError();
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const items = useStudentLedger(studentUid, cls.id);
  const recordings = useCourseRecordings(cls.id);
  const titleById = useMemo(() => new Map(recordings.map((r) => [r.id, r.title])), [recordings]);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const withTitle = items.map((it) => ({ ...it, title: titleById.get(it.recordingId) ?? it.recordingId }));
    if (filter === 'notComplete') return withTitle.filter((r) => !r.completed);
    if (filter === 'missed') return withTitle.filter((r) => !r.completed && isOverdue(r.dueDate, today));
    return withTitle;
  }, [items, titleById, filter, today]);

  const exportRows = () => {
    const header = ['Recording', 'Status', 'Due', 'Override reason'];
    const body = rows.map((r) => [r.title, statusLabel(r, today), r.dueDate, r.overrideReason ?? '']);
    void exportCsv(`${cls.name} - ${studentName} ledger.csv`, [header, ...body]);
  };

  return (
    <Screen title={studentName} subtitle={`${cls.name} · required listening`} width="list">
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      <View style={styles.chips}>
        {(['all', 'notComplete', 'missed'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            testID={`student-filter-${f}`}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, filter === f ? styles.chipTextOn : null]}>
              {f === 'notComplete' ? 'Not complete' : f === 'missed' ? 'Missed' : 'All'}
            </Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Button testID="student-export" label="Export CSV" variant="secondary" disabled={rows.length === 0} onPress={exportRows} />
      </View>

      {rows.length === 0 ? (
        <Empty>No required recordings here.</Empty>
      ) : (
        <Grid min={330}>
          {rows.map((r) => (
            <View key={r.recordingId} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.title}>{r.title}</Text>
                {r.source === 'override' ? (
                  <Text style={styles.override}>Override: {r.overrideReason}</Text>
                ) : null}
              </View>
              <Text style={[styles.status, styleFor(r, today)]}>{statusLabel(r, today)}</Text>
            </View>
          ))}
        </Grid>
      )}
    </Screen>
  );
}

function statusLabel(r: StudentLedgerItem, today: string): string {
  if (r.completed) return r.source === 'override' ? 'Completed (override)' : 'Completed';
  if (isOverdue(r.dueDate, today)) return 'Missed';
  // "Listen by", the same words the student sees on their own screens — not a
  // staff-only synonym for the same date.
  return `Listen by ${r.dueDate}`;
}
function styleFor(r: StudentLedgerItem, today: string) {
  if (r.completed) return styles.ok;
  if (isOverdue(r.dueDate, today)) return styles.bad;
  return styles.warn;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(4), flexWrap: 'wrap' },
  // 44 TALL, like every other target in the app. A filter chip is a control
  // people tap on a phone, and at 24px two wrapped rows of them sat a
  // finger-width apart. The sweep reports small targets and never fails them,
  // which is how four screens' worth stayed at half size.
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(4),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border.strong,
  },
  chipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  chipText: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  chipTextOn: { color: t.accent.onAccent },
  row: {
    // Fills the grid cell it is given, so a row of these ends level instead
    // of ragged with its actions at three different heights.
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    // WRAPS AT 320. Side by side, a title of any length and a "Listen by
    // 2026-09-09" ran into each other with no gap at all — the words touching
    // on one baseline and the rest of the title wrapping under the date.
    flexWrap: 'wrap',
    columnGap: spacing(3),
    rowGap: spacing(2),
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  override: { fontSize: 13, color: t.text.accent, marginTop: spacing(1) },
  // `minWidth` is what makes the wrap happen: below it the title and the status
  // cannot share a line, so the status moves to its own.
  rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 200, minWidth: 200 },
  status: { fontSize: 13, fontWeight: '700' },
  ok: { color: t.feedback.success },
  bad: { color: t.feedback.danger },
  warn: { color: t.text.secondary },
});
