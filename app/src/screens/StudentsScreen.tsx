import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Collapsible,
  Empty,
  Field,
  Notice,
  ListRow,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { createStudent, useStudents } from '../students';
import { useAllCourses, useCohorts, useMyCourses } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Staff: create students and manage their access.
 *
 * Creating a student IS the approval — they arrive active, with no pending
 * state. The account is made without a password and the student sets their own
 * from an emailed link; completing that link is what proves they control the
 * address, so there is no separate verification step.
 *
 * Enrolment into a course is added in 1b, once courses exist.
 */
export function StudentsScreen({
  isAdmin,
  uid,
  onOpenStudent,
}: {
  isAdmin: boolean;
  uid: string;
  onOpenStudent: (studentUid: string) => void;
}) {
  const students = useStudents(true);
  const active = students.filter((s) => s.status !== 'disabled');
  const disabled = students.filter((s) => s.status === 'disabled');
  const courseOptions = useCourseOptions(isAdmin, uid);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await createStudent({
        displayName: displayName.trim(),
        email: email.trim(),
        // The key is OMITTED when no course is chosen, never set to undefined:
        // the callable SDK serializes an explicitly-undefined property as null,
        // so `courseId: undefined` reaches the server as `courseId: null`.
        ...(courseId ? { courseId } : {}),
      });
      setDisplayName('');
      setEmail('');
      setCourseId(null);
      setInfo(
        res.emailSent
          ? 'Account created. They have been emailed a link to set their password.'
          : 'Account created, but the password email could not be sent. Use Resend below.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen subtitle="Create accounts and manage access">
      <SectionTitle>Add a student</SectionTitle>
      <Card>
        <Field
          testID="student-name"
          label="Full name"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          placeholder="Fatima Ahmed"
        />
        <Field
          testID="student-email"
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          placeholder="student@example.com"
        />
        {courseOptions.length > 0 ? (
          <View style={styles.picker}>
            {/* A tappable list, not a dropdown — React Native has no dropdown
                primitive, and this matches the approve-as-manager/-admin shape
                already used elsewhere. */}
            <Text style={styles.pickerLabel}>Enrol in a course (optional)</Text>
            {courseOptions.map((c) => {
              const on = courseId === c.id;
              return (
                <Pressable
                  key={c.id}
                  testID={`student-course-${c.name}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Enrol in ${c.name} in ${c.cohortName}`}
                  onPress={() => setCourseId(on ? null : c.id)}
                  style={styles.pickRow}
                >
                  <View style={[styles.tick, on ? styles.tickOn : null]} />
                  <View style={styles.pickTextWrap}>
                    <Text style={styles.pickText}>{c.name}</Text>
                    {/* Cohort shown so two courses that share a name (same course
                        in different semesters) are told apart. */}
                    <Text style={styles.pickSub}>{c.cohortName}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <Button
          testID="student-create"
          label="Create account"
          busy={busy}
          disabled={!displayName.trim() || !email.includes('@')}
          onPress={() => void create()}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="success">{info}</Notice> : null}
      </Card>

      {/* The list is for finding someone; everything you can DO to them lives on
          their page. Per-row actions made every row three controls wide and
          still answered nothing about the student. */}
      <SectionTitle>Students ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <Empty>No students yet.</Empty>
      ) : (
        active.map((s) => (
          <ListRow
            key={s.uid}
            testID={`student-open-${s.email}`}
            name={s.displayName}
            detail={s.email}
            onPress={() => onOpenStudent(s.uid)}
          />
        ))
      )}

      {disabled.length > 0 ? (
        <Collapsible testID="students-disabled" title="Disabled" count={disabled.length}>
          {disabled.map((s) => (
            <ListRow
              key={s.uid}
              testID={`student-open-${s.email}`}
              name={s.displayName}
              status={<StatusChip status={s.status} />}
              detail={s.email}
              onPress={() => onOpenStudent(s.uid)}
            />
          ))}
        </Collapsible>
      ) : null}
    </Screen>
  );
}

interface CourseOption {
  id: string;
  name: string;
  cohortName: string;
}

/**
 * The courses this staff member may enrol into.
 *
 * An admin sees EVERY course in EVERY cohort (not just the latest — a course in an
 * older semester was invisible before, and two courses that share a name across
 * semesters looked like one). A manager sees only their own — which is also all
 * the security rules would let them read. Each option carries its cohort name so
 * same-named courses are distinguishable. Both roles may read cohorts.
 */
function useCourseOptions(isAdmin: boolean, uid: string): CourseOption[] {
  const cohorts = useCohorts(true);
  const adminCourses = useAllCourses(isAdmin);
  const myCourses = useMyCourses(isAdmin ? null : uid);
  const courses = isAdmin ? adminCourses : myCourses;
  const cohortName = (id: string) => cohorts.find((c) => c.id === id)?.name ?? '';
  return courses
    .map((c) => ({ id: c.id, name: c.name, cohortName: cohortName(c.cohortId) }))
    .sort(
      (a, b) => a.cohortName.localeCompare(b.cohortName) || a.name.localeCompare(b.name),
    );
}

const styles = StyleSheet.create({
  picker: { marginTop: spacing(3) },
  pickerLabel: { fontSize: 13, color: t.text.secondary, marginBottom: spacing(1) },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    paddingVertical: spacing(2),
  },
  pickTextWrap: { flex: 1 },
  pickText: { fontSize: 15, color: t.text.primary },
  pickSub: { fontSize: 13, color: t.text.secondary, marginTop: 1 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: t.border.strong,
    backgroundColor: t.bg.raised,
  },
  tickOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
});
