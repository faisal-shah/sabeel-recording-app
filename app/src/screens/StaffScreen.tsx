import { useEffect, useState, type ReactNode } from 'react';
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
import { setStaffAccess, useDecidedStaffState, usePendingStaffState, type StaffRow } from '../staff';

const NO_STAFF: StaffRow[] = [];
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
  // The `State` variants: "Nobody is waiting" and "No staff accounts yet" are
  // answers, and an admin read both for the length of every cold load.
  const pendingState = usePendingStaffState(true);
  const decidedState = useDecidedStaffState(true);
  const pending = pendingState ?? NO_STAFF;
  const decided = decidedState ?? NO_STAFF;
  // Split the way the student list is split: a disabled account is history,
  // not a colleague, and interleaved with the live ones it read as one.
  const active = decided.filter((s) => s.status !== 'disabled');
  const disabled = decided.filter((s) => s.status === 'disabled');
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * A CARD STAYS LOCKED UNTIL THE SNAPSHOT AGREES, not until the callable
   * answers — the same shape as the enrol row on a course. `busyUid` clears
   * on the response, and the row is still drawn from the previous snapshot
   * for a moment: a pending card still offers both approvals, so a second
   * tap on "Approve as admin" after "Approve as manager" had already returned
   * sent `role: 'admin'` and won; a staff card still shows the old label and
   * re-sends it. The lock holds what was asked for and lifts when the live
   * row says the same.
   */
  const [settling, setSettling] = useState<ReadonlyMap<string, Parameters<typeof setStaffAccess>[0]>>(
    () => new Map(),
  );
  useEffect(() => {
    setSettling((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [uid, want] of prev) {
        const row = decided.find((r) => r.uid === uid);
        const stillPending = pending.some((r) => r.uid === uid);
        const agrees =
          !stillPending &&
          (row === undefined ||
            ((want.role === undefined || row.role === want.role) &&
              (want.status === undefined || row.status === want.status)));
        if (agrees) next.delete(uid);
      }
      return next.size === prev.size ? prev : next;
    });
    // `settling` too: the snapshot can land BEFORE the callable's response
    // does, so the lock may be set after the row already agrees — and with
    // only the rows as dependencies nothing would run again to lift it.
  }, [pending, decided, settling]);
  const locked = (uid: string) => busyUid === uid || settling.has(uid);

  const act = async (uid: string, change: Parameters<typeof setStaffAccess>[0]) => {
    if (locked(uid)) return;
    setBusyUid(uid);
    setError(null);
    // Locked from the tap, as the enrol row is, and released on failure only:
    // on success the snapshot releases it, whichever of the two lands first.
    setSettling((prev) => new Map(prev).set(uid, change));
    try {
      await setStaffAccess(change);
    } catch (e) {
      setError(errorText(e));
      setSettling((prev) => {
        const next = new Map(prev);
        next.delete(uid);
        return next;
      });
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <Screen title="People" subtitle="Approve accounts and set roles" width="list">
      {header}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Waiting for approval{pendingState === null ? '' : ` (${pending.length})`}</SectionTitle>
      {pendingState === null ? (
        <Empty>Checking…</Empty>
      ) : pending.length === 0 ? (
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
                  busy={locked(s.uid)}
                  onPress={() => void act(s.uid, { uid: s.uid, status: 'active', role: 'manager' })}
                />
                <Button
                  label="Approve as admin"
                  variant="secondary"
                  busy={locked(s.uid)}
                  onPress={() => void act(s.uid, { uid: s.uid, status: 'active', role: 'admin' })}
                />
              </Row>
            </Card>
          ))}
        </Grid>
      )}

      <SectionTitle>Staff{decidedState === null ? '' : ` (${active.length})`}</SectionTitle>
      {decidedState === null ? (
        <Empty>Checking…</Empty>
      ) : active.length === 0 ? (
        <Empty>No staff accounts yet.</Empty>
      ) : (
        <Grid min={330}>
          {active.map((s) => (
            <StaffCard key={s.uid} row={s} isSelf={s.uid === selfUid} busy={locked(s.uid)} act={act} />
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
              <StaffCard key={s.uid} row={s} isSelf={s.uid === selfUid} busy={locked(s.uid)} act={act} />
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
