import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { INSTITUTE_TIMEZONE, todayInZone } from '@sabeel/shared';
import { useCohorts, useCoursesInCohort, useMyCourses, type CourseRow } from '../structure';
import { useCourseSessions } from '../sessions';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/** Where the navigator currently is, so the tree can show it as selected. */
export interface WorkbenchTarget {
  cohortId?: string;
  courseId?: string;
  sessionId?: string;
}

/**
 * The persistent navigator column — Design C's whole idea.
 *
 * A stack is the right model on a phone, where there is only ever room for one
 * thing. On a 1500px screen it is a cost with no benefit: an admin adding six
 * sessions to a course goes course → sessions → session → back → back → forward
 * six times, and every one of those steps throws away the context they are
 * working in. The structure is a tree — cohort, course, session — and on a wide
 * screen there is room to simply SHOW it.
 *
 * This is the standard shape for tools people work in for an hour at a time
 * (a file explorer, a mail app's folder list), and the reason it is standard is
 * that it makes lateral moves free: the next session is one click from the last
 * one, not four.
 *
 * It is deliberately WIDE-ONLY. There is no phone version of this and it should
 * not be given one — a tree on a 320px screen is a list with indentation, which
 * is worse than the drill-down it replaced.
 *
 * A MANAGER GETS A FLAT COURSE LIST, not a cohort tree. The rules give them no
 * unconstrained cohort or course query — their scope is course-by-course — so
 * the top level of their tree would be a list of one thing. Showing them the
 * courses directly is both what the rules permit and what their day looks like.
 */
