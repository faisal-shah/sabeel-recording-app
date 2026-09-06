import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { INSTITUTE_TIMEZONE, todayInZone } from '@sabeel/shared';
import { Button, Card, Empty, Grid, Notice, Screen, Segmented } from '../components/ui';
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
    const header = ['Student', 'Present', 'Absent', 'Excused', 'Not marked', 'Required listening', 'Completed', 'Missed'];
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
      parent={{ label: cls.name, testID: 'up-to-course-from-attendance', onPress: onOpenCourse }}
      subtitle={`${report.sessionsWithAttendance} of ${report.totalSessions} sessions taken`}
      width="list"
    >
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}

      <View style={styles.toggleRow}>
        {/* The shared control, not a local twin. This one predates `Segmented`
            and had drifted from it — `accessibilityRole="button"` where the
            shared one says `"tab"`, and its own colours. Same job, same widget. */}
        <Segmented
          value={tab}
          testIdPrefix="attendance-tab"
          options={[
            { value: 'sessions' as Tab, label: `By session (${report.sessions.length})` },
            { value: 'students' as Tab, label: `By student (${studentRows.length})` },
          ]}
          onChange={setTab}
        />
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
          <Grid min={330}>
          {report.sessions.map((s) => (
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
                    <Text style={styles.countValue}>{s.present}</Text> present
                    {'   '}
                    <Text style={styles.countValue}>{s.absent}</Text> absent
                    {'   '}
                    <Text style={styles.countValue}>{s.excused}</Text> excused
                  </Text>
                ) : (
                  <Text style={styles.notTaken}>Attendance not taken</Text>
                )}
              </Pressable>
            </Card>
          ))}
          </Grid>
        )
      ) : studentRows.length === 0 ? (
        <Empty>Nobody is enrolled in this course yet.</Empty>
      ) : (
        <Grid min={330}>
        {studentRows.map((s) => (
          <Card key={s.studentUid}>
            <Pressable
              testID={`attendance-student-${nameOf(s.studentUid)}`}
              accessibilityRole="button"
              accessibilityLabel={`Open listening progress for ${nameOf(s.studentUid)}`}
              onPress={() => onOpenStudent(s.studentUid)}
            >
              <Text style={styles.name}>{nameOf(s.studentUid)}</Text>
              <Text style={styles.counts}>
                <Text style={styles.countValue}>{s.present}</Text> present
                {'   '}
                <Text style={styles.countValue}>{s.absent}</Text> absent
                {'   '}
                <Text style={styles.countValue}>{s.excused}</Text> excused
                {s.notMarked > 0 ? <Text style={styles.hint}>{`   ${s.notMarked} not marked`}</Text> : null}
              </Text>
              {s.assigned > 0 ? (
                <Text style={styles.catchup}>
                  Required listening: {s.completed} of {s.assigned} completed
                  {s.missed > 0 ? <Text style={styles.missed}>{`  ·  ${s.missed} missed`}</Text> : null}
                </Text>
              ) : (
                <Text style={styles.hint}>No required listening</Text>
              )}
            </Pressable>
          </Card>
        ))}
        </Grid>
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
  name: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  hint: { fontSize: 13, color: t.text.secondary },
  counts: { fontSize: 14, color: t.text.secondary, marginTop: spacing(1) },
  /*
   * ONE WEIGHT, NO TONE. A breakdown is three facts, not three verdicts, and
   * binding the colour to the WORD made the number lie: "0 present" came out
   * green because "present" is good, and "11 excused" came out in the attention
   * colour on every healthy session — excused is the normal, intended state
   * that opens a recording and is the whole of a student's entitlement.
   */
  countValue: { color: t.text.primary, fontWeight: '700' },
  notTaken: { fontSize: 14, color: t.text.secondary, fontStyle: 'italic', marginTop: spacing(1) },
  catchup: { fontSize: 14, color: t.text.secondary, marginTop: spacing(2) },
  missed: { color: t.feedback.danger, fontWeight: '700' },
});
