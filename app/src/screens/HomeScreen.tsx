import type { Role } from '@sabeel/shared';
import { Button, Card, Notice, Screen, SectionTitle } from '../components/ui';
import { signOut } from '../session';
import { IS_DEV } from '../env';

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
  onOpen: (route: 'Staff' | 'Students' | 'Cohorts' | 'MyClasses' | 'MyRecordings' | 'Tokens') => void;
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
              <>
                <Button testID="nav-cohorts" label="Cohorts & classes" onPress={() => onOpen('Cohorts')} />
                <Button
                  testID="nav-staff"
                  label="Staff"
                  variant="secondary"
                  onPress={() => onOpen('Staff')}
                />
              </>
            ) : (
              <Button testID="nav-myclasses" label="My classes" onPress={() => onOpen('MyClasses')} />
            )}
            <Button
              testID="nav-students"
              label="Students"
              variant="secondary"
              onPress={() => onOpen('Students')}
            />
          </Card>
          <Notice tone="info">
            Recordings and the accountability ledger arrive in the next phases.
          </Notice>
        </>
      ) : (
        <Card>
          <Button
            testID="nav-myrecordings"
            label="My recordings"
            onPress={() => onOpen('MyRecordings')}
          />
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

