import { useState } from 'react';
import {
  Button,
  Card,
  Collapsible,
  Empty,
  Field,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { createCohort, useAllCourses, useCohorts, type CohortRow } from '../structure';
import { courseLabel } from './CoursesScreen';


/**
 * Admin-only: the list of cohorts.
 *
 * No archive control here, matching courses: a cohort's settings live inside the
 * cohort, so the list stays a list. Archived cohorts are kept out of the way in
 * a closed section rather than interleaved — a finished term is history, and at
 * three or four terms it was most of the screen.
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
  const active = cohorts.filter((c) => !c.archived);
  const archived = cohorts.filter((c) => c.archived);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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

      <SectionTitle>Cohorts ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <Empty>No cohorts yet.</Empty>
      ) : (
        active.map((c) => <CohortRowItem key={c.id} cohort={c} count={courseCounts[c.id] ?? 0} onOpen={onOpen} />)
      )}

      {archived.length > 0 ? (
        <Collapsible testID="cohorts-archived" title="Archived" count={archived.length}>
          {archived.map((c) => (
            <CohortRowItem key={c.id} cohort={c} count={courseCounts[c.id] ?? 0} onOpen={onOpen} />
          ))}
        </Collapsible>
      ) : null}
    </Screen>
  );
}

function CohortRowItem({
  cohort,
  count,
  onOpen,
}: {
  cohort: CohortRow;
  count: number;
  onOpen: (cohort: CohortRow) => void;
}) {
  return (
    <ListRow
      testID={`cohort-open-${cohort.name}`}
      name={cohort.name}
      status={<StatusChip status={cohort.archived ? 'archived' : 'active'} />}
      detail={courseLabel(count)}
      onPress={() => onOpen(cohort)}
    />
  );
}


