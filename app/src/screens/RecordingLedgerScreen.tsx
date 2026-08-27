import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  INSTITUTE_TIMEZONE,
  isOverdue,
  ledgerBucket,
  todayInZone,
  type DueBucket,
} from '@sabeel/shared';
import { Button, Empty, Field, Notice, Row, Screen, SectionTitle } from '../components/ui';
import {
  overrideCompletion,
  clearCompletionOverride,
  useRecordingLedger,
  type LedgerRow,
  type RequiredRow,
} from '../ledger';
import { exportCsv } from '../exportCsv';
import { useListenerError } from '../liveQuery';
import { useCohortName, type CourseRow } from '../structure';
import type { SessionRow } from '../sessions';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();
type Filter = 'all' | 'notComplete' | 'missed';

/**
 * Recording ledger: the accountable roster for one recording, action-first.
 * Defaults to "Not complete" so staff land on who needs chasing, not a wall of
 * green. Effective status is override ?? student; the override is applied here.
 */
export function RecordingLedgerScreen({
  recording,
  session,
  cls,
}: {
  recording: RecordingRow;
  session: SessionRow;
  cls: CourseRow;
}) {
  const listenerError = useListenerError();
  const today = todayInZone(INSTITUTE_TIMEZONE);
  // Reached from the cross-cohort library, where the course name alone is ambiguous.
  const cohortName = useCohortName()(cls.cohortId);
  const { accountable, attendees, absentees, lapsed, otherListeners, rollup } = useRecordingLedger(
    recording,
    session,
    today,
  );
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
    const header = ['Student', 'Attendance', 'Status', 'Listened %', 'Last listened', 'Completed at', 'Due', 'Override reason'];
    const body = rows.map((r) => [
      r.name,
      r.attendance ?? '',
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
    <Screen
      title={recording.title}
      subtitle={`${cohortName ? `${cls.name} · ${cohortName}` : cls.name} · listening progress`}
    >
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <View style={styles.summary}>
        <Stat label="Accountable" value={rollup.total} />
        <Stat label="Complete" value={rollup.complete} tone="success" />
        <Stat label="Incomplete" value={rollup.incomplete} />
        <Stat label="Missed" value={rollup.missed} tone={rollup.missed > 0 ? 'danger' : undefined} />
      </View>

      <View style={styles.chips}>
        {(['notComplete', 'missed', 'all'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            testID={`ledger-filter-${f}`}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
            onPress={() => setFilter(f)}
            style={[styles.chip, filter === f ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, filter === f ? styles.chipTextOn : null]}>
              {f === 'notComplete' ? 'Not complete' : f === 'missed' ? 'Missed' : 'All'}
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
          {/* An empty accountable list is answered before the filter is: with
              nobody granted the recording at all, "everyone has completed this"
              would be congratulating staff on nothing having happened. */}
          {accountable.length === 0
            ? lapsed.length > 0
              ? 'Nobody holds this recording now — every grant from this session has lapsed. See below.'
              : 'No one was excused from this session, so nobody has been granted this recording.'
            : filter === 'missed'
              ? 'Nobody missed the deadline — nice.'
              : 'Everyone required has completed this — nice.'}
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

      <SectionTitle>Present ({attendees.length})</SectionTitle>
      {attendees.length === 0 ? (
        <Empty>No one was marked present at this session.</Empty>
      ) : (
        <>
          <Notice tone="info">
            They were at the session, so this recording is neither required for them nor open to
            them.
          </Notice>
          {attendees.map((r) => (
            <ListenerRow key={r.studentUid} row={r} />
          ))}
        </>
      )}

      {absentees.length > 0 ? (
        <>
          <SectionTitle>Absent ({absentees.length})</SectionTitle>
          <Notice tone="info">
            Marked absent rather than excused, so the recording was not opened to them. To let
            someone catch up, mark them excused on the session and submit again.
          </Notice>
          {absentees.map((r) => (
            <ListenerRow key={r.studentUid} row={r} />
          ))}
        </>
      ) : null}

      {lapsed.length > 0 ? (
        <>
          <SectionTitle>Excused, access closed ({lapsed.length})</SectionTitle>
          <Notice tone="info">
            Excused at the session, but their grant is no longer active — they were unenrolled from
            the class, or this recording was unpublished. Nothing is required of them, and they
            can&apos;t open it. Re-enrolling or republishing restores the grant.
          </Notice>
          {lapsed.map((r) => (
            <ListenerRow key={r.studentUid} row={r} />
          ))}
        </>
      ) : null}

      {otherListeners.length > 0 ? (
        <>
          <SectionTitle>Also listened ({otherListeners.length})</SectionTitle>
          <Notice tone="info">
            Listening from someone who holds no current grant — for example, excused and listening,
            then corrected to present. Kept as history; does not count toward accountability.
          </Notice>
          {otherListeners.map((r) => (
            <ListenerRow key={r.studentUid} row={r} />
          ))}
        </>
      ) : null}
    </Screen>
  );
}

/** A read-only row — present, absent, and other listeners; no accountability. */
function ListenerRow({ row: r }: { row: LedgerRow }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{r.name}</Text>
          <Text style={styles.sub}>
            {Math.round(r.listenedPct * 100)}% listened
            {r.lastListened ? ` · last ${fmtDate(r.lastListened)}` : ' · not started'}
          </Text>
        </View>
        {r.completed ? <Text style={[styles.status, styles.ok]}>Completed</Text> : null}
      </View>
    </View>
  );
}

function LedgerRowCard({
  row: r,
  recordingId,
  today,
  busy,
  onRun,
}: {
  row: RequiredRow;
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
            placeholder="e.g. attended in person"
          />
          <Row>
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
          </Row>
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

function statusLabel(r: RequiredRow, today: string): string {
  if (r.completed) return r.source === 'override' ? 'Complete (override)' : 'Complete';
  if (isOverdue(r.dueDate, today)) return 'Missed';
  return 'Not complete';
}

// Typed as DueBucket, not string: this branched on a removed union member for a
// while and rendered every Missed row amber, which a `string` parameter cannot
// catch and this one would have.
function statusStyle(bucket: DueBucket) {
  if (bucket === 'done') return styles.ok;
  if (bucket === 'missed') return styles.bad;
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
});
