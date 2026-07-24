import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ZoomImportRow } from '@sabeel/shared';
import { Button, Card, Empty, Field, Notice, Row, Screen } from '../components/ui';
import { DateField } from '../components/DateField';
import { listZoomRecordings, importZoomRecording } from '../zoom';
import { useAllCourses, useCohorts, useMyCourses, type CourseRow } from '../structure';
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
 * The Zoom import picker (staff). Lists the central account's audio-only
 * recordings for a date range; each available one imports into a course the
 * caller picks inline (admin: any course, manager: their own). Pull, not push —
 * this is the only entry to Zoom import, and the course is chosen here.
 */
export function ZoomImportScreen({
  isAdmin,
  uid,
  onImported,
  onOpenImported,
}: {
  isAdmin: boolean;
  uid: string;
  onImported: (cls: CourseRow) => void;
  onOpenImported: (recordingId: string, courseId: string) => void;
}) {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(ymd(new Date()));
  const [rows, setRows] = useState<ZoomImportRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('available');
  const [hideShort, setHideShort] = useState(true);
  // Loaded once here (not per row): the courses this caller may import into.
  const options = useCourseOptions(isAdmin, uid);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listZoomRecordings({ from, to }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  // Load once on open; changing the dates then requires "Load recordings".
  useEffect(() => {
    void load();
  }, []);

  const filtered = (rows ?? []).filter(
    (r) =>
      (status === 'all' || (status === 'imported' ? r.alreadyImported : !r.alreadyImported)) &&
      (!search.trim() || r.topic.toLowerCase().includes(search.trim().toLowerCase())) &&
      (!hideShort || r.durationSec >= 120),
  );

  return (
    <Screen title="Import from Zoom" subtitle="Zoom recordings">
      <Card>
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <Button testID="zoom-load" label="Load recordings" busy={loading} onPress={() => void load()} />
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
        <Pressable
          testID="zoom-hide-short"
          onPress={() => setHideShort((v) => !v)}
          style={[styles.chip, hideShort ? styles.chipOn : null]}
        >
          <Text style={[styles.chipText, hideShort ? styles.chipTextOn : null]}>hide &lt;2 min</Text>
        </Pressable>
      </View>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading && rows === null ? (
        <Empty>Loading recordings…</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No recordings match. Widen the date range or the filters, then Load.</Empty>
      ) : (
        filtered.map((r) => (
          <ZoomRow
            key={r.meetingUuid}
            row={r}
            options={options}
            onImported={onImported}
            onOpenImported={onOpenImported}
          />
        ))
      )}
    </Screen>
  );
}

/** The courses this staff member may import into, labelled by cohort. */
function useCourseOptions(isAdmin: boolean, uid: string): { cls: CourseRow; cohortName: string }[] {
  const cohorts = useCohorts(true);
  const adminCoursees = useAllCourses(isAdmin);
  const myCoursees = useMyCourses(isAdmin ? null : uid);
  const courses = isAdmin ? adminCoursees : myCoursees;
  const cohortName = (id: string) => cohorts.find((c) => c.id === id)?.name ?? '';
  return useMemo(
    () =>
      courses
        .filter((c) => !c.archived)
        .map((c) => ({ cls: c, cohortName: cohortName(c.cohortId) }))
        .sort((a, b) => a.cohortName.localeCompare(b.cohortName) || a.cls.name.localeCompare(b.cls.name)),
    [courses, cohorts],
  );
}

function ZoomRow({
  row,
  options,
  onImported,
  onOpenImported,
}: {
  row: ZoomImportRow;
  options: { cls: CourseRow; cohortName: string }[];
  onImported: (cls: CourseRow) => void;
  onOpenImported: (recordingId: string, courseId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doImport = async () => {
    const chosen = options.find((o) => o.cls.id === courseId);
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await importZoomRecording({
        meetingUuid: row.meetingUuid,
        fileId: row.fileId,
        courseId: chosen.cls.id,
        dueDate: dueDate.trim() ? dueDate.trim() : null,
      });
      onImported(chosen.cls);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.title}>{row.topic.trim() || 'Zoom recording'}</Text>
      <Text style={styles.sub}>
        {row.startTime.slice(0, 10)} · {Math.round(row.durationSec / 60)} min ·{' '}
        {(row.sizeBytes / 1048576).toFixed(1)} MB
      </Text>

      {row.alreadyImported ? (
        <Pressable
          testID={`zoom-open-imported-${row.topic.trim() || row.meetingUuid}`}
          onPress={() =>
            row.alreadyImported &&
            row.importedCourseId &&
            onOpenImported(row.alreadyImported, row.importedCourseId)
          }
          style={styles.importedRow}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.imported}>
              ✓ Imported{row.importedCourseName ? ` into ${row.importedCourseName}` : ''}
            </Text>
            {row.importedCohortName ? (
              <Text style={styles.importedCohort}>{row.importedCohortName} · tap to listen</Text>
            ) : (
              <Text style={styles.importedCohort}>Tap to listen</Text>
            )}
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ) : expanded ? (
        <View style={styles.picker}>
          <Text style={styles.pickerLabel}>Import into which course?</Text>
          {options.length === 0 ? (
            <Empty>You have no courses to import into.</Empty>
          ) : (
            options.map((o) => {
              const on = courseId === o.cls.id;
              return (
                <Pressable
                  key={o.cls.id}
                  testID={`zoom-course-${o.cls.name}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setCourseId(on ? null : o.cls.id)}
                  style={styles.pickRow}
                >
                  <View style={[styles.tick, on ? styles.tickOn : null]} />
                  <View style={styles.pickTextWrap}>
                    <Text style={styles.pickText}>{o.cls.name}</Text>
                    <Text style={styles.pickCohort}>{o.cohortName}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
          <DateField label="Due date (optional)" value={dueDate} onChange={setDueDate} />
          <Row>
            <Button
              testID={`zoom-import-${row.topic.trim() || row.meetingUuid}`}
              label="Import"
              busy={busy}
              disabled={!courseId}
              onPress={() => void doImport()}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setExpanded(false)} />
          </Row>
        </View>
      ) : (
        <Button
          testID={`zoom-open-${row.topic.trim() || row.meetingUuid}`}
          label="Import"
          variant="secondary"
          onPress={() => setExpanded(true)}
        />
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(2), marginBottom: spacing(2) },
  chip: {
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(3),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border.strong,
  },
  chipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  chipText: { fontSize: 12, fontWeight: '600', color: t.text.secondary },
  chipTextOn: { color: t.accent.onAccent },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  sub: { fontSize: 13, color: t.text.secondary, marginTop: 2 },
  importedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    marginTop: spacing(3),
  },
  imported: { fontSize: 14, color: t.feedback.success, fontWeight: '600' },
  importedCohort: { fontSize: 13, color: t.text.secondary, marginTop: 1 },
  chevron: { fontSize: 24, color: t.text.secondary, fontWeight: '600' },
  picker: { marginTop: spacing(3) },
  pickerLabel: { fontSize: 13, color: t.text.secondary, marginBottom: spacing(1) },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), paddingVertical: spacing(2) },
  pickTextWrap: { flex: 1 },
  pickText: { fontSize: 15, color: t.text.primary },
  pickCohort: { fontSize: 13, color: t.text.secondary, marginTop: 1 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: t.border.strong,
    backgroundColor: t.bg.raised,
  },
  tickOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
});
