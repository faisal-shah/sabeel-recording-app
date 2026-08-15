import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DEFAULT_DUE_DAYS, INSTITUTE_TIMEZONE, addDays, todayInZone } from '@sabeel/shared';
import { Button, Card, Empty, Field, Notice, Screen, SectionTitle } from '../components/ui';
import { DateField } from '../components/DateField';
import { createSession, useCourseSessions, type SessionRow } from '../sessions';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * The deadline to prefill for a meeting on `date`, floored at today.
 *
 * Back-entering a meeting from a fortnight ago is a normal flow, and
 * `date + DEFAULT_DUE_DAYS` alone would silently prefill a deadline the server
 * refuses — leaving the Create button enabled and the error unexplained. Today is
 * the earliest date that can be written, and it is still the last on-time day.
 */
function dueFor(date: string): string {
  const proposed = addDays(date, DEFAULT_DUE_DAYS);
  const today = todayInZone(INSTITUTE_TIMEZONE);
  return proposed < today ? today : proposed;
}

/**
 * Staff: the sessions (dated meetings) of one course.
 *
 * A session is the organizing unit — attendance lives on it, and its recording
 * (0..1) hangs off it. Create a session for a meeting, take attendance, and add
 * the recording; whoever was excused is then granted it automatically.
 */
export function SessionsScreen({
  courseId,
  courseName,
  onOpenCourse,
  onOpenSession,
}: {
  courseId: string;
  courseName: string;
  onOpenCourse: () => void;
  onOpenSession: (session: SessionRow) => void;
}) {
  const sessions = useCourseSessions(courseId);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayInZone(INSTITUTE_TIMEZONE));
  // Prefilled from the meeting date and kept in step with it until staff edit it
  // themselves. It cannot be blank: the due date is the day access closes, so an
  // empty one would mean a recording that never closes.
  const [dueDate, setDueDate] = useState(() => dueFor(todayInZone(INSTITUTE_TIMEZONE)));
  const [dueEdited, setDueEdited] = useState(false);

  const changeDate = (next: string) => {
    setDate(next);
    if (!dueEdited && next) setDueDate(dueFor(next));
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = () =>
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await createSession({
          courseId,
          date,
          title: title.trim(),
          dueDate: dueDate.trim(),
          notes: '',
        });
        setTitle('');
        setDueEdited(false);
        setDueDate(dueFor(date));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();

  return (
    <Screen parent={{ label: courseName, testID: 'up-to-course-from-sessions', onPress: onOpenCourse }}>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Add a session</SectionTitle>
      <Card>
        <Field
          testID="session-title"
          label="Title"
          value={title}
          onChangeText={setTitle}
          autoCapitalize="words"
          placeholder="Session 1 — Introduction"
        />
        <DateField label="Date of the meeting" value={date} onChange={changeDate} />
        <DateField
          label="Listen by"
          value={dueDate}
          onChange={(v) => {
            setDueEdited(true);
            setDueDate(v);
          }}
        />
        <Button
          testID="session-create"
          label="Create session"
          busy={busy}
          disabled={!title.trim() || !date || !dueDate}
          onPress={add}
        />
      </Card>

      <SectionTitle>Sessions ({sessions.length})</SectionTitle>
      {sessions.length === 0 ? (
        <Empty>No sessions yet. Add one for each class meeting.</Empty>
      ) : (
        sessions.map((s) => (
          <Pressable
            key={s.id}
            testID={`session-open-${s.title}`}
            onPress={() => onOpenSession(s)}
          >
            <Card>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.date}>{s.date}</Text>
              <View style={styles.tags}>
                <Tag
                  on={!!s.attendanceSubmittedAt}
                  onLabel="Attendance taken"
                  offLabel="Attendance not taken"
                />
                <Tag on={!!s.recordingId} onLabel="Recording added" offLabel="No recording" />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

function Tag({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return (
    <View style={[styles.tag, on ? styles.tagOn : styles.tagOff]}>
      <Text style={[styles.tagText, on ? styles.tagTextOn : styles.tagTextOff]}>
        {on ? onLabel : offLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  date: { fontSize: 13, color: t.text.secondary, marginTop: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(3) },
  tag: { paddingVertical: spacing(1), paddingHorizontal: spacing(3), borderRadius: 999, borderWidth: 1 },
  tagOn: { backgroundColor: t.bg.accentSoft, borderColor: t.accent.base },
  tagOff: { backgroundColor: t.bg.inset, borderColor: t.border.strong },
  tagText: { fontSize: 12, fontWeight: '600' },
  tagTextOn: { color: t.accent.base },
  tagTextOff: { color: t.text.secondary },
});
