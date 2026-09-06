import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ZoomImportRow } from '@sabeel/shared';
import { Button, Card, Empty, Field, Notice, Screen } from '../components/ui';
import { DateField } from '../components/DateField';
import { listZoomRecordings, importZoomRecording } from '../zoom';
import type { SessionRow } from '../sessions';
import { getTheme, spacing } from '../theme';

const t = getTheme();

const ymd = (d: Date) => d.toISOString().slice(0, 10);
function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 60);
  return ymd(d);
}

type StatusFilter = 'available' | 'imported' | 'all';

/**
 * The Zoom import picker, scoped to ONE session.
 *
 * Lists the central account's audio-only recordings for a date range; importing
 * one downloads it as this session's draft recording (the session already owns
 * the title/date/due). A session holds a single recording, so after a successful
 * import we return to it.
 */
export function ZoomImportScreen({
  session,
  cls,
  onImported,
}: {
  session: SessionRow;
  cls: { id: string; name: string };
  onImported: () => void;
}) {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(ymd(new Date()));
  const [rows, setRows] = useState<ZoomImportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('available');
  const [hideShort, setHideShort] = useState(true);

  // Takes the range as an argument rather than closing over `from`/`to`, so it
  // has no dependencies and cannot serve a stale range.
  const load = useCallback(async (range: { from: string; to: string }) => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listZoomRecordings(range));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Arrive with the default range already fetched; after that the Load button
  // applies whatever the user picked. `load` is stable, so this runs once — and
  // it must: every call is a Zoom API request, and the date fields change on
  // each keystroke.
  useEffect(() => {
    void load({ from: defaultFrom(), to: ymd(new Date()) });
  }, [load]);

  const filtered = (rows ?? []).filter(
    (r) =>
      (status === 'all' || (status === 'imported' ? r.alreadyImported : !r.alreadyImported)) &&
      (!search.trim() || r.topic.toLowerCase().includes(search.trim().toLowerCase())) &&
      (!hideShort || r.durationSec >= 120),
  );

  return (
    <Screen subtitle={`${session.title} · ${cls.name}`}>
      <Card>
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <Button
          testID="zoom-load"
          label="Load recordings"
          busy={loading}
          onPress={() => void load({ from, to })}
        />
      </Card>

      <Field label="Search by title" value={search} onChangeText={setSearch} placeholder="topic…" />
      <View style={styles.chips}>
        {(['available', 'imported', 'all'] as StatusFilter[]).map((s) => (
          <Pressable
            key={s}
            testID={`zoom-filter-${s}`}
            onPress={() => setStatus(s)}
            style={[styles.chip, status === s ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, status === s ? styles.chipTextOn : null]}>{s}</Text>
          </Pressable>
        ))}
      </View>

      {/* ITS OWN ROW, AND ITS OWN SHAPE. This is an independent toggle, not a
          fourth member of the one-of-three filter above it — drawn as the same
          raspberry pill, "available" and "hide <2 min" read as two selections
          in one group. A tick and a square say "on/off"; a filled pill says
          "chosen". */}
      <Pressable
        testID="zoom-hide-short"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: hideShort }}
        accessibilityLabel="Hide recordings under two minutes"
        onPress={() => setHideShort((v) => !v)}
        style={styles.toggle}
      >
        <View style={[styles.box, hideShort ? styles.boxOn : null]}>
          {hideShort ? <Text style={styles.tick}>✓</Text> : null}
        </View>
        <Text style={styles.toggleText}>Hide recordings under 2 minutes</Text>
      </Pressable>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading && rows === null ? (
        <Empty>Loading recordings…</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No recordings match. Widen the date range or the filters, then Load.</Empty>
      ) : (
        filtered.map((r) => (
          <ZoomRow key={r.meetingUuid} row={r} sessionId={session.id} onImported={onImported} />
        ))
      )}
    </Screen>
  );
}

function ZoomRow({
  row,
  sessionId,
  onImported,
}: {
  row: ZoomImportRow;
  sessionId: string;
  onImported: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doImport = () =>
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await importZoomRecording({ meetingUuid: row.meetingUuid, fileId: row.fileId, sessionId });
        onImported();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();

  return (
    <Card>
      <Text style={styles.title}>{row.topic.trim() || 'Zoom recording'}</Text>
      <Text style={styles.sub}>
        {row.startTime.slice(0, 10)} · {Math.round(row.durationSec / 60)} min ·{' '}
        {(row.sizeBytes / 1048576).toFixed(1)} MB
      </Text>
      {row.alreadyImported ? (
        <Text style={styles.imported}>
          ✓ Already imported{row.importedCourseName ? ` into ${row.importedCourseName}` : ''}
        </Text>
      ) : (
        <Button
          testID={`zoom-import-${row.topic.trim() || row.meetingUuid}`}
          label="Import into this session"
          busy={busy}
          onPress={doImport}
        />
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2), marginBottom: spacing(2) },
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
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    minHeight: 44,
    marginTop: spacing(2),
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: t.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  tick: { fontSize: 14, fontWeight: '700', color: t.accent.onAccent, lineHeight: 16 },
  toggleText: { fontSize: 14, color: t.text.primary },
  chipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  chipText: { fontSize: 12, fontWeight: '600', color: t.text.secondary },
  chipTextOn: { color: t.accent.onAccent },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  sub: { fontSize: 13, color: t.text.secondary, marginTop: 2, marginBottom: spacing(2) },
  imported: { fontSize: 14, color: t.feedback.success, fontWeight: '600', marginTop: spacing(2) },
});
