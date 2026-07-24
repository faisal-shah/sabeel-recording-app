import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  INSTITUTE_TIMEZONE,
  isOverdue,
  ledgerBucket,
  todayInZone,
} from '@sabeel/shared';
import { Button, Empty, Field, Notice, Screen, SectionTitle } from '../components/ui';
import {
  overrideCompletion,
  clearCompletionOverride,
  useRecordingLedger,
  type LedgerRow,
} from '../ledger';
import { exportCsv } from '../exportCsv';
import { useListenerError } from '../liveQuery';
import type { ClassRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();
type Filter = 'all' | 'notComplete' | 'overdue';

/**
 * Recording ledger: the accountable roster for one recording, action-first.
 * Defaults to "Not complete" so staff land on who needs chasing, not a wall of
 * green. Effective status is override ?? student; the override is applied here.
 */
export function RecordingLedgerScreen({
  recording,
  cls,
}: {
  recording: RecordingRow;
  cls: ClassRow;
}) {
  const listenerError = useListenerError();
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const { accountable, notRequired, rollup } = useRecordingLedger(recording, today);
  const [filter, setFilter] = useState<Filter>('notComplete');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (filter === 'all') return accountable;
    if (filter === 'notComplete') return accountable.filter((r) => !r.completed);
    return accountable.filter((r) => !r.completed && isOverdue(r.dueDate, today));
  }, [accountable, filter, today]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportRows = () => {
    const header = ['Student', 'Status', 'Listened %', 'Last listened', 'Completed at', 'Due', 'Override reason'];
    const body = rows.map((r) => [
      r.name,
      statusLabel(r, today),
      `${Math.round(r.listenedPct * 100)}`,
      fmtDate(r.lastListened),
      fmtDate(r.completedAt),
      r.dueDate ?? '',
      r.overrideReason ?? '',
    ]);
    void exportCsv(`${cls.name} - ${recording.title} progress.csv`, [header, ...body]);
  };

  return (
    <Screen title={recording.title} subtitle={`${cls.name} · listening progress`}>
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <View style={styles.summary}>
        <Stat label="Accountable" value={rollup.total} />
        <Stat label="Complete" value={rollup.complete} tone="success" />
        <Stat label="Incomplete" value={rollup.incomplete} />
        <Stat label="Overdue" value={rollup.overdue} tone={rollup.overdue > 0 ? 'danger' : undefined} />
      </View>

      <View style={styles.chips}>
        {(['notComplete', 'overdue', 'all'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            testID={`ledger-filter-${f}`}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, filter === f ? styles.chipTextOn : null]}>
              {f === 'notComplete' ? 'Not complete' : f === 'overdue' ? 'Overdue' : 'All'}
            </Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        <Button
          testID="ledger-export"
          label="Export CSV"
          variant="secondary"
          disabled={rows.length === 0}
          onPress={exportRows}
        />
      </View>

      {rows.length === 0 ? (
        <Empty>
          {filter === 'all'
            ? 'No one is accountable for this recording yet.'
            : filter === 'overdue'
              ? 'No one is overdue — nice.'
              : 'Everyone accountable has completed this — nice.'}
        </Empty>
      ) : (
        rows.map((r) => (
          <LedgerRowCard
            key={r.studentUid}
            row={r}
            recordingId={recording.id}
            today={today}
            busy={busy}
            onRun={run}
          />
        ))
      )}

      {notRequired.length > 0 ? (
        <>
          <SectionTitle>Completed, not required</SectionTitle>
          <Notice tone="info">
            These students completed the recording without being assigned it. It is kept as history
            and does not count toward accountability.
          </Notice>
          {notRequired.map((r) => (
            <View key={r.studentUid} style={styles.row}>
              <Text style={styles.name}>{r.name}</Text>
              <Text style={styles.sub}>completed {fmtDate(r.completedAt)}</Text>
            </View>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function LedgerRowCard({
  row: r,
  recordingId,
  today,
  busy,
  onRun,
}: {
  row: LedgerRow;
  recordingId: string;
  today: string;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(r.overrideReason ?? '');
  const bucket = ledgerBucket(r.dueDate, r.completed, today);

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{r.name}</Text>
          <Text style={styles.sub}>
            {Math.round(r.listenedPct * 100)}% listened
            {r.lastListened ? ` · last ${fmtDate(r.lastListened)}` : ''}
            {r.pending ? ' · pending sync' : ''}
          </Text>
          {r.source === 'override' ? (
            <Text style={styles.override}>Override: {r.overrideReason}</Text>
          ) : null}
        </View>
        <Text style={[styles.status, statusStyle(bucket)]}>{statusLabel(r, today)}</Text>
      </View>

      {open ? (
        <View style={styles.overrideForm}>
          <Field
            testID={`override-reason-${r.name}`}
            label="Reason (required, recorded in the audit log)"
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. attended the class live"
          />
          <View style={styles.overrideButtons}>
            <Button
              testID={`override-complete-${r.name}`}
              label="Mark complete"
              disabled={!reason.trim()}
              busy={busy === `ov-${r.studentUid}`}
              onPress={() =>
                onRun(`ov-${r.studentUid}`, async () => {
                  await overrideCompletion({ studentUid: r.studentUid, recordingId, completed: true, reason: reason.trim() });
                  setOpen(false);
                })
              }
            />
            <Button
              testID={`override-incomplete-${r.name}`}
              label="Mark not complete"
              variant="secondary"
              disabled={!reason.trim()}
              busy={busy === `ov-${r.studentUid}`}
              onPress={() =>
                onRun(`ov-${r.studentUid}`, async () => {
                  await overrideCompletion({ studentUid: r.studentUid, recordingId, completed: false, reason: reason.trim() });
                  setOpen(false);
                })
              }
            />
          </View>
          {r.source === 'override' ? (
            <Button
              testID={`override-remove-${r.name}`}
              label="Remove override"
              variant="secondary"
              disabled={!reason.trim()}
              busy={busy === `rm-${r.studentUid}`}
              onPress={() =>
                onRun(`rm-${r.studentUid}`, async () => {
                  await clearCompletionOverride({ studentUid: r.studentUid, recordingId, reason: reason.trim() });
                  setOpen(false);
                })
              }
            />
          ) : null}
          <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      ) : (
        <Button
          testID={`override-open-${r.name}`}
          label={r.source === 'override' ? 'Change override' : 'Override'}
          variant="secondary"
          onPress={() => setOpen(true)}
        />
      )}
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'danger' }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone === 'success' ? styles.ok : tone === 'danger' ? styles.bad : null]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function statusLabel(r: LedgerRow, today: string): string {
  if (r.completed) return r.source === 'override' ? 'Complete (override)' : 'Complete';
  if (isOverdue(r.dueDate, today)) return 'Overdue';
  return r.dueDate ? 'Not complete' : 'Not complete · no due';
}

function statusStyle(bucket: string) {
  if (bucket === 'done') return styles.ok;
  if (bucket === 'overdue') return styles.bad;
  return styles.warn;
}

function fmtDate(ms: number | null): string {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString();
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', gap: spacing(3), marginBottom: spacing(4) },
  stat: { flex: 1, backgroundColor: t.bg.surface, borderRadius: 10, padding: spacing(3), alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', color: t.text.primary },
  statLabel: { fontSize: 11, color: t.text.secondary, marginTop: spacing(1) },
  ok: { color: t.feedback.success },
  bad: { color: t.feedback.danger },
  warn: { color: t.feedback.warning },
  chips: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(4), flexWrap: 'wrap' },
  chip: {
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(3),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border.strong,
  },
  chipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  chipText: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  chipTextOn: { color: t.accent.onAccent },
  row: {
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  sub: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  override: { fontSize: 13, color: t.text.accent, marginTop: spacing(1) },
  status: { fontSize: 13, fontWeight: '700' },
  overrideForm: { marginTop: spacing(3), gap: spacing(2) },
  overrideButtons: { flexDirection: 'row', gap: spacing(2) },
});
