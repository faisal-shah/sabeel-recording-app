import { useState } from 'react';
import {
  AddAction,
  Button,
  Collapsible,
  Empty,
  Field,
  Grid,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  useAddAction,
} from '../components/ui';
import { createCohort, useAllCourses, useCohorts, type CohortRow } from '../structure';
import { courseLabel } from './CoursesScreen';
import { errorText } from '../errors';

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

  return (
    <Screen
      /* NAMED FOR THE TAB THAT LEADS HERE. It is a list of cohorts, but the way
         in is called Courses, and a destination whose heading contradicts the
         control that opened it reads as a wrong turn. The subtitle carries what
         a cohort is. */
      title="Courses"
      subtitle="By cohort — a semester, and the courses inside it"
      width="list"
      actions={
        <AddAction testID="cohorts-add" label="Add a cohort" title="Add a cohort">
          <AddCohort />
        </AddAction>
      }
    >
      <SectionTitle>Cohorts ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <Empty>No cohorts yet.</Empty>
      ) : (
        <Grid min={320}>
          {active.map((c) => (
            <CohortRowItem key={c.id} cohort={c} count={courseCounts[c.id] ?? 0} onOpen={onOpen} />
          ))}
        </Grid>
      )}

      {archived.length > 0 ? (
        <Collapsible testID="cohorts-archived" title="Archived" count={archived.length}>
          <Grid min={320}>
            {archived.map((c) => (
              <CohortRowItem key={c.id} cohort={c} count={courseCounts[c.id] ?? 0} onOpen={onOpen} />
            ))}
          </Grid>
        </Collapsible>
      ) : null}
    </Screen>
  );
}

/** The create form, in the sheet the header action opens. */
function AddCohort() {
  const close = useAddAction();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Field
        testID="cohort-name"
        label="Name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="Autumn 2026"
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button
        testID="cohort-create"
        label="Create cohort"
        busy={busy}
        disabled={!name.trim()}
        block
        onPress={() => {
          setBusy(true);
          setError(null);
          void createCohort({ name: name.trim() })
            .then(() => {
              setName('');
              close();
            })
            .catch((e) => setError(errorText(e)))
            .finally(() => setBusy(false));
        }}
      />
    </>
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
    // No status chip: which section a cohort is in already says whether it is
    // archived, and repeating it on every row is the clutter this screen was
    // reorganised to remove.
    <ListRow
      testID={`cohort-open-${cohort.name}`}
      name={cohort.name}
      detail={courseLabel(count)}
      onPress={() => onOpen(cohort)}
    />
  );
}

