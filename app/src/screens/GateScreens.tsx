import { Button, Card, Notice, Screen } from '../components/ui';
import { signOut } from '../session';

/**
 * Where a signed-in but unusable account waits.
 *
 * These update live: the session polls while gated, so approval un-gates without
 * a sign-out. That poll exists because setting custom claims disrupts the user's
 * in-flight listener — the document snapshot announcing approval may never
 * arrive, and without the poll this screen would sit here looking broken.
 */
export function PendingScreen({ email }: { email: string }) {
  return (
    <Screen title="Waiting for approval" subtitle={email}>
      <Card>
        <Notice tone="info">
          Your Sabeel account has been recognised, but an administrator still needs to
          approve it. This page updates by itself once they do — you do not need to sign
          in again.
        </Notice>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}

export function DisabledScreen({ email }: { email: string }) {
  return (
    <Screen title="Account disabled" subtitle={email}>
      <Card>
        <Notice tone="error">
          This account no longer has access. Your listening history and records are kept;
          contact an administrator if you think this is a mistake.
        </Notice>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}

/**
 * Signed in, but no mirror document and no claims yet.
 *
 * Normally a blink: the auth-create trigger provisions within a second or two.
 * It persists only if the trigger failed or rejected the account — and a
 * rejected account is deleted outright, which signs the user straight back out.
 */
export function ProvisioningScreen() {
  return (
    <Screen title="Setting up your account">
      <Card>
        <Notice tone="info">
          One moment. If this does not clear within a few seconds, sign out and try again
          — staff accounts must use a Sabeel address.
        </Notice>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}
