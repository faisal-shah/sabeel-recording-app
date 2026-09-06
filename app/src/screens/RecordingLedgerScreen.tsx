import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  INSTITUTE_TIMEZONE,
  isOverdue,
  ledgerBucket,
  todayInZone,
  type DueBucket,
} from '@sabeel/shared';
import { Button, Chips, Empty, Field, Grid, Notice, Row, Screen, SectionTitle } from '../components/ui';
import {
  LEDGER_FILTERS,
  overrideCompletion,
  clearCompletionOverride,
  useRecordingLedger,
  type LedgerFilter,
  type LedgerRow,
  type RequiredRow,
} from '../ledger';
import { exportCsv } from '../exportCsv';
import { useCohortName, type CourseRow } from '../structure';
import type { SessionRow } from '../sessions';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';
import { errorText } from '../errors';

const t = getTheme();

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
  const today = todayInZone(INSTITUTE_TIMEZONE);
  // Reached from the cross-cohort library, where the course name alone is ambiguous.
  const cohortName = useCohortName()(cls.cohortId);
  const { loading, accountable, attendees, absentees, lapsed, otherListeners, rollup } = useRecordingLedger(
    recording,
    session,
    today,
  );
  const [filter, setFilter] = useState<LedgerFilter>('notComplete');
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
      setError(errorText(e));
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
      // Not "· listening progress": the header above already says it.
      subtitle={cohortName ? `${cls.name} · ${cohortName}` : cls.name}
      width="list"
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      {/* NOT UNTIL THE GRANTS ARRIVE. `rollup` is derived from `accountable`,
          which is empty while the roster is unknown — so the first thing on the
          page read `Required 0 / Completed 0 / Not complete 0 / Missed 0` for
          the length of every cold load, on the screen staff consult to decide
          who to chase. Four confident zeros are a worse answer than four
          absent tiles. */}
      {loading ? null : (
        <View style={styles.summary}>
          {/* The product's own words — required listening, completed, missed —
              and not a fifth set for this screen. "Accountable" was also the one
              label too long for its tile. */}
          <Stat label="Required" value={rollup.total} />
          {/* THE TONE FOLLOWS THE VALUE, never the label. Bound to the word,
              "0 Completed" came out in the success green — a green zero at the
              top of the accountability screen — while a healthy "0 Missed"
              still had to be told apart from a bad one. */}
          <Stat
            label="Completed"
            value={rollup.complete}
            tone={rollup.complete > 0 ? 'success' : undefined}
          />
          <Stat label="Not complete" value={rollup.incomplete} />
          <Stat
            label="Missed"
            value={rollup.missed}
            tone={rollup.missed > 0 ? 'danger' : undefined}
          />
        </View>
      )}

      <View style={styles.toolbar}>
        <Chips value={filter} testIdPrefix="ledger-filter" options={LEDGER_FILTERS} onChange={setFilter} />
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
          {/* WHAT IT KNOWS, IN ORDER. Until the grants arrive nothing below is
              settled — and every sentence after this one is a conclusion about
              a roster that has not loaded. An empty accountable list is then
              answered before the filter is: with nobody granted the recording
              at all, "everyone has completed this" would be congratulating
              staff on nothing having happened. */}
          {loading
            ? 'Checking who holds this recording…'
            : accountable.length === 0
              ? lapsed.length > 0
                ? 'Nobody holds this recording now — every grant from this session has lapsed. See below.'
                : 'No one was excused from this session, so nobody has been granted this recording.'
              : filter === 'missed'
                ? 'Nobody missed the deadline — nice.'
                : 'Everyone required has completed this — nice.'}
        </Empty>
      ) : (
        <Grid min={330}>
          {rows.map((r) => (
            <LedgerRowCard
              key={r.studentUid}
              row={r}
              recordingId={recording.id}
              today={today}
              busy={busy}
              onRun={run}
            />
          ))}
        </Grid>
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
          <Grid min={300}>
            {attendees.map((r) => (
              <ListenerRow key={r.studentUid} row={r} />
            ))}
          </Grid>
        </>
      )}

      {absentees.length > 0 ? (
        <>
          <SectionTitle>Absent ({absentees.length})</SectionTitle>
          <Notice tone="info">
            Marked absent rather than excused, so the recording was not opened to them. To let
            someone catch up, mark them excused on the session and submit again.
          </Notice>
          <Grid min={300}>
            {absentees.map((r) => (
              <ListenerRow key={r.studentUid} row={r} />
            ))}
          </Grid>
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
          <Grid min={300}>
            {lapsed.map((r) => (
              <ListenerRow key={r.studentUid} row={r} />
            ))}
          </Grid>
        </>
      ) : null}

      {otherListeners.length > 0 ? (
        <>
          <SectionTitle>Also listened ({otherListeners.length})</SectionTitle>
          <Notice tone="info">
            Listening from someone who holds no current grant — for example, excused and listening,
            then corrected to present. Kept as history; does not count toward accountability.
          </Notice>
          <Grid min={300}>
            {otherListeners.map((r) => (
              <ListenerRow key={r.studentUid} row={r} />
            ))}
          </Grid>
        </>
      ) : null}
    </Screen>
  );
}

