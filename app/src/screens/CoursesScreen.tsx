import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Empty,
  Field,
  Notice,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { createCourse, useCoursesInCohort, type CourseRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/** Admin-only: the courses inside one cohort. */
export function CoursesScreen({
  cohortId,
  cohortName,
  cohortArchived,
  onOpen,
}: {
  cohortId: string;
  cohortName: string;
  cohortArchived: boolean;
  onOpen: (cls: CourseRow) => void;
}) {
  const courses = useCoursesInCohort(cohortId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen subtitle={cohortName}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {cohortArchived ? (
        <Notice tone="info">
          This cohort is archived, so every course in it is inactive regardless of its own
          setting. Reactivating the cohort restores each course to the state it was in.
        </Notice>
      ) : null}

      <SectionTitle>Add a course</SectionTitle>
      <Card>
        <Field
          testID="course-name"
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder="Hikam Foundations"
        />
        <Button
          testID="course-create"
          label="Create course"
          busy={busy}
          disabled={!name.trim()}
          onPress={() =>
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                await createCourse({ cohortId, name: name.trim() });
                setName('');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            })()
          }
        />
      </Card>

      <SectionTitle>Coursees ({courses.length})</SectionTitle>
      {courses.length === 0 ? (
        <Empty>No courses in this cohort yet.</Empty>
      ) : (
        courses.map((c) => <CourseCard key={c.id} cls={c} onOpen={onOpen} />)
      )}
    </Screen>
  );
}

export function CourseCard({ cls, onOpen }: { cls: CourseRow; onOpen: (c: CourseRow) => void }) {
  return (
    <Card>
      <Pressable
        testID={`course-open-${cls.name}`}
        accessibilityRole="button"
        accessibilityLabel={`Open ${cls.name}`}
        onPress={() => onOpen(cls)}
      >
        <Text style={styles.name}>{cls.name}</Text>
        <View style={styles.meta}>
          <StatusChip status={cls.effectiveActive ? 'active' : 'inactive'} />
          {!cls.effectiveActive && cls.archivedAccess ? (
            <Text style={styles.hint}>listening still allowed</Text>
          ) : null}
          <Text style={styles.hint}>
            {cls.managerUids.length === 1
              ? '1 manager'
              : `${cls.managerUids.length} managers`}
          </Text>
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing(3),
    marginTop: spacing(2),
  },
  hint: { fontSize: 13, color: t.text.secondary },
});
