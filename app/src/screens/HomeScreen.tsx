import type { Role } from '@sabeel/shared';
import { Button, Card, Screen, SectionTitle } from '../components/ui';
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
  onOpenAudit,
}: {
  name: string;
  role: Role;
  onOpen: (route: 'Staff' | 'Students' | 'Cohorts' | 'MyCourses' | 'Library' | 'Tokens') => void;
  /** Admin-only global audit view (managers reach a scoped one from a course). */
  onOpenAudit: () => void;
}) {
  // Staff only — a student's landing is StudentHomeScreen (their task list).
  const isAdmin = role === 'admin';

  return (
    <Screen title={`Salaam, ${name}`} subtitle={roleLabel(role)}>
      <SectionTitle>Manage</SectionTitle>
      <Card>
        {isAdmin ? (
          <>
            <Button testID="nav-cohorts" label="Cohorts & courses" onPress={() => onOpen('Cohorts')} />
            <Button
              testID="nav-staff"
              label="Staff"
              variant="secondary"
              onPress={() => onOpen('Staff')}
            />
          </>
        ) : (
          <Button testID="nav-myclasses" label="My courses" onPress={() => onOpen('MyCourses')} />
        )}
        <Button
          testID="nav-students"
          label="Students"
          variant="secondary"
          onPress={() => onOpen('Students')}
        />
        {/* Zoom import is reached per-session now (from a session's recording
            section) — a Zoom recording is imported INTO a specific session. */}
      </Card>

      <SectionTitle>Reports</SectionTitle>
      <Card>
        <Button testID="nav-library" label="Recording library" onPress={() => onOpen('Library')} />
        {isAdmin ? (
          <Button testID="nav-audit-global" label="Audit history" variant="secondary" onPress={onOpenAudit} />
        ) : null}
      </Card>

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

