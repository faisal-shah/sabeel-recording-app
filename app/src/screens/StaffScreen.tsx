import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Role } from '@sabeel/shared';
import {
  Button,
  Card,
  Collapsible,
  Empty,
  Grid,
  Notice,
  Row,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { setStaffAccess, useDecidedStaff, usePendingStaff, type StaffRow } from '../staff';
import { getTheme, spacing } from '../theme';
import { errorText } from '../errors';

const t = getTheme();

/**
 * Admin-only: the approval queue and the running access list.
 *
 * Everything here goes through the setStaffAccess callable, which re-checks that
 * the caller is an admin. The UI hiding a control is convenience, never the
 * boundary.
 */
export function StaffScreen({ selfUid, header }: { selfUid: string; header?: ReactNode }) {
  const pending = usePendingStaff(true);
  const decided = useDecidedStaff(true);
  // Split the way the student list is split: a disabled account is history,
  // not a colleague, and interleaved with the live ones it read as one.
  const active = decided.filter((s) => s.status !== 'disabled');
  const disabled = decided.filter((s) => s.status === 'disabled');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (uid: string, change: Parameters<typeof setStaffAccess>[0]) => {
    setBusyUid(uid);
    setError(null);
    try {
      await setStaffAccess(change);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <Screen title="People" subtitle="Approve accounts and set roles" width="list">
      {header}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Waiting for approval ({pending.length})</SectionTitle>
      {pending.length === 0 ? (
        <Empty>Nobody is waiting.</Empty>
      ) : (
        <Grid min={330}>
          {pending.map((s) => (
            <Card key={s.uid}>
              <Person row={s} />
              <Row>
                <Button
                  testID={`approve-${s.email}`}
                  label="Approve as manager"
                  busy={busyUid === s.uid}
                  onPress={() => void act(s.uid, { uid: s.uid, status: 'active', role: 'manager' })}
                />
                <Button
                  label="Approve as admin"
                  variant="secondary"
                  busy={busyUid === s.uid}
                  onPress={() => void act(s.uid, { uid: s.uid, status: 'active', role: 'admin' })}
                />
              </Row>
            </Card>
          ))}
        </Grid>
      )}

      <SectionTitle>Staff ({active.length})</SectionTitle>
      {active.length === 0 ? (
        <Empty>No staff accounts yet.</Empty>
      ) : (
        <Grid min={330}>
          {active.map((s) => (
            <StaffCard key={s.uid} row={s} isSelf={s.uid === selfUid} busy={busyUid === s.uid} act={act} />
          ))}
        </Grid>
      )}

      {/* Out of the way but reachable, exactly as a disabled student is: the
          card keeps its Re-enable, so bringing a colleague back is one tap
          once the section is open. */}
      {disabled.length > 0 ? (
        <Collapsible testID="staff-disabled" title="Disabled" count={disabled.length}>
          <Grid min={330}>
            {disabled.map((s) => (
              <StaffCard key={s.uid} row={s} isSelf={s.uid === selfUid} busy={busyUid === s.uid} act={act} />
            ))}
          </Grid>
        </Collapsible>
      ) : null}
    </Screen>
  );
}

function StaffCard({
  row: s,
  isSelf,
  busy,
  act,
}: {
  row: StaffRow;
  isSelf: boolean;
  busy: boolean;
  act: (uid: string, change: Parameters<typeof setStaffAccess>[0]) => Promise<void>;
}) {
  return (
    <Card>
      <Person row={s} />
      {isSelf ? (
        // The server refuses this too; saying so up front is kinder than
        // a permission error. Without the rule, the last admin could lock
        // the institute out of its own user management.
        <Text style={styles.selfNote}>This is you. You cannot change your own role or access.</Text>
      ) : (
        <Row>
          <Button
            testID={`staff-role-${s.email}`}
            label={s.role === 'admin' ? 'Make manager' : 'Make admin'}
            variant="secondary"
            busy={busy}
            onPress={() =>
              void act(s.uid, {
                uid: s.uid,
                role: (s.role === 'admin' ? 'manager' : 'admin') as Extract<Role, 'admin' | 'manager'>,
              })
            }
          />
          <Button
            testID={`staff-access-${s.email}`}
            label={s.status === 'disabled' ? 'Re-enable' : 'Disable'}
            // Secondary in BOTH directions, exactly as on a student's
            // page. Disabling an account is reversible and is the
            // RECOMMENDED action in this product; dressing one of the
            // two Disables in the app as destructive and the other as
            // routine teaches people the colour means nothing.
            variant="secondary"
            busy={busy}
            onPress={() =>
              void act(s.uid, {
                uid: s.uid,
                status: s.status === 'disabled' ? 'active' : 'disabled',
              })
            }
          />
        </Row>
      )}
    </Card>
  );
}

function Person({ row }: { row: StaffRow }) {
  return (
    <View>
      <Text style={styles.name}>{row.displayName}</Text>
      <Text style={styles.email}>{row.email}</Text>
      <View style={styles.meta}>
        <StatusChip status={row.status} />
        <Text style={styles.role}>{row.role}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  email: { fontSize: 14, color: t.text.secondary, marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginTop: spacing(2) },
  role: { fontSize: 13, color: t.text.secondary },
  selfNote: { fontSize: 13, color: t.text.secondary, marginTop: spacing(2) },
});
