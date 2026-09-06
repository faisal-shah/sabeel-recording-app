import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { INSTITUTE_TIMEZONE, isOverdue, todayInZone, unbreakableDate } from '@sabeel/shared';
import { Button, Chips, Empty, Grid, Screen } from '../components/ui';
import { LEDGER_FILTERS, useStudentLedger, type LedgerFilter, type StudentLedgerItem } from '../ledger';
import { useCourseRecordings } from '../recordings';
import { exportCsv } from '../exportCsv';
import type { CourseRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

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
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const items = useStudentLedger(studentUid, cls.id);
  const recordings = useCourseRecordings(cls.id);
  const titleById = useMemo(() => new Map(recordings.map((r) => [r.id, r.title])), [recordings]);
  const [filter, setFilter] = useState<LedgerFilter>('all');

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
      <View style={styles.toolbar}>
        {/* The same options object as the recording ledger's, not a second copy
            of the same three words in the same order. */}
        <Chips value={filter} testIdPrefix="student-filter" options={LEDGER_FILTERS} onChange={setFilter} />
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
              {/* Wrapped in its own end-aligned block, like the student's home
                  card. As a bare Text a wrapped status fell to the left of its
                  own line, so a four-row list showed the same fact in two
                  places. */}
              <View style={styles.rowMeta}>
                <Text style={[styles.status, styleFor(r, today)]}>{statusLabel(r, today)}</Text>
              </View>
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
  return `Listen by ${unbreakableDate(r.dueDate)}`;
}
function styleFor(r: StudentLedgerItem, today: string) {
  if (r.completed) return styles.ok;
  if (isOverdue(r.dueDate, today)) return styles.bad;
  return styles.warn;
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    marginBottom: spacing(4),
    flexWrap: 'wrap',
  },
  row: {
    // Fills the grid cell it is given, so a row of these ends level instead
    // of ragged with its actions at three different heights.
    flexGrow: 1,
    flexDirection: 'row',
    // TOP, not centre. Centred, the status floated to the middle of whatever
    // its title happened to measure, so three cards in a row put "Missed" at
    // three different heights — a 17px stagger the recording ledger, doing the
    // same job, does not have.
    alignItems: 'flex-start',
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
  // cannot share a line, so the status moves to its own. 150, not 200 — at 200 a
  // three-column row at 1440 wrapped while the same cards at 1024 did not, so
  // one row showed the status in two places.
  rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 150, minWidth: 150 },
  // `flexGrow: 1` is what makes `flex-end` mean anything once the row wraps:
  // sized to its content the block sits at the line's start, so a wrapped status
  // fell to the LEFT while its unwrapped neighbours stayed right. Same shape as
  // the student home's own card.
  rowMeta: { alignItems: 'flex-end', flexGrow: 1 },
  status: { fontSize: 13, fontWeight: '700' },
  ok: { color: t.feedback.success },
  bad: { color: t.feedback.danger },
  warn: { color: t.text.secondary },
});