/**
 * A read-only row — present, absent, and other listeners; no accountability.
 *
 * SILENT WHERE THERE IS NOTHING TO REPORT. The section above these rows says
 * this recording is neither required for them nor open to them, and then every
 * name carried "0% listened · not started" — a shortfall printed against people
 * of whom nothing was asked. Someone who listened anyway is worth showing;
 * someone who did not is simply not in this story.
 */
function ListenerRow({ row: r }: { row: LedgerRow }) {
  const listened = r.listenedPct > 0 || !!r.lastListened;
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{r.name}</Text>
          {listened ? (
            <Text style={styles.sub}>
              {Math.round(r.listenedPct * 100)}% listened
              {r.lastListened ? ` · last ${fmtDate(r.lastListened)}` : ''}
            </Text>
          ) : null}
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
  /*
   * EMPTY EVERY TIME IT OPENS, never prefilled from the existing override.
   *
   * The reason is required because it goes into the audit log as the
   * justification for THIS action. Seeded with the reason that justified the
   * original grant, `disabled={!reason.trim()}` was already satisfied the moment
   * the editor opened, so "Remove override" could be pressed without typing
   * anything — and the log recorded the removal as justified by the sentence
   * that had justified the grant. The existing reason is on the row above
   * either way ("Override: …"), so nothing is lost by asking again.
   *
   * `useState`'s initialiser runs once, so an abandoned draft also survived
   * Cancel and re-armed both buttons on the next open. `close` is what both
   * exits go through.
   */
  const [reason, setReason] = useState('');
  const close = () => {
    setReason('');
    setOpen(false);
  };
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

      {/* NOT pushed to the foot. Grid row-mates are equal height, so pinning the
          actions down there cost far more than it bought: a name wrapping to two
          lines dropped its Override 19px below its neighbours', and the fix
          turned every row containing an OPEN editor into a 245px void inside the
          cards beside it — in the one state a staff member is always in when
          they use this screen. Nineteen ragged pixels is the smaller problem. */}
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
                  close();
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
                  close();
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
                  close();
                })
              }
            />
          ) : null}
          <Button label="Cancel" variant="quiet" onPress={close} />
        </View>
      ) : (
        <View>
          <Button
            testID={`override-open-${r.name}`}
            label={r.source === 'override' ? 'Change override' : 'Override'}
            variant="secondary"
            onPress={() => setOpen(true)}
          />
        </View>
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
  if (r.completed) return r.source === 'override' ? 'Completed (override)' : 'Completed';
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

/**
 * When a student last played the recording, in the institute's timezone.
 *
 * NOT `toLocaleDateString()`. This sits in a row beside a listen-by date that
 * is a civil date in `INSTITUTE_TIMEZONE`, and the two have to be comparable:
 * a play at 23:30 the night before a deadline dated to the morning after it —
 * which is what the reader's own zone does further east — is the ledger giving
 * the wrong answer to the only question it is asked.
 */
function fmtDate(ms: number | null): string {
  if (!ms) return '';
  return todayInZone(INSTITUTE_TIMEZONE, ms);
}

const styles = StyleSheet.create({
  /**
   * WRAPS, because four tiles across a phone cannot hold their own labels.
   * A quarter of a 360dp screen leaves a label about 49dp of inner width, and
   * an 11-character one broke mid-word on a real device — "Accountabl / e".
   * Every layout check passed throughout: nothing overlapped and nothing was
   * clipped, which is all they can see.
   *
   * `minWidth` is what makes the row break, and it is set to break CLEANLY. The
   * label itself only needs about 84 — but at 84 a 390px screen fits three
   * across, orphaning "Missed" on a full-width second row. 112 is the smallest
   * value that takes 320 and 390 to a tidy two-by-two while still seating all
   * four in one row once the content column reaches its 720 cap. Shrinking the
   * type instead would have bought a few characters and cost legibility for an
   * adult-learner audience.
   */
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3), marginBottom: spacing(4) },
  stat: {
    flex: 1,
    minWidth: 112,
    backgroundColor: t.bg.surface,
    borderRadius: 10,
    padding: spacing(3),
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '700', color: t.text.primary },
  statLabel: { fontSize: 11, color: t.text.secondary, marginTop: spacing(1) },
  ok: { color: t.feedback.success },
  bad: { color: t.feedback.danger },
  warn: { color: t.feedback.warning },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    marginBottom: spacing(4),
    flexWrap: 'wrap',
  },
  row: {
    // Fills its grid cell, so a row of these ends level — and so an open
    // override editor stretches its neighbours instead of leaving a hole.
    flexGrow: 1,
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
