import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Empty, Notice, Screen } from '../components/ui';
import { useListenerError } from '../liveQuery';
import { useMyAttendance } from '../attendance';
import { useCourse, useStudentEnrollments } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * The classes a student is enrolled in — the way in to their attendance record.
 *
 * The query shape is dictated by the rules, not by preference: a student lists
 * their own enrollments (constrained by studentUid) and then reads each course
 * BY ID. There is no student arm for listing courses at all, so a course must be
 * resolved one document listener at a time.
 */
export function StudentCoursesScreen({
  uid,
  onOpen,
}: {
  uid: string;
  onOpen: (courseId: string) => void;
}) {
  const listenerError = useListenerError();
  const enrollments = useStudentEnrollments(uid);
  const courseIds = useMemo(
    () => enrollments.filter((e) => e.active).map((e) => e.courseId),
    [enrollments],
  );

  return (
    <Screen
      // LIST, like every other collection — see `StudentHomeScreen`.
      width="list"
      title="Your classes"
      subtitle="Your attendance and required listening, class by class"
    >
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {courseIds.length === 0 ? (
        <Empty>You are not enrolled in any classes yet.</Empty>
      ) : (
        courseIds.map((courseId) => (
          <CourseCard key={courseId} uid={uid} courseId={courseId} onOpen={onOpen} />
        ))
      )}
    </Screen>
  );
}

function CourseCard({
  uid,
  courseId,
  onOpen,
}: {
  uid: string;
  courseId: string;
  onOpen: (courseId: string) => void;
}) {
  const cls = useCourse(courseId);
  // The card answers the question the screen is for, so most visits need no tap
  // at all: how many meetings am I marked in, and how many did I miss. Read from
  // the student's OWN projected records — a student cannot read a session.
  const marks = useMyAttendance(uid, courseId);
  if (!cls) return null;
  const present = marks.filter((m) => m.status === 'present').length;
  const excused = marks.filter((m) => m.status === 'excused').length;
  const absent = marks.filter((m) => m.status === 'absent').length;
  return (
    <Pressable
      testID={`myclass-${cls.name}`}
      accessibilityRole="button"
      accessibilityLabel={`Open ${cls.name}`}
      onPress={() => onOpen(courseId)}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{cls.name}</Text>
        {marks.length === 0 ? (
          <Text style={styles.sub}>No attendance taken yet</Text>
        ) : (
          <Text style={styles.sub}>
            {present} present · {excused} excused{absent > 0 ? ` · ${absent} absent` : ''}
          </Text>
        )}
        {!cls.effectiveActive ? <Text style={styles.sub}>Finished</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  pressed: { opacity: 0.85 },
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  sub: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
});
