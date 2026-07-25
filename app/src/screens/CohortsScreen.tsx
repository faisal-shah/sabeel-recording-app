import { useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Field,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import {
  createCohort,
  setCohortArchived,
  useAllCourses,
  useCohorts,
  type CohortRow,
} from '../structure';


/**
 * Admin-only: cohorts, and the archive switch that cascades to their courses.
 *
 * Archiving is presented as reversible because it is — the cascade never writes
 * a course's own `archived` flag, so reactivating restores each course to the
 * state it was already in.
 */
export function CohortsScreen({ onOpen }: { onOpen: (cohort: CohortRow) => void }) {
  const cohorts = useCohorts(true);
  // Courses across all cohorts, counted per cohort so each card shows its size
  // without a tap. Admin-only screen, so the all-courses list is readable.
  const courses = useAllCourses(true);
  const courseCounts = courses.reduce<Record<string, number>>((acc, c) => {
    acc[c.cohortId] = (acc[c.cohortId] ?? 0) + 1;
    return acc;
  }, {});
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, id?: string) => {
    if (id) setBusyId(id);
    else setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id) setBusyId(null);
      else setBusy(false);
    }
  };

  return (
    <Screen subtitle="Semesters, and the courses inside them">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Add a cohort</SectionTitle>
      <Card>
        <Field
          testID="cohort-name"
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder="Autumn 2026"
        />
        <Button
          testID="cohort-create"
          label="Create cohort"
          busy={busy}
          disabled={!name.trim()}
          onPress={() =>
            void run(async () => {
              await createCohort({ name: name.trim() });
              setName('');
            })
          }
        />
      </Card>

      <SectionTitle>Cohorts ({cohorts.length})</SectionTitle>
      {cohorts.length === 0 ? (
        <Empty>No cohorts yet.</Empty>
      ) : (
        cohorts.map((c) => (
          <ListRow
            key={c.id}
            testID={`cohort-open-${c.name}`}
            name={c.name}
            status={<StatusChip status={c.archived ? 'archived' : 'active'} />}
            detail={courseLabel(courseCounts[c.id] ?? 0)}
            onPress={() => onOpen(c)}
            actions={
              <Button
                testID={`cohort-archive-${c.name}`}
                label={c.archived ? 'Reactivate' : 'Archive'}
                variant="secondary"
                compact
                busy={busyId === c.id}
                onPress={() =>
                  void run(
                    () => setCohortArchived({ cohortId: c.id, archived: !c.archived }),
                    c.id,
                  )
                }
              />
            }
          />
        ))
      )}
    </Screen>
  );
}

function courseLabel(n: number): string {
  return n === 1 ? '1 course' : `${n} courses`;
}

