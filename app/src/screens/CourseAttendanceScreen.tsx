import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { INSTITUTE_TIMEZONE, todayInZone } from '@sabeel/shared';
import { Button, Card, Empty, Notice, Screen } from '../components/ui';
import { useCourseAttendance } from '../ledger';
import { exportCsv } from '../exportCsv';
import { useListenerError } from '../liveQuery';
import { useStudents } from '../students';
import type { CourseRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

type Tab = 'sessions' | 'students';

/**
 * A course's attendance report: sessions rolled up (who was there) and students
 * rolled up (who keeps missing, and whether they've caught up). Staff-scoped —
 * the underlying reads are the same course-scoped session/roster/assignment
 * queries the rules already allow.
 */
export function CourseAttendanceScreen({
  cls,
  onOpenCourse,
  onOpenSession,
  onOpenStudent,
}: {
  cls: CourseRow;
  onOpenCourse: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenStudent: (studentUid: string) => void;
}) {
  const listenerError = useListenerError();
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const report = useCourseAttendance(cls.id, today);
  const students = useStudents(true);
  const [tab, setTab] = useState<Tab>('sessions');
  const nameOf = useMemo(() => {
    const m = new Map(students.map((s) => [s.uid, s.displayName]));
    return (uid: string) => m.get(uid) ?? uid;
  }, [students]);

  // Chronic-first: most absences (absent + excused) at the top.
  const studentRows = useMemo(
    () =>
      [...report.students].sort(
        (a, b) =>
          b.absent + b.excused - (a.absent + a.excused) ||
          nameOf(a.studentUid).localeCompare(nameOf(b.studentUid)),
      ),
    [report.students, nameOf],
  );

  const exportSessions = () => {
    const header = ['Date', 'Title', 'Attendance taken', 'Present', 'Absent', 'Excused'];
    const body = report.sessions.map((s) => [
      s.date,
      s.title,
      s.submitted ? 'yes' : 'no',
      s.submitted ? `${s.present}` : '',
      s.submitted ? `${s.absent}` : '',
      s.submitted ? `${s.excused}` : '',
    ]);
    void exportCsv(`${cls.name} - attendance by session.csv`, [header, ...body]);
  };

  const exportStudents = () => {
    const header = ['Student', 'Present', 'Absent', 'Excused', 'Not marked', 'Catch-up assigned', 'Completed', 'Missed'];
    const body = studentRows.map((s) => [
      nameOf(s.studentUid),
      `${s.present}`,
      `${s.absent}`,
      `${s.excused}`,
      `${s.notMarked}`,
      `${s.assigned}`,
      `${s.completed}`,
      `${s.missed}`,
    ]);
    void exportCsv(`${cls.name} - attendance by student.csv`, [header, ...body]);
  };

  return (
    <Screen
      title="Attendance"
      parent={{ label: cls.name, testID: 'up-to-course-from-attendance', onPress: onOpenCourse }}
      subtitle={`${report.sessionsWithAttendance} of ${report.totalSessions} sessions taken`}
    >
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}

      <View style={styles.toggleRow}>
        <View style={styles.toggle}>
          {(['sessions', 'students'] as Tab[]).map((k) => (
            <Pressable
              key={k}
              testID={`attendance-tab-${k}`}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === k }}
              onPress={() => setTab(k)}
              style={[styles.tabBtn, tab === k ? styles.tabOn : null]}
            >
              <Text style={[styles.tabText, tab === k ? styles.tabTextOn : null]}>
                {k === 'sessions' ? `By session (${report.sessions.length})` : `By student (${studentRows.length})`}
              </Text>
            </Pressable>
          ))}
        </View>
        <Button
          testID={tab === 'sessions' ? 'attendance-export-sessions' : 'attendance-export-students'}
          label="Export CSV"
          variant="secondary"
          disabled={tab === 'sessions' ? report.sessions.length === 0 : studentRows.length === 0}
          onPress={tab === 'sessions' ? exportSessions : exportStudents}
        />
      </View>

      {tab === 'sessions' ? (
        report.sessions.length === 0 ? (
          <Empty>No sessions in this course yet.</Empty>
        ) : (
          report.sessions.map((s) => (
            <Card key={s.sessionId}>
              <Pressable
                testID={`attendance-session-${s.title}`}
                accessibilityRole="button"
                accessibilityLabel={`Open ${s.title}`}
                onPress={() => onOpenSession(s.sessionId)}
              >
                <Text style={styles.name}>{s.title}</Text>
                <Text style={styles.hint}>{s.date}</Text>
                {s.submitted ? (
                  <Text style={styles.counts}>
                    <Text style={styles.present}>{s.present} present</Text>
                    {'   '}
                    <Text style={styles.absent}>{s.absent} absent</Text>
                    {'   '}
                    <Text style={styles.excused}>{s.excused} excused</Text>
                  </Text>
                ) : (
                  <Text style={styles.notTaken}>Attendance not taken</Text>
                )}
              </Pressable>
            </Card>
          ))
        )
      ) : studentRows.length === 0 ? (
        <Empty>Nobody is enrolled in this course yet.</Empty>
      ) : (
        studentRows.map((s) => (
          <Card key={s.studentUid}>
            <Pressable
              testID={`attendance-student-${nameOf(s.studentUid)}`}
              accessibilityRole="button"
              accessibilityLabel={`Open listening progress for ${nameOf(s.studentUid)}`}
              onPress={() => onOpenStudent(s.studentUid)}
            >
              <Text style={styles.name}>{nameOf(s.studentUid)}</Text>
              <Text style={styles.counts}>
                <Text style={styles.present}>{s.present} present</Text>
                {'   '}
                <Text style={styles.absent}>{s.absent} absent</Text>
                {'   '}
                <Text style={styles.excused}>{s.excused} excused</Text>
                {s.notMarked > 0 ? <Text style={styles.hint}>{`   ${s.notMarked} not marked`}</Text> : null}
              </Text>
              {s.assigned > 0 ? (
                <Text style={styles.catchup}>
                  Catch-up: {s.completed}/{s.assigned} complete
                  {s.missed > 0 ? <Text style={styles.missed}>{`  ·  ${s.missed} missed`}</Text> : null}
                </Text>
              ) : (
                <Text style={styles.hint}>Catch-up: nothing required</Text>
              )}
            </Pressable>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(2),
    marginBottom: spacing(4),
    flexWrap: 'wrap',
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: t.bg.inset,
    borderRadius: 999,
    padding: 3,
  },
  tabBtn: { paddingVertical: spacing(2), paddingHorizontal: spacing(3), borderRadius: 999 },
  tabOn: { backgroundColor: t.accent.base },
  tabText: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  tabTextOn: { color: t.accent.onAccent },
  name: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  hint: { fontSize: 13, color: t.text.secondary },
  counts: { fontSize: 14, color: t.text.secondary, marginTop: spacing(1) },
  present: { color: t.feedback.success, fontWeight: '600' },
  absent: { color: t.text.primary, fontWeight: '600' },
  excused: { color: t.accent.goldText, fontWeight: '600' },
  notTaken: { fontSize: 14, color: t.text.secondary, fontStyle: 'italic', marginTop: spacing(1) },
  catchup: { fontSize: 14, color: t.text.secondary, marginTop: spacing(2) },
  missed: { color: t.feedback.danger, fontWeight: '700' },
});
