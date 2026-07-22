import { StyleSheet, Text } from 'react-native';
import type { Role } from '@sabeel/shared';
import { Button, Card, Notice, Screen, SectionTitle } from '../components/ui';
import { signOut } from '../session';
import { IS_DEV } from '../env';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * Role-routed landing screen.
 *
 * A placeholder for now: recordings arrive in Phase 3, the ledger in Phase 5.
 * What it does prove is that the role reached the client correctly, which is the
 * whole point of Phase 1 — a manager and a student must see different things.
 */
export function HomeScreen({
  name,
  role,
  onOpen,
}: {
  name: string;
  role: Role;
  onOpen: (route: 'Staff' | 'Students' | 'Tokens') => void;
}) {
  const isAdmin = role === 'admin';
  const isStaff = role === 'admin' || role === 'manager';

  return (
    <Screen title={`Hello, ${name}`} subtitle={roleLabel(role)}>
      {isStaff ? (
        <>
          <SectionTitle>Manage</SectionTitle>
          <Card>
            {isAdmin ? (
              <Button testID="nav-staff" label="Staff" onPress={() => onOpen('Staff')} />
            ) : null}
            <Button
              testID="nav-students"
              label="Students"
              variant={isAdmin ? 'secondary' : 'primary'}
              onPress={() => onOpen('Students')}
            />
          </Card>
          <Notice tone="info">
            Cohorts and classes arrive next; recordings and the accountability ledger
            follow after that.
          </Notice>
        </>
      ) : (
        <Card>
          <Text style={styles.body}>
            Your class recordings will appear here once your teacher publishes them.
          </Text>
        </Card>
      )}

      {IS_DEV ? (
        <Button label="Design tokens" variant="secondary" onPress={() => onOpen('Tokens')} />
      ) : null}
      <Button testID="sign-out" label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

function roleLabel(role: Role): string {
  return role === 'admin' ? 'Administrator' : role === 'manager' ? 'Staff' : 'Student';
}

const styles = StyleSheet.create({
  body: { fontSize: 15, color: t.text.secondary },
});
