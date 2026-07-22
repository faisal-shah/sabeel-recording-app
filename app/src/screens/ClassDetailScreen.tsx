import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Empty,
  Field,
  Notice,
  Row,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { useDecidedStaff } from '../staff';
import { useStudents } from '../students';
import {
  createEnrollment,
  setClassManagers,
  setEnrollmentActive,
  updateClass,
  useRoster,
  type ClassRow,
} from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * One class: its settings (admin), its managers (admin), and its roster
 * (admin or a manager scoped to it).
 *
 * The roster query is constrained to this one classId — required by the
 * enrollments rule, whose staff arm resolves a class lookup per row and is only
 * affordable when every row shares one class.
 */
export function ClassDetailScreen({
  cls,
  isAdmin,
  onOpenRecordings,
}: {
  cls: ClassRow;
  isAdmin: boolean;
  onOpenRecordings: () => void;
}) {
  const roster = useRoster(cls.id);
  const students = useStudents(true);
  const staff = useDecidedStaff(isAdmin);
  const [name, setName] = useState(cls.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <Screen subtitle={cls.name}>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card>
        <Button testID="nav-recordings" label="Recordings" onPress={onOpenRecordings} />
        <View style={styles.meta}>
          <StatusChip status={cls.effectiveActive ? 'active' : 'inactive'} />
          {!cls.effectiveActive ? (
            <Text style={styles.hint}>
              {cls.archivedAccess
                ? 'archived — students can still listen'
                : 'archived — listening is off'}
            </Text>
          ) : null}
        </View>
      </Card>

      {isAdmin ? (
        <>
          <SectionTitle>Settings</SectionTitle>
          <Card>
            <Field testID="class-rename" label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
            <Button
              label="Rename"
              disabled={!name.trim() || name.trim() === cls.name}
              busy={busy === 'rename'}
              onPress={() => void run('rename', () => updateClass({ classId: cls.id, name: name.trim() }))}
            />
            <Row>
              <Button
                testID="class-archive"
                label={cls.archived ? 'Reactivate class' : 'Archive class'}
                variant="secondary"
                busy={busy === 'archive'}
                onPress={() =>
                  void run('archive', () =>
                    updateClass({ classId: cls.id, archived: !cls.archived }),
                  )
                }
              />
              <Button
                testID="class-archived-access"
                label={
                  cls.archivedAccess
                    ? 'Archived listening: on'
                    : 'Archived listening: off'
                }
                variant="secondary"
                busy={busy === 'access'}
                onPress={() =>
                  void run('access', () =>
                    updateClass({ classId: cls.id, archivedAccess: !cls.archivedAccess }),
                  )
                }
              />
            </Row>
          </Card>

          <SectionTitle>Managers ({cls.managerUids.length})</SectionTitle>
          <Card>
            {staff.filter((s) => s.status === 'active').length === 0 ? (
              <Empty>No active staff to assign.</Empty>
            ) : (
              staff
                .filter((s) => s.status === 'active')
                .map((s) => {
                  const on = cls.managerUids.includes(s.uid);
                  return (
                    <Pressable
                      key={s.uid}
                      testID={`class-manager-${s.email}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${on ? 'Remove' : 'Assign'} ${s.displayName}`}
                      onPress={() =>
                        void run(`mgr-${s.uid}`, () =>
                          setClassManagers({
                            classId: cls.id,
                            managerUids: on
                              ? cls.managerUids.filter((u) => u !== s.uid)
                              : [...cls.managerUids, s.uid],
                          }),
                        )
                      }
                      style={styles.pickRow}
                    >
                      <View style={[styles.tick, on ? styles.tickOn : null]} />
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
        <Empty>Nobody is enrolled in this class yet.</Empty>
      ) : (
        roster
          .filter((r) => r.active)
          .map((r) => {
            const s = byUid.get(r.studentUid);
            return (
              <Card key={r.id}>
                <Text style={styles.name}>{s?.displayName ?? r.studentUid}</Text>
                {s ? <Text style={styles.hint}>{s.email}</Text> : null}
                <Row>
                  <Button
                    testID={`roster-remove-${s?.email ?? r.studentUid}`}
                    label="Remove from class"
                    variant="secondary"
                    busy={busy === `rm-${r.id}`}
                    onPress={() =>
                      void run(`rm-${r.id}`, () =>
                        setEnrollmentActive({
                          studentUid: r.studentUid,
                          classId: cls.id,
                          active: false,
                        }),
                      )
                    }
                  />
                </Row>
              </Card>
            );
          })
      )}

      <SectionTitle>Add a student</SectionTitle>
      <Card>
        {notEnrolled.length === 0 ? (
          <Empty>
            {students.filter((s) => s.status === 'active').length === 0
              ? 'No student accounts yet. Create one from the Students screen first.'
              : 'Every active student is already in this class.'}
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
                  createEnrollment({ studentUid: s.uid, classId: cls.id }),
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
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing(2) },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(2),
    gap: spacing(3),
  },
  pickText: { flex: 1 },
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
