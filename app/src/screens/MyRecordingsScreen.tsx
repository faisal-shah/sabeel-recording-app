import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { collection, doc, query, where } from 'firebase/firestore';
import { COLLECTIONS, type CourseDoc, type RecordingDoc } from '@sabeel/shared';
import { Card, Empty, Notice, Screen, SectionTitle } from '../components/ui';
import { db } from '../firebase';
import { useLiveDoc, useLiveQuery } from '../liveQuery';
import { useMyAssignments } from '../completion';
import { useStudentEnrollments, type CourseRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * A student's courses, and the published recordings in them.
 *
 * The queries here are shaped by the security rules rather than the other way
 * round: a student lists their own enrollments (constrained by studentUid),
 * reads each course BY ID, then lists published recordings per course. Listing
 * courses, or listing recordings unconstrained, is denied — so this shape is
 * not a style choice.
 */
export function MyRecordingsScreen({
  uid,
  onOpen,
}: {
  uid: string;
  onOpen: (recording: RecordingRow, cls: CourseRow) => void;
}) {
  const enrollments = useStudentEnrollments(uid);
  const courseIds = useMemo(
    () => enrollments.filter((e) => e.active).map((e) => e.courseId),
    [enrollments],
  );

  // Which recordings are REQUIRED for this student — everything else in a course
  // is accessible but "not assigned" (brief § Course access & archive).
  const assignments = useMyAssignments(uid);
  const assignedIds = useMemo(
    () => new Set(assignments.map((a) => a.recordingId)),
    [assignments],
  );

  return (
    <Screen subtitle="Your recordings">
      {courseIds.length === 0 ? (
        <Empty>You are not enrolled in any courses yet.</Empty>
      ) : (
        courseIds.map((courseId) => (
          <CourseSection key={courseId} courseId={courseId} assignedIds={assignedIds} onOpen={onOpen} />
        ))
      )}
    </Screen>
  );
}

/**
 * One course by id, live.
 *
 * A DOCUMENT listener, not the list-shaped useCourse in structure.ts: a student
 * is granted `get` on a course they are enrolled in and never `list`, and
 * `where('__name__','==',id)` is a list. The list form fails closed here — empty
 * screen, listener error — which is why the distinction is worth the comment.
 *
 * Live rather than a one-shot get because this screen decides two things from
 * the course: whether to show the archived-listening notice, and which course it
 * hands the player, whose transport is gated on the same flags. Frozen at mount,
 * a student who was browsing when staff archived the course saw no notice and
 * reached a player with working controls, only to be refused at the point of
 * play by getPlaybackUrl (which re-reads the course, so the rule always held —
 * but as a dead end rather than an explanation).
 */
function useCourse(courseId: string): CourseRow | null {
  return useLiveDoc<CourseRow | null>(
    () => doc(db, COLLECTIONS.courses, courseId),
    [courseId],
    {
      label: 'studentCourse',
      map: (snap) => ({ id: snap.id, ...(snap.data() as CourseDoc) }),
      empty: null,
    },
  );
}

function CourseSection({
  courseId,
  assignedIds,
  onOpen,
}: {
  courseId: string;
  assignedIds: Set<string>;
  onOpen: (r: RecordingRow, c: CourseRow) => void;
}) {
  const cls = useCourse(courseId);
  const recordings = useLiveQuery<RecordingRow[]>(
    () =>
      query(
        collection(db, COLLECTIONS.recordings),
        where('courseId', '==', courseId),
        where('status', '==', 'published'),
      ),
    [courseId],
    {
      label: 'studentRecordings',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) })),
      empty: [],
    },
  );

  if (!cls) return null;
  const listeningOff = !cls.effectiveActive && !cls.archivedAccess;

  return (
    <>
      <SectionTitle>{cls.name}</SectionTitle>
      {listeningOff ? (
        <Notice tone="info">
          This course is archived and listening has been turned off. Your history is kept.
        </Notice>
      ) : null}
      {recordings.length === 0 ? (
        <Empty>Nothing published in this course yet.</Empty>
      ) : (
        recordings.map((r) => (
          <Card key={r.id}>
            <Pressable
              testID={`play-${r.title}`}
              accessibilityRole="button"
              accessibilityLabel={`Listen to ${r.title}`}
              onPress={() => onOpen(r, cls)}
            >
              <Text style={styles.title}>{r.title}</Text>
              <View style={styles.meta}>
                <Text style={styles.hint}>
                  {r.durationSec ? `${Math.round(r.durationSec / 60)} min` : 'duration unknown'}
                  {r.date ? ` · ${r.date}` : ''}
                </Text>
                {!assignedIds.has(r.id) ? (
                  <Text style={styles.notRequired}>Not required</Text>
                ) : null}
              </View>
            </Pressable>
          </Card>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(1) },
  hint: { fontSize: 13, color: t.text.secondary },
  notRequired: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: t.text.muted,
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 999,
    paddingHorizontal: spacing(2),
    paddingVertical: 2,
    overflow: 'hidden',
  },
});
