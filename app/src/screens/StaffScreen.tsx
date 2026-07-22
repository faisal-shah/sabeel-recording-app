import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Role } from '@sabeel/shared';
import {
  Button,
  Card,
  Empty,
  Notice,
  Row,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { setStaffAccess, useDecidedStaff, usePendingStaff, type StaffRow } from '../staff';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Admin-only: the approval queue and the running access list.
 *
 * Everything here goes through the setStaffAccess callable, which re-checks that
 * the caller is an admin. The UI hiding a control is convenience, never the
 * boundary.
 */
export function StaffScreen({ selfUid }: { selfUid: string }) {
  const pending = usePendingStaff(true);
  const decided = useDecidedStaff(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (uid: string, change: Parameters<typeof setStaffAccess>[0]) => {
    setBusyUid(uid);
    setError(null);
    try {
      await setStaffAccess(change);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <Screen subtitle="Approve accounts and set roles">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Waiting for approval ({pending.length})</SectionTitle>
      {pending.length === 0 ? (
        <Empty>Nobody is waiting.</Empty>
      ) : (
        pending.map((s) => (
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
        ))
      )}

      <SectionTitle>Everyone else ({decided.length})</SectionTitle>
      {decided.length === 0 ? (
        <Empty>No staff accounts yet.</Empty>
      ) : (
        decided.map((s) => {
          const isSelf = s.uid === selfUid;
          return (
            <Card key={s.uid}>
              <Person row={s} />
              {isSelf ? (
                // The server refuses this too; saying so up front is kinder than
                // a permission error. Without the rule, the last admin could lock
                // the institute out of its own user management.
                <Text style={styles.selfNote}>
                  This is you. You cannot change your own role or access.
                </Text>
              ) : (
                <Row>
                  <Button
                    label={s.role === 'admin' ? 'Make manager' : 'Make admin'}
                    variant="secondary"
                    busy={busyUid === s.uid}
                    onPress={() =>
                      void act(s.uid, {
                        uid: s.uid,
                        role: (s.role === 'admin' ? 'manager' : 'admin') as Extract<
                          Role,
                          'admin' | 'manager'
                        >,
                      })
                    }
                  />
                  <Button
                    label={s.status === 'disabled' ? 'Re-enable' : 'Disable'}
                    variant={s.status === 'disabled' ? 'secondary' : 'danger'}
                    busy={busyUid === s.uid}
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
        })
      )}
    </Screen>
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
