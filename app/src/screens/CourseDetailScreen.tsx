import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Empty,
  Field,
  IconButton,
  Notice,
  ListRow,
  Row,
  Screen,
  SectionTitle,
} from '../components/ui';
import { INSTITUTE_TIMEZONE, todayInZone } from '@sabeel/shared';
import { useCourseLedger } from '../ledger';
import { useDecidedStaff } from '../staff';
import { useStudents } from '../students';
import {
  createEnrollment,
  setCourseManagers,
  setEnrollmentActive,
  updateCourse,
  useRoster,
  type CourseRow,
} from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * One course: its settings (admin), its managers (admin), and its roster
 * (admin or a manager scoped to it).
 *
 * The roster query is constrained to this one courseId — required by the
 * enrollments rule, whose staff arm resolves a course lookup per row and is only
 * affordable when every row shares one course.
 */
export function CourseDetailScreen({
  cls,
  isAdmin,
  onOpenSessions,
  onOpenAttendance,
  onOpenStudent,
  onOpenAudit,
}: {
  cls: CourseRow;
  isAdmin: boolean;
  onOpenSessions: () => void;
  onOpenAttendance: () => void;
  onOpenStudent: (studentUid: string) => void;
  onOpenAudit: () => void;
}) {
  const roster = useRoster(cls.id);
  const students = useStudents(true);
  const staff = useDecidedStaff(isAdmin);
  // Only non-admin active staff can be *assigned* a course — an admin already has
  // every course, so offering to "make them a manager" is a no-op that reads as
  // broken (the confusion a solo admin hits: they can't usefully pick themself).
  const assignableManagers = useMemo(
    () => staff.filter((s) => s.status === 'active' && s.role !== 'admin'),
    [staff],
  );
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const ledger = useCourseLedger(cls.id, today);
  const [name, setName] = useState(cls.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Enrollment id whose removal is being confirmed, if any. */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const enrolled = useMemo(
    () => roster.filter((r) => r.active).map((r) => r.studentUid),
    [roster],
  );
  const byUid = useMemo(
    () => new Map(students.map((s) => [s.uid, s])),
    [students],
  );
  const notEnrolled = useMemo(
    () => students.filter((s) => s.status === 'active' && !enrolled.includes(s.uid)),
    [students, enrolled],
  );

  const managerWriteInFlight = busy?.startsWith('mgr-') ?? false;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      subtitle={cls.name}
      status={cls.effectiveActive ? 'active' : 'inactive'}
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card>
        <Button testID="nav-sessions" label="Sessions" onPress={onOpenSessions} />
        <Button
          testID="nav-attendance"
          label="Attendance report"
          variant="secondary"
          onPress={onOpenAttendance}
        />
        {/* The chip itself now rides the heading line; only the consequence of
            being archived still needs saying here. */}
        {!cls.effectiveActive ? (
          <Text style={styles.hint}>
            {cls.archivedAccess
              ? 'archived — students can still listen'
              : 'archived — listening is off'}
          </Text>
        ) : null}
      </Card>

      {/* Course-level accountability at a glance. Zeroes out when archived (no
          active assignments), while the recordings' history stays. */}
      <Card>
        <Text style={styles.ledgerLine}>
          <Text style={styles.ledgerNum}>{ledger.rollup.incomplete}</Text> incomplete
          {'   '}
          <Text style={[styles.ledgerNum, ledger.rollup.missed > 0 ? styles.missedNum : null]}>
            {ledger.rollup.missed}
          </Text>{' '}
          missed{'   '}of {ledger.rollup.total} required
        </Text>
        <Button testID="nav-audit" label="Audit history" variant="secondary" onPress={onOpenAudit} />
      </Card>

      {isAdmin ? (
        <>
          <SectionTitle>Settings</SectionTitle>
          <Card>
            <Field testID="course-rename" label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Button
              label="Rename"
              disabled={!name.trim() || name.trim() === cls.name}
              busy={busy === 'rename'}
              onPress={() => void run('rename', () => updateCourse({ courseId: cls.id, name: name.trim() }))}
            />
            <Row>
              <Button
                testID="course-archive"
                label={cls.archived ? 'Reactivate course' : 'Archive course'}
                variant="secondary"
                busy={busy === 'archive'}
                onPress={() =>
                  void run('archive', () =>
                    updateCourse({ courseId: cls.id, archived: !cls.archived }),
                  )
                }
              />
              <Button
                testID="course-archived-access"
                label={
                  cls.archivedAccess
                    ? 'Archived listening: on'
                    : 'Archived listening: off'
                }
                variant="secondary"
                busy={busy === 'access'}
                onPress={() =>
                  void run('access', () =>
                    updateCourse({ courseId: cls.id, archivedAccess: !cls.archivedAccess }),
                  )
                }
              />
            </Row>
          </Card>

          <SectionTitle>Managers ({cls.managerUids.length})</SectionTitle>
          <Card>
            {/* Managers are scoped-DOWN staff — access to just this course.
                Admins already have every course, so listing them here (or the
                admin themselves) only invites a pointless, confusing self-toggle;
                exclude them. */}
            <Text style={styles.managerLede}>
              Managers get access to just this course. You — and other admins —
              already have access to every course.
            </Text>
            {assignableManagers.length === 0 ? (
              <Empty>
                No managers to assign yet. Staff who sign in with Google appear here once you
                approve them as a manager, then you can give them this course.
              </Empty>
            ) : (
              assignableManagers.map((s) => {
                  const on = cls.managerUids.includes(s.uid);
                  const pending = busy === `mgr-${s.uid}`;
                  return (
                    <Pressable
                      key={s.uid}
                      testID={`course-manager-${s.email}`}
                      accessibilityRole="checkbox"
                      // aria-*, not accessibilityState: react-native-web has no
                      // mapping for accessibilityState, so it reaches the DOM as
                      // nothing at all and the checkbox exposes no checked state
                      // to assistive tech. RN supports the aria props natively.
                      aria-checked={on}
                      aria-disabled={managerWriteInFlight}
                      accessibilityLabel={`${on ? 'Remove' : 'Assign'} ${s.displayName}`}
                      // Locked while ANY manager write is in flight: this sends the
                      // whole array, so a second tap computed from the pre-write
                      // list would silently undo the first.
                      disabled={managerWriteInFlight}
                      onPress={() =>
                        void run(`mgr-${s.uid}`, () =>
                          setCourseManagers({
                            courseId: cls.id,
                            managerUids: on
                              ? cls.managerUids.filter((u) => u !== s.uid)
                              : [...cls.managerUids, s.uid],
                          }),
                        )
                      }
                      style={[
                        styles.pickRow,
                        managerWriteInFlight && !pending ? styles.rowWaiting : null,
                      ]}
                    >
                      {pending ? (
                        <ActivityIndicator style={styles.tick} color={t.accent.base} />
                      ) : (
                        <View style={[styles.tick, on ? styles.tickOn : null]} />
                      )}
                      <View style={styles.pickText}>
                        <Text style={styles.name}>{s.displayName}</Text>
                        <Text style={styles.hint}>{s.email}</Text>
                      </View>
                    </Pressable>
                  );
                })
            )}
          </Card>
        </>
      ) : null}

      <SectionTitle>Roster ({enrolled.length})</SectionTitle>
      {enrolled.length === 0 ? (
        <Empty>Nobody is enrolled in this course yet.</Empty>
      ) : (
        roster
          .filter((r) => r.active)
          .map((r) => {
            const s = byUid.get(r.studentUid);
            const who = s?.displayName ?? r.studentUid;
            // The whole row opens the student's progress, so the × beside it is
            // one mis-tap away from silently unenrolling someone. It confirms IN
            // PLACE, replacing the row: leaving the row still tappable under
            // "remove?" is the flaw ConfirmDanger exists to prevent.
            if (confirmRemove === r.id) {
              return (
                <View key={r.id} style={styles.confirmRow}>
                  <Notice tone="error">
                    Remove {who} from this course? Their listening history is kept, and you
                    can add them back.
                  </Notice>
                  <Row>
                    <Button
                      testID={`roster-remove-confirm-${s?.email ?? r.studentUid}`}
                      label="Remove"
                      variant="danger"
                      busy={busy === `rm-${r.id}`}
                      onPress={() =>
                        void run(`rm-${r.id}`, async () => {
                          await setEnrollmentActive({
                            studentUid: r.studentUid,
                            courseId: cls.id,
                            active: false,
                          });
                          setConfirmRemove(null);
                        })
                      }
                    />
                    <Button
                      label="Cancel"
                      variant="secondary"
                      disabled={busy === `rm-${r.id}`}
                      onPress={() => setConfirmRemove(null)}
                    />
                  </Row>
                </View>
              );
            }
            // The roster is a list to scan, so it is one line per student: the
            // email added nothing here (you identify classmates by name) and cost
            // a line each, which on a 20-student course is most of the screen.
            return (
              <ListRow
                key={r.id}
                testID={`student-ledger-${s?.email ?? r.studentUid}`}
                name={who}
                openLabel={`Open ${who}'s progress`}
                onPress={() => onOpenStudent(r.studentUid)}
                actionsPinned
                actions={
                  <IconButton
                    testID={`roster-remove-${s?.email ?? r.studentUid}`}
                    glyph="×"
                    label={`Remove ${who} from this course`}
                    variant="danger"
                    onPress={() => setConfirmRemove(r.id)}
                  />
                }
              />
            );
          })
      )}

      <SectionTitle>Add a student</SectionTitle>
      <Card>
        {notEnrolled.length === 0 ? (
          <Empty>
            {students.filter((s) => s.status === 'active').length === 0
              ? 'No student accounts yet. Create one from the Students screen first.'
              : 'Every active student is already in this course.'}
          </Empty>
        ) : (
          notEnrolled.map((s) => (
            <Pressable
              key={s.uid}
              testID={`enrol-${s.email}`}
              accessibilityRole="button"
              accessibilityLabel={`Enrol ${s.displayName}`}
              onPress={() =>
                void run(`add-${s.uid}`, () =>
                  createEnrollment({ studentUid: s.uid, courseId: cls.id }),
                )
              }
              style={styles.pickRow}
            >
              <View style={styles.plus}>
                <Text style={styles.plusText}>+</Text>
              </View>
              <View style={styles.pickText}>
                <Text style={styles.name}>{s.displayName}</Text>
                <Text style={styles.hint}>{s.email}</Text>
              </View>
            </Pressable>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  hint: { fontSize: 13, color: t.text.secondary },
  managerLede: { fontSize: 13, color: t.text.secondary, marginBottom: spacing(2), lineHeight: 19 },
  ledgerLine: { fontSize: 15, color: t.text.secondary, marginBottom: spacing(3) },
  ledgerNum: { fontSize: 18, fontWeight: '700', color: t.text.primary },
  missedNum: { color: t.feedback.danger },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing(2) },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(2),
    gap: spacing(3),
  },
  pickText: { flex: 1 },
  rowWaiting: { opacity: 0.5 },
  // Sits where the row was, so the list does not jump while confirming.
  confirmRow: {
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    paddingHorizontal: spacing(4),
    paddingBottom: spacing(3),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  // A tappable list, not a dropdown: React Native has no dropdown primitive, and
  // the same shape is already used for approve-as-manager/-admin.
  tick: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: t.border.strong,
    backgroundColor: t.bg.raised,
  },
  tickOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  plus: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.bg.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusText: { fontSize: 15, fontWeight: '700', color: t.text.primary, lineHeight: 18 },
});
