import { NEW_STAFF_ACCESS, isAllowedStaffEmail } from '@sabeel/shared';
import type { Role, UserStatus } from '@sabeel/shared';

/**
 * The decision half of new-user provisioning, kept pure so every branch can be
 * tested exhaustively without an emulator or the Admin SDK. `authTrigger.ts`
 * performs the effects.
 *
 * This app has TWO auth populations, which is what makes it differ from the
 * sibling kanban app (whose trigger deletes anything not on the org domain — a
 * rule that here would delete every student):
 *
 *  - Google sign-in is STAFF. Domain-gated, and lands pending.
 *  - Email/password is a STUDENT, and can only be minted by the Admin SDK from
 *    the createStudent callable, which sets claims and writes the document
 *    itself. The trigger must keep its hands off, or it races that callable.
 *  - Anything else is deleted.
 */

export type ProvisionDecision =
  | { action: 'reject'; reason: 'bad-domain' | 'unsupported-provider'; email: string | null }
  | { action: 'ignore'; reason: 'admin-sdk-provisioned' }
  | {
      action: 'provision';
      claims: { role: Role; status: UserStatus };
      profile: { email: string; displayName: string; photoUrl: string | null };
    };

export interface NewUser {
  email?: string | null;
  emailVerified?: boolean;
  displayName?: string | null;
  photoURL?: string | null;
  providerIds: string[];
}

export function decideProvision(user: NewUser): ProvisionDecision {
  const { email, emailVerified = false, providerIds } = user;

  // Students, in both the states they can be in.
  //
  // `password` is the obvious one. The subtle one is NO PROVIDER AT ALL: a user
  // the Admin SDK creates without a password — which is exactly what
  // createStudent does, so the student can set their own — has an empty
  // providerData until they first set one. Treating that as an unknown provider
  // deleted every student account moments after it was created, and the failure
  // looked intermittent because it depended on trigger timing.
  //
  // An email is what separates that case from an anonymous sign-in, which also
  // has no provider data but never has an address.
  //
  // Both rely on client-side email/password sign-up being disabled in the
  // Firebase console (Authentication → Settings → User actions). That setting is
  // load-bearing. If it were missed a stranger could mint an account — but this
  // trigger gives it no claims, and every rule gates on status == 'active' with
  // a default of '', so it could read nothing. Untidy, not exploitable.
  if (providerIds.includes('password')) {
    return { action: 'ignore', reason: 'admin-sdk-provisioned' };
  }
  if (providerIds.length === 0) {
    return email
      ? { action: 'ignore', reason: 'admin-sdk-provisioned' }
      : { action: 'reject', reason: 'unsupported-provider', email: null };
  }

  if (!providerIds.includes('google.com')) {
    return { action: 'reject', reason: 'unsupported-provider', email: email ?? null };
  }

  // The staff domain gate, and the only one that counts. The client `hd` hint
  // merely filters the account chooser, and the consent screen cannot be relied
  // on either — "Internal" needs the project to be in a Cloud organization.
  if (!isAllowedStaffEmail(email, emailVerified)) {
    return { action: 'reject', reason: 'bad-domain', email: email ?? null };
  }

  return {
    action: 'provision',
    claims: { ...NEW_STAFF_ACCESS },
    profile: {
      email: email as string,
      // Fall back to the local part rather than showing an empty row in the
      // approval queue — admins approve people by name and address.
      displayName: user.displayName?.trim() || (email as string).split('@')[0],
      photoUrl: user.photoURL ?? null,
    },
  };
}
