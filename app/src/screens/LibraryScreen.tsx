import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isVisibleToStudents, type RecordingStatus } from '@sabeel/shared';
import { Button, Card, Empty, Grid, Notice, Row, Screen, SectionTitle, StatusChip } from '../components/ui';
import { useAllRecordings, useCourseRecordings, type RecordingRow } from '../recordings';
import { useAllCourses, useCohortName, useMyCourses, type CourseRow } from '../structure';
import { useListenerError } from '../liveQuery';
import { getTheme, spacing } from '../theme';

const t = getTheme();
type StatusFilter = 'all' | RecordingStatus;
const STATUSES: StatusFilter[] = ['all', 'published', 'draft', 'archived', 'unpublished', 'needsAttention'];

/**
 * The filter words a person reads. `needsAttention` is the FIELD VALUE, and it
 * was being printed raw — one camelCase chip sitting in a row of plain words.
 */
const STATUS_LABEL: Record<StatusFilter, string> = {
  all: 'all',
  published: 'published',
  draft: 'draft',
  archived: 'archived',
  unpublished: 'unpublished',
  needsAttention: 'needs attention',
};

/**
 * The cross-cohort recording library with status counts (deferred from Phase 3).
 * Admin sees a flat list of everything; a manager sees a section per course they
 * run (the rules forbid an unconstrained recordings list to a manager).
 */
export function LibraryScreen({
  uid,
  isAdmin,
  onPlay,
  onOpenProgress,
}: {
  uid: string;
  isAdmin: boolean;
  onPlay: (recording: RecordingRow, cls: CourseRow) => void;
  onOpenProgress: (recording: RecordingRow, cls: CourseRow) => void;
}) {
  const listenerError = useListenerError();
  const [status, setStatus] = useState<StatusFilter>('all');
  const myCourses = useMyCourses(isAdmin ? null : uid);
  // A course name alone is ambiguous across cohorts; this library spans them.
  const cohortNameOf = useCohortName();

  return (
    <Screen
      title="Recording library"
      subtitle={isAdmin ? 'Every recording, across every cohort' : 'Recordings in the courses you run'}
      width="list"
    >
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      <View style={styles.chips}>
        {STATUSES.map((s) => (
          <Pressable
            key={s}
            testID={`library-filter-${s}`}
            // One of a set, so `radio` — and with a role at all, which
            // these chips had never had.
            accessibilityRole="radio"
            aria-checked={status === s}
            accessibilityLabel={STATUS_LABEL[s]}
            onPress={() => setStatus(s)}
            style={[styles.chip, status === s ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, status === s ? styles.chipTextOn : null]}>
              {STATUS_LABEL[s]}
            </Text>
          </Pressable>
        ))}
      </View>

      {isAdmin ? (
        <AdminLibrary
          status={status}
          cohortNameOf={cohortNameOf}
          onPlay={onPlay}
          onOpenProgress={onOpenProgress}
        />
      ) : myCourses.length === 0 ? (
        <Empty>You are not assigned to any courses.</Empty>
      ) : (
        myCourses.map((cls) => (
          <CourseSection
            key={cls.id}
            cls={cls}
            cohortName={cohortNameOf(cls.cohortId)}
            status={status}
            onPlay={onPlay}
            onOpenProgress={onOpenProgress}
          />
        ))
      )}
    </Screen>
  );
}

function AdminLibrary({
  status,
  cohortNameOf,
  onPlay,
  onOpenProgress,
}: {
  status: StatusFilter;
  cohortNameOf: (cohortId: string) => string;
  onPlay: (r: RecordingRow, c: CourseRow) => void;
  onOpenProgress: (r: RecordingRow, c: CourseRow) => void;
}) {
  const all = useAllRecordings(true);
  // Real course rows so the flat list can show which course each recording is in,
  // and the ledger it opens shows the course NAME — not the raw id (which is what
  // a placeholder `{ name: courseId }` row leaked into the ledger subtitle).
  const courses = useAllCourses(true);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const filtered = useMemo(
    () => (status === 'all' ? all : all.filter((r) => r.status === status)),
    [all, status],
  );
  const clsFor = (r: RecordingRow): CourseRow =>
    courseById.get(r.courseId) ??
    // Fallback for a recording whose course was deleted: still openable, and the
    // id at least tells you which course is missing.
    ({ id: r.courseId, name: r.courseId, cohortId: r.cohortId } as CourseRow);
  return (
    <>
      <Counts recordings={all} />
      {filtered.length === 0 ? (
        <Empty>No recordings with that status.</Empty>
      ) : (
        <Grid min={330}>
          {filtered.map((r) => {
            const cls = clsFor(r);
            return (
              <RecordingLine
                key={r.id}
                r={r}
                courseName={cls.name}
                cohortName={cohortNameOf(cls.cohortId)}
                onPlay={() => onPlay(r, cls)}
                onOpenProgress={() => onOpenProgress(r, cls)}
              />
            );
          })}
        </Grid>
      )}
    </>
  );
}

