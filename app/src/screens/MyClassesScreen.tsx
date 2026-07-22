import { Empty, Notice, Screen, SectionTitle } from '../components/ui';
import { useMyClasses, type ClassRow } from '../structure';
import { ClassCard } from './ClassesScreen';

/**
 * A manager's own classes.
 *
 * This is the query the manager arm of the classes rule exists to serve: it
 * carries `array-contains` on managerUids, which is what Firestore requires
 * before it will run a list whose rule depends on document data.
 */
export function MyClassesScreen({
  uid,
  onOpen,
}: {
  uid: string;
  onOpen: (cls: ClassRow) => void;
}) {
  const classes = useMyClasses(uid);
  return (
    <Screen subtitle="Classes you have been assigned">
      <SectionTitle>My classes ({classes.length})</SectionTitle>
      {classes.length === 0 ? (
        <>
          <Empty>You are not assigned to any classes yet.</Empty>
          <Notice tone="info">
            An administrator assigns classes. Once assigned, you can manage that class&apos;s
            roster here.
          </Notice>
        </>
      ) : (
        classes.map((c) => <ClassCard key={c.id} cls={c} onOpen={onOpen} />)
      )}
    </Screen>
  );
}
