import { Empty, Grid, Notice, Screen, SectionTitle } from '../components/ui';
import { useMyCoursesState, type CourseRow } from '../structure';
import { CourseCard } from './CoursesScreen';

/**
 * A manager's own courses.
 *
 * This is the query the manager arm of the courses rule exists to serve: it
 * carries `array-contains` on managerUids, which is what Firestore requires
 * before it will run a list whose rule depends on document data.
 */
export function MyCoursesScreen({
  uid,
  onOpen,
}: {
  uid: string;
  onOpen: (cls: CourseRow) => void;
}) {
  /*
   * THE `State` VARIANT, so "none have arrived" is not rendered as "there are
   * none". The `?? []` wrapper reads identically on a cold load and on an
   * unassigned account — and this screen answers the second with a heading
   * saying `Courses (0)`, "You are not assigned to any courses yet" and a
   * notice about waiting for an administrator. Shown to a manager whose access
   * was granted an hour ago, for the length of every load, that reads as their
   * access being broken.
   */
  const loaded = useMyCoursesState(uid);
  const courses = loaded ?? [];
  return (
    <Screen title="Your courses" subtitle="Everything you run, and the way in to each" width="list">
      <SectionTitle>Courses{loaded === null ? '' : ` (${courses.length})`}</SectionTitle>
      {loaded === null ? (
        <Empty>Checking your courses…</Empty>
      ) : courses.length === 0 ? (
        <>
          <Empty>You are not assigned to any courses yet.</Empty>
          <Notice tone="info">
            An administrator assigns courses. Once assigned, you can manage that course&apos;s
            roster here.
          </Notice>
        </>
      ) : (
        <Grid min={330}>
          {courses.map((c) => (
            <CourseCard key={c.id} cls={c} onOpen={onOpen} />
          ))}
        </Grid>
      )}
    </Screen>
  );
}
