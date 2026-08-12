import { useMemo, useState } from 'react';
import { doc } from 'firebase/firestore';
import { COLLECTIONS, enrollmentId, type EnrollmentDoc } from '@sabeel/shared';
import {
  Button,
  Card,
  Empty,
  ListRow,
  Notice,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { db } from '../firebase';
import { useLiveDoc } from '../liveQuery';
import { resendPasswordSetup, setStudentAccess, useStudent } from '../students';
import {
  useAllCourses,
  useCohortName,
  useMyCourses,
  useStudentEnrollments,
  type CourseRow,
} from '../structure';

/**
 * One student, everything about them in one place: their access, and the courses
 * they are in.
 *
 * WHAT A MANAGER SEES IS DIFFERENT, and deliberately so. There is no query for
 * "this student's courses" that a manager may run: the enrollments rule resolves
 * a course get() per row, so a cross-course studentUid query denies as soon as
 * the student is in a class they do not run. Inverting the loop — start from the
 * courses they manage, then read one enrollment document each — is both the only
 * legal shape AND the right product answer, since a manager is scoped class by
 * class and a partial list that read as complete would be worse than an honest
 * one. The heading says which they are looking at.
 */
export function StudentDetailScreen({
  studentUid,
  isAdmin,
  uid,
  onOpenCourse,
}: {
  studentUid: string;
  isAdmin: boolean;
  /** The signed-in staff member, for the manager's course list. */
  uid: string;
  onOpenCourse: (cls: CourseRow) => void;
}) {
  const student = useStudent(studentUid);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const who = student?.displayName ?? '';
  const disabled = student?.status === 'disabled';

  return (
    <Screen
      title={who}
      subtitle={student?.email}
      status={student ? student.status : undefined}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? <Notice tone="success">{info}</Notice> : null}

      {!student ? (
        <Empty>Loading…</Empty>
      ) : (
        <>
          <SectionTitle>Access</SectionTitle>
          <Card>
            <Button
              testID="student-resend"
              label="Resend password link"
              variant="secondary"
              busy={busy === 'resend'}
              onPress={() =>
                void run('resend', async () => {
                  await resendPasswordSetup(student.email);
                  setInfo(`Password link sent to ${student.email}.`);
                })
              }
            />
            {/* Enable/disable is directory-level — it spans every course — so the
                server keeps it admin-only. A manager sees the state, not a
                control that would only fail. */}
            {isAdmin ? (
              <Button
                testID="student-access"
                // Secondary in BOTH directions, like archiving a course.
                // Disabling is the reversible, recommended action in this
                // product; dressing it as destructive is how people learn to
                // ignore the colour that marks the genuinely irreversible ones.
                label={disabled ? 'Re-enable account' : 'Disable account'}
                variant="secondary"
                busy={busy === 'access'}
                onPress={() =>
                  void run('access', () =>
                    setStudentAccess({
                      uid: studentUid,
                      status: disabled ? 'active' : 'disabled',
                    }),
                  )
                }
              />
            ) : (
              <Empty>
                {disabled
                  ? 'This account is disabled. An admin can re-enable it.'
                  : 'Only an admin can disable an account.'}
              </Empty>
            )}
          </Card>

          {isAdmin ? (
            <AdminCourses studentUid={studentUid} who={who} onOpenCourse={onOpenCourse} />
          ) : (
            <ManagerCourses studentUid={studentUid} uid={uid} who={who} onOpenCourse={onOpenCourse} />
          )}
        </>
      )}
    </Screen>
  );
}

/** Admin: one query for the student's enrollments, joined to the course list. */
function AdminCourses({
  studentUid,
  who,
  onOpenCourse,
}: {
  studentUid: string;
  who: string;
  onOpenCourse: (cls: CourseRow) => void;
}) {
  const enrollments = useStudentEnrollments(studentUid);
  const courses = useAllCourses(true);
  const cohortNameOf = useCohortName();
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const rows = useMemo(
    () =>
      enrollments
        .map((e) => ({ enrollment: e, course: byId.get(e.courseId) }))
        .filter((r): r is { enrollment: typeof r.enrollment; course: CourseRow } => !!r.course),
    [enrollments, byId],
  );

  return (
    <>
      <SectionTitle>Courses ({rows.length})</SectionTitle>
      {rows.length === 0 ? (
        <Empty>Not enrolled in any course yet.</Empty>
      ) : (
        rows.map((r) => (
          <CourseEnrollmentRow
            key={r.enrollment.id}
            course={r.course}
            cohortName={cohortNameOf(r.course.cohortId)}
            active={r.enrollment.active}
            who={who}
            onOpenCourse={onOpenCourse}
          />
        ))
      )}
    </>
  );
}

/**
 * Manager: start from the courses they run and read one enrollment document per
 * course. One subscription per course, held by a child component — the only way
 * to have a variable number of live reads without breaking the rules of hooks.
 */
function ManagerCourses({
  studentUid,
  uid,
  who,
  onOpenCourse,
}: {
  studentUid: string;
  uid: string;
  who: string;
  onOpenCourse: (cls: CourseRow) => void;
}) {
  const courses = useMyCourses(uid);
  const cohortNameOf = useCohortName();

  return (
    <>
      <SectionTitle>Courses you manage</SectionTitle>
      {courses.length === 0 ? (
        <Empty>You are not assigned to any courses.</Empty>
      ) : (
        courses.map((c) => (
          <ManagedCourseRow
            key={c.id}
            course={c}
            cohortName={cohortNameOf(c.cohortId)}
            studentUid={studentUid}
            who={who}
            onOpenCourse={onOpenCourse}
          />
        ))
      )}
    </>
  );
}

/** Renders nothing unless this student is in this manager's course. */
function ManagedCourseRow({
  course,
  cohortName,
  studentUid,
  who,
  onOpenCourse,
}: {
  course: CourseRow;
  cohortName: string;
  studentUid: string;
  who: string;
  onOpenCourse: (cls: CourseRow) => void;
}) {
  // A document read, not `where('__name__','==')`: the latter is a LIST, and the
  // manager arm is affordable per-document but not per-row across courses.
  const enrollment = useLiveDoc<EnrollmentDoc | null>(
    () => doc(db, COLLECTIONS.enrollments, enrollmentId(studentUid, course.id)),
    [studentUid, course.id],
    {
      label: 'studentEnrollment',
      map: (snap) => snap.data() as EnrollmentDoc,
      empty: null,
    },
  );
  if (!enrollment) return null;
  return (
    <CourseEnrollmentRow
      course={course}
      cohortName={cohortName}
      active={enrollment.active}
      who={who}
      onOpenCourse={onOpenCourse}
    />
  );
}

function CourseEnrollmentRow({
  course,
  cohortName,
  active,
  who,
  onOpenCourse,
}: {
  course: CourseRow;
  cohortName: string;
  active: boolean;
  who: string;
  onOpenCourse: (cls: CourseRow) => void;
}) {
  return (
    <ListRow
      testID={`student-course-open-${course.name}`}
      name={course.name}
      // The same course name recurs across cohorts, so the term disambiguates it.
      detail={cohortName || undefined}
      status={<StatusChip status={active ? 'active' : 'inactive'} />}
      openLabel={`Open ${who}'s progress in ${course.name}`}
      onPress={() => onOpenCourse(course)}
    />
  );
}
