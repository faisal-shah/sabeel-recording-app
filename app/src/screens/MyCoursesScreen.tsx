import { Empty, Notice, Screen, SectionTitle } from '../components/ui';
import { useMyCourses, type CourseRow } from '../structure';
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
  const courses = useMyCourses(uid);
  return (
    <Screen subtitle="Coursees you have been assigned">
      <SectionTitle>My courses ({courses.length})</SectionTitle>
      {courses.length === 0 ? (
        <>
          <Empty>You are not assigned to any courses yet.</Empty>
          <Notice tone="info">
            An administrator assigns courses. Once assigned, you can manage that course&apos;s
            roster here.
          </Notice>
        </>
      ) : (
        courses.map((c) => <CourseCard key={c.id} cls={c} onOpen={onOpen} />)
      )}
    </Screen>
  );
}
