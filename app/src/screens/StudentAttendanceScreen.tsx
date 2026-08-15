import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  INSTITUTE_TIMEZONE,
  isOverdue,
  todayInZone,
  type AttendanceStatus,
} from '@sabeel/shared';
import { Card, Empty, Notice, Screen, SectionTitle } from '../components/ui';
import { useListenerError } from '../liveQuery';
import { useMyAttendance } from '../attendance';
import { useMyAssignments, useMyCompletions } from '../completion';
import type { CourseRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  excused: 'Excused',
};

/**
 * One class, as the student's own record: a tally, then every session they were
 * marked in, with their own mark.
 *
 * Deliberately NOT a way to play anything. An excused row says a recording was
 * required and whether it was listened to; the listening itself lives on the
 * home screen, which is the one place a recording is opened. Two routes to the
 * same audio would mean two places to keep the deadline honest.
 *
 * Everything is joined client-side from three self-constrained queries the
 * student is already allowed to make — their attendance marks, their grants, and
 * their completions — so this screen adds no new permission surface.
 */
export function StudentAttendanceScreen({
  uid,
  cls,
}: {
  uid: string;
  cls: CourseRow;
}) {
  const listenerError = useListenerError();
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const marks = useMyAttendance(uid, cls.id);
  const assignments = useMyAssignments(uid);
  const completions = useMyCompletions(uid);

  const bySession = useMemo(
    () => new Map(assignments.map((a) => [a.sessionId, a])),
    [assignments],
  );

  const rows = useMemo(
    () => [...marks].sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)),
    [marks],
  );

  const tally = useMemo(() => {
    const t0 = { present: 0, absent: 0, excused: 0 };
    for (const m of marks) t0[m.status]++;
    return t0;
  }, [marks]);

  return (
    <Screen title={cls.name} subtitle="Your attendance">
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}

      <Card>
        <View style={styles.tally}>
          <Tally label="Present" value={tally.present} />
          <Tally label="Absent" value={tally.absent} />
          <Tally label="Excused" value={tally.excused} />
        </View>
      </Card>

      <SectionTitle>Sessions ({rows.length})</SectionTitle>
      {rows.length === 0 ? (
        <Empty>No attendance has been taken for this class yet.</Empty>
      ) : (
        rows.map((m) => {
          const a = bySession.get(m.sessionId);
          return (
            <View key={m.id} testID={`attendance-${m.title}`} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.title}>{m.title}</Text>
                <Text style={styles.date}>{m.date}</Text>
                {a ? (
                  <Text style={styles.listening}>
                    {listeningLine(
                      completions.get(a.recordingId)?.completed ?? false,
                      a.dueDate,
                      today,
                    )}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.status, styles[m.status]]}>{STATUS_LABEL[m.status]}</Text>
            </View>
          );
        })
      )}
    </Screen>
  );
}

/**
 * What the student owes on an excused session, in one line.
 *
 * Completion is checked before the deadline: someone who listened in time and
 * marked it complete has done what was asked, and telling them afterwards that
 * they "missed" it would be both wrong and the punitive tone the brief rules out.
 */
function listeningLine(completed: boolean, dueDate: string, today: string): string {
  if (completed) return 'Recording required · completed';
  if (isOverdue(dueDate, today)) return `Recording required · not listened, closed ${dueDate}`;
  return `Recording required · listen by ${dueDate}`;
}

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.tallyItem}>
      <Text style={styles.tallyNum}>{value}</Text>
      <Text style={styles.tallyLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tally: { flexDirection: 'row', justifyContent: 'space-around' },
  tallyItem: { alignItems: 'center' },
  tallyNum: { fontSize: 24, fontWeight: '700', color: t.text.primary },
  tallyLabel: {
    fontSize: 12,
    color: t.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing(1),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  rowMain: { flex: 1, paddingRight: spacing(3) },
  title: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  date: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  listening: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  status: { fontSize: 13, fontWeight: '700' },
  present: { color: t.feedback.success },
  absent: { color: t.feedback.danger },
  excused: { color: t.text.accent },
});
