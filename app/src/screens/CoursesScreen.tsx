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
import {
  createCourse,
  setCohortArchived,
  useCohortState,
  useCoursesInCohort,
  type CourseRow,
} from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/** Shared with the cohort list, which shows the same count per cohort. */
export function courseLabel(n: number): string {
  return n === 1 ? '1 course' : `${n} courses`;
}

/**
 * Admin-only: one cohort — its settings and the courses inside it.
 *
 * This IS the cohort's page, which is why archiving lives here and not on the
 * list, mirroring a course. The cohort is read LIVE rather than taken from the
 * navigation param: this screen now edits the cohort it displays, and a control
 * that renders and computes its next value from a frozen copy never appears to
 * work (see useCohort).
 */
export function CoursesScreen({
  cohortId,
  onOpen,
}: {
  cohortId: string;
  onOpen: (cls: CourseRow) => void;
}) {
  const cohortState = useCohortState(cohortId);
  const cohort = cohortState.value;
  const courses = useCoursesInCohort(cohortId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archived = cohort?.archived ?? false;

  const run = async (key: string, fn: () => Promise<void>) => {
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

  // A URL can name a cohort that does not exist. Say so rather than rendering a
  // settings card and an add-a-course form for nothing — the server would
  // refuse the create anyway ("No such cohort"), but only after the typing.
  if (!cohort) {
    return (
      <Screen>
        <Empty>
          {cohortState.resolved
            ? 'That cohort is not available. It may have been removed.'
            : 'Loading…'}
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen subtitle={cohort.name} status={archived ? 'archived' : 'active'}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {archived ? (
        <Notice tone="info">
          This cohort is archived, so every course in it is inactive regardless of its own
          setting. Reactivating the cohort restores each course to the state it was in.
        </Notice>
      ) : null}

      <SectionTitle>Settings</SectionTitle>
      <Card>
        {/* State the blast radius rather than gating it behind a confirm:
            archiving is the SAFE action in this product, and obstructing the
            safe action is how people learn to click through warnings. */}
        {/* Only on the way IN: the notice above already explains the archived
            state, and saying it twice reads as a stutter. */}
        {archived ? null : (
          <Text style={styles.hint}>
            Archiving also turns off {courseLabel(courses.length)} in this cohort. It is
            reversible.
          </Text>
        )}
        <Button
          testID="cohort-archive"
          label={archived ? 'Reactivate cohort' : 'Archive cohort'}
          variant="secondary"
          busy={busy === 'archive'}
          onPress={() =>
            void run('archive', () => setCohortArchived({ cohortId, archived: !archived }))
          }
        />
      </Card>

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
          busy={busy === 'create'}
          disabled={!name.trim()}
          onPress={() =>
            void run('create', async () => {
              await createCourse({ cohortId, name: name.trim() });
              setName('');
            })
          }
        />
      </Card>

      <SectionTitle>Courses ({courses.length})</SectionTitle>
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