function CourseSection({
  cls,
  cohortName,
  status,
  onPlay,
  onOpenProgress,
}: {
  cls: CourseRow;
  cohortName: string;
  status: StatusFilter;
  onPlay: (r: RecordingRow, c: CourseRow) => void;
  onOpenProgress: (r: RecordingRow, c: CourseRow) => void;
}) {
  const recordings = useCourseRecordings(cls.id);
  const filtered = status === 'all' ? recordings : recordings.filter((r) => r.status === status);
  return (
    <>
      <SectionTitle>{cohortName ? `${cls.name} · ${cohortName}` : cls.name}</SectionTitle>
      <Counts recordings={recordings} />
      {filtered.length === 0 ? (
        <Empty>No recordings with that status.</Empty>
      ) : (
        <Grid min={330}>
          {filtered.map((r) => (
            <RecordingLine
              key={r.id}
              r={r}
              onPlay={() => onPlay(r, cls)}
              onOpenProgress={() => onOpenProgress(r, cls)}
            />
          ))}
        </Grid>
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
      {attention > 0 ? ` · ${attention} ${attention === 1 ? 'needs' : 'need'} attention` : ''}
    </Text>
  );
}

function RecordingLine({
  r,
  courseName,
  cohortName,
  onPlay,
  onOpenProgress,
}: {
  r: RecordingRow;
  courseName?: string;
  cohortName?: string;
  onPlay: () => void;
  onOpenProgress: () => void;
}) {
  return (
    <Card>
      <Text style={styles.title}>{r.title}</Text>
      {/* Admin flat list shows the course AND its cohort — a course name alone is
          ambiguous across cohorts. The manager view groups by course, so it
          passes no courseName. */}
      {courseName ? (
        <Text style={styles.courseName}>
          {cohortName ? `${courseName} · ${cohortName}` : courseName}
        </Text>
      ) : null}
      <View style={styles.meta}>
        <StatusChip status={r.status} />
        <Text style={styles.sub}>
          {r.durationSec ? `${Math.round(r.durationSec / 60)} min` : 'no audio'}
          {r.date ? ` · ${r.date}` : ''}
        </Text>
      </View>
      {/* Pushed to the foot of the card: the cards in a row are the same height,
          and a title that wraps used to drop its own actions below its
          neighbours' — level outlines with a ragged row of buttons inside. NOT
          RENDERED WHEN THERE IS NOTHING IN IT, because the same `marginTop:
          'auto'` made an empty row reserve 76px of blank card under a recording
          with no audio, half the height of the card beside it. */}
      {r.audioPath || r.status === 'published' ? (
        <View style={styles.actions}>
          <Row>
            {/* PRIMARY, and the only one on the card. Two identical sage bars
                six times down a page gave the library no answer to "what do I do
                here", and listening is what the library is for — the ledger
                beside it is the follow-up. */}
            {r.audioPath ? (
              <Button testID={`library-listen-${r.title}`} label="Listen" onPress={onPlay} />
            ) : null}
            {r.status === 'published' ? (
              <Button
                testID={`library-progress-${r.title}`}
                label="Listening progress"
                variant="secondary"
                onPress={onOpenProgress}
              />
            ) : null}
          </Row>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: 'auto' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginBottom: spacing(4) },
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
  chipText: { fontSize: 12, fontWeight: '600', color: t.text.secondary },
  chipTextOn: { color: t.accent.onAccent },
  counts: { fontSize: 13, color: t.text.secondary, marginBottom: spacing(2) },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  courseName: { fontSize: 13, color: t.text.secondary, marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginTop: spacing(2) },
  sub: { fontSize: 13, color: t.text.secondary },
});