export function Workbench({
  uid,
  isAdmin,
  target,
  onOpenCohort,
  onOpenCourse,
  onOpenSession,
}: {
  uid: string;
  isAdmin: boolean;
  target: WorkbenchTarget;
  onOpenCohort: (cohortId: string) => void;
  onOpenCourse: (courseId: string) => void;
  onOpenSession: (sessionId: string, courseId: string) => void;
}) {
  const cohorts = useCohorts(isAdmin);
  const myCourses = useMyCourses(isAdmin ? null : uid);
  // Opening a branch is local state, seeded from wherever the app already is —
  // arriving at a session by URL must reveal it in the tree rather than leaving
  // the reader to find it.
  const [openCohort, setOpenCohort] = useState<string | null>(target.cohortId ?? null);
  const [openCourse, setOpenCourse] = useState<string | null>(target.courseId ?? null);
  useEffect(() => {
    if (target.cohortId) setOpenCohort(target.cohortId);
    if (target.courseId) setOpenCourse(target.courseId);
  }, [target.cohortId, target.courseId]);

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>{isAdmin ? 'Cohorts' : 'Your courses'}</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {isAdmin
          ? cohorts.map((c) => (
              <View key={c.id}>
                <TreeRow
                  testID={`wb-cohort-${c.id}`}
                  label={c.name}
                  depth={0}
                  icon={openCohort === c.id ? 'expand-more' : 'chevron-right'}
                  selected={target.cohortId === c.id && !target.courseId}
                  onPress={() => {
                    setOpenCohort(openCohort === c.id ? null : c.id);
                    onOpenCohort(c.id);
                  }}
                />
                {openCohort === c.id ? (
                  <CohortCourses
                    cohortId={c.id}
                    target={target}
                    openCourse={openCourse}
                    onToggle={(id) => {
                      setOpenCourse(openCourse === id ? null : id);
                      onOpenCourse(id);
                    }}
                    onOpenSession={onOpenSession}
                  />
                ) : null}
              </View>
            ))
          : myCourses.map((c) => (
              <CourseBranch
                key={c.id}
                course={c}
                depth={0}
                target={target}
                open={openCourse === c.id}
                onToggle={() => {
                  setOpenCourse(openCourse === c.id ? null : c.id);
                  onOpenCourse(c.id);
                }}
                onOpenSession={onOpenSession}
              />
            ))}
        {isAdmin && cohorts.length === 0 ? <Text style={styles.empty}>No cohorts yet.</Text> : null}
        {!isAdmin && myCourses.length === 0 ? (
          <Text style={styles.empty}>You are not assigned to any courses yet.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function CohortCourses({
  cohortId,
  target,
  openCourse,
  onToggle,
  onOpenSession,
}: {
  cohortId: string;
  target: WorkbenchTarget;
  openCourse: string | null;
  onToggle: (courseId: string) => void;
  onOpenSession: (sessionId: string, courseId: string) => void;
}) {
  const courses = useCoursesInCohort(cohortId);
  if (courses.length === 0) return <Text style={[styles.empty, styles.indent1]}>No courses</Text>;
  return (
    <>
      {courses.map((c) => (
        <CourseBranch
          key={c.id}
          course={c}
          depth={1}
          target={target}
          open={openCourse === c.id}
          onToggle={() => onToggle(c.id)}
          onOpenSession={onOpenSession}
        />
      ))}
    </>
  );
}

function CourseBranch({
  course,
  depth,
  target,
  open,
  onToggle,
  onOpenSession,
}: {
  course: CourseRow;
  depth: number;
  target: WorkbenchTarget;
  open: boolean;
  onToggle: () => void;
  onOpenSession: (sessionId: string, courseId: string) => void;
}) {
  return (
    <View>
      <TreeRow
        testID={`wb-course-${course.id}`}
        label={course.name}
        depth={depth}
        icon={open ? 'expand-more' : 'chevron-right'}
        selected={target.courseId === course.id && !target.sessionId}
        onPress={onToggle}
      />
      {open ? <CourseSessions courseId={course.id} depth={depth + 1} target={target} onOpenSession={onOpenSession} /> : null}
    </View>
  );
}

function CourseSessions({
  courseId,
  depth,
  target,
  onOpenSession,
}: {
  courseId: string;
  depth: number;
  target: WorkbenchTarget;
  onOpenSession: (sessionId: string, courseId: string) => void;
}) {
  const sessions = useCourseSessions(courseId);
  const today = todayInZone(INSTITUTE_TIMEZONE);
  if (sessions.length === 0) return <Text style={[styles.empty, styles.indent2]}>No sessions</Text>;
  return (
    <>
      {sessions.map((s) => (
        <TreeRow
          key={s.id}
          testID={`wb-session-${s.id}`}
          label={s.title}
          note={s.date}
          depth={depth}
          // A dot, not a word: the tree is a navigator, and the one thing worth
          // saying at a glance is which sessions still owe attendance.
          flag={s.attendanceSubmittedAt === null && s.date <= today}
          selected={target.sessionId === s.id}
          onPress={() => onOpenSession(s.id, courseId)}
        />
      ))}
    </>
  );
}

function TreeRow({
  label,
  note,
  depth,
  icon,
  selected,
  flag,
  testID,
  onPress,
}: {
  label: string;
  note?: string;
  depth: number;
  icon?: 'expand-more' | 'chevron-right';
  selected?: boolean;
  flag?: boolean;
  testID?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { paddingLeft: spacing(2) + depth * spacing(4) },
        selected ? styles.rowSelected : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      {icon ? (
        <MaterialIcons name={icon} size={18} color={t.text.muted} />
      ) : (
        <View style={styles.iconGap} />
      )}
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, selected ? styles.rowLabelSelected : null]} numberOfLines={1}>
          {label}
        </Text>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
      {flag ? <View style={styles.flag} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 288,
    backgroundColor: t.bg.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: t.border.strong,
    paddingTop: spacing(5),
  },
  heading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
    paddingHorizontal: spacing(4),
    marginBottom: spacing(2),
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing(6), paddingHorizontal: spacing(2) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(1),
    minHeight: 36,
    paddingRight: spacing(2),
    paddingVertical: spacing(1),
    borderRadius: 6,
  },
  rowSelected: { backgroundColor: t.bg.accentSoft },
  rowPressed: { backgroundColor: t.bg.inset },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, color: t.text.primary },
  rowLabelSelected: { fontWeight: '700', color: t.text.accent },
  rowNote: { fontSize: 11, color: t.text.muted },
  iconGap: { width: 18 },
  flag: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.feedback.danger },
  empty: { fontSize: 13, color: t.text.muted, paddingVertical: spacing(2), paddingHorizontal: spacing(2) },
  indent1: { paddingLeft: spacing(6) },
  indent2: { paddingLeft: spacing(10) },
});
