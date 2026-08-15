import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Empty, Notice, Screen } from '../components/ui';
import { useListenerError } from '../liveQuery';
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
    <Screen title="Your classes" subtitle="Your attendance and required listening, class by class">
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {courseIds.length === 0 ? (
        <Empty>You are not enrolled in any classes yet.</Empty>
      ) : (
        courseIds.map((courseId) => (
          <CourseCard key={courseId} courseId={courseId} onOpen={onOpen} />
        ))
      )}
    </Screen>
  );
}

function CourseCard({
  courseId,
  onOpen,
}: {
  courseId: string;
  onOpen: (courseId: string) => void;
}) {
  const cls = useCourse(courseId);
  if (!cls) return null;
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
