import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import {
  COLLECTIONS,
  isStaffRole,
  type Role,
  type StaffUserDoc,
  type StudentDoc,
  type TokenClaims,
} from '@sabeel/shared';
import { googleSignOut } from './auth/google';
import { auth, db } from './firebase';
import { setLiveDataSession } from './liveQuery';
import { registerThisDevice, unregisterThisDevice } from './notifications';

export type Profile =
  | { kind: 'staff'; doc: StaffUserDoc }
  | { kind: 'student'; doc: StudentDoc };

export type Session =
  | { phase: 'loading' }
  | { phase: 'signedOut' }
  | { phase: 'signedIn'; user: User; profile: Profile | null; claims: TokenClaims };

export async function signOut(): Promise<void> {
  // Drop this device's push registration FIRST, while the credential still
  // exists to authorize the delete. A shared device that kept its registration
  // would deliver one student's "a recording is ready" to whoever signs in
  // next — a leak, and the single most confusing notification the app could
  // send. Best-effort: failing to unregister must never trap someone signed in.
  const uid = auth.currentUser?.uid;
  if (uid) await unregisterThisDevice(uid).catch(() => undefined);
  // Also clear the native Google session, or the next sign-in silently reuses
  // the same account with no way to switch users.
  await googleSignOut().catch(() => undefined);
  await fbSignOut(auth);
}

/** Which collection holds this user's mirror document. */
function profileCollection(role: Role | undefined): string {
  return isStaffRole(role) ? COLLECTIONS.staffUsers : COLLECTIONS.students;
}

/**
 * Whose device registration has been claimed this run.
 *
 * The session publishes repeatedly — the approval poll, a claim refresh, any
 * profile edit — and re-registering on each would rewrite the same document for
 * no reason. Cleared on sign-out, below.
 */
let pushRegisteredFor: string | null = null;

/** True once the account is approved and usable — the only state that leaves the gate. */
function isReady(claims: TokenClaims, profile: Profile | null): boolean {
  return !!profile && claims.status === 'active';
}

/** Has the token fallen behind the document? */
function isStale(claims: TokenClaims, profile: Profile): boolean {
  return claims.status !== profile.doc.status || claims.role !== profile.doc.role;
}

/**
 * Auth state + mirror document + token claims, kept coherent.
 *
 * The mirror document is watched live, AND while the user is gated we also POLL:
 * force-refresh the token and re-read the document every few seconds.
 *
 * THE POLL IS NOT REDUNDANT. When an admin approves someone, the Admin SDK sets
 * that user's custom claims, which disrupts their in-flight Firestore listener —
 * so the document-update snapshot may never arrive. Polling detects approval
 * regardless, and is also how the token picks up new claims without a
 * sign-out/in. Remove it and approval appears to do nothing until the user
 * restarts the app.
 *
 * Which collection to read is itself derived from the claim, because the two
 * populations live in different collections and a student must never be made to
 * read staffUsers (the rules would deny it, producing a listener error on every
 * student sign-in).
 */
export function useSession(): Session {
  const [session, setSession] = useState<Session>({ phase: 'loading' });
  const latest = useRef<{ profile: Profile | null }>({ profile: null });

  useEffect(() => {
    let unsubDoc: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const stopPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      unsubDoc?.();
      unsubDoc = null;
      stopPoll();
      latest.current = { profile: null };
      // FIRST, before anything awaits. Firestore reacts to the same credential
      // change by re-issuing every live listen, and the refusals come back while
      // the screens holding them are still mounted; this is what marks those
      // denials expected rather than reporting them. Publishing it here means it
      // is set in the same tick the credential drops.
      setLiveDataSession(false);

      if (!user) {
        pushRegisteredFor = null;
        setSession({ phase: 'signedOut' });
        return;
      }

      const toProfile = (
        role: Role | undefined,
        data: Record<string, unknown> | null,
      ): Profile | null => {
        if (!data) return null;
        return isStaffRole(role)
          ? { kind: 'staff', doc: data as unknown as StaffUserDoc }
          : { kind: 'student', doc: data as unknown as StudentDoc };
      };

      const publish = (profile: Profile | null, claims: TokenClaims) => {
        if (cancelled) return;
        latest.current = { profile };
        // A gated account — pending, disabled, or not yet provisioned — is
        // denied by every rule, so denials while it is in that state say
        // nothing. Being disabled mid-session is the case that matters: the
        // claim flips under a screen that is still subscribed.
        setLiveDataSession(isReady(claims, profile));
        setSession({ phase: 'signedIn', user, profile, claims });
        if (isReady(claims, profile)) stopPoll();

        // Claim this device's push token once the account is usable. SILENT —
        // it never prompts, and only writes a token for a device already
        // permitted. Without it the sole thing that ever registers is a visit
        // to the notifications screen, so someone who granted permission and
        // never went back received nothing, and a rotated FCM token was never
        // replaced. The sibling apps have always done this at sign-in.
        if (isReady(claims, profile) && pushRegisteredFor !== user.uid) {
          pushRegisteredFor = user.uid;
          void registerThisDevice(user.uid, false).catch(() => undefined);
        }
        else if (!pollTimer) pollTimer = setInterval(poll, 3000);
      };

      // Arm the live listener against whichever collection the claim points at.
      // Idempotent: a brand-new account has no claims yet, so the poll is what
      // eventually discovers where it belongs and arms this.
      const armListener = (role: Role) => {
        if (unsubDoc) return;
        unsubDoc = onSnapshot(
          doc(db, profileCollection(role), user.uid),
          (snap) => {
            void (async () => {
              const fresh = (await user.getIdTokenResult()).claims as TokenClaims;
              const profile = toProfile(fresh.role, snap.exists() ? snap.data() : null);
              publish(profile, fresh);
              // Document says active but the token still lags: refresh now rather
              // than waiting for the next poll tick.
              if (profile && isStale(fresh, profile)) void poll();
            })();
          },
          (e) => console.warn('profile listener', e.code ?? e.message),
        );
      };

      const poll = async () => {
        try {
          await user.getIdToken(true);
          const claims = (await user.getIdTokenResult()).claims as TokenClaims;
          const snap = await getDoc(doc(db, profileCollection(claims.role), user.uid));
          publish(toProfile(claims.role, snap.exists() ? snap.data() : null), claims);
          // Provisioning has landed — start watching live so later changes do not
          // wait for a poll tick.
          if (claims.role) armListener(claims.role);
        } catch (e) {
          console.warn('session poll', (e as { code?: string }).code ?? (e as Error).message);
        }
      };

      const start = async () => {
        const claims = (await user.getIdTokenResult()).claims as TokenClaims;
        if (claims.role) armListener(claims.role);
        // publish arms the poll whenever the account is not yet usable, which
        // covers both "the auth trigger has not run yet" and "still pending".
        await poll();
      };

      void start().catch((e) => {
        console.error('session bootstrap failed', e);
        void poll();
      });
    });

    return () => {
      cancelled = true;
      unsubAuth();
      unsubDoc?.();
      stopPoll();
    };
  }, []);

  return session;
}
