import { getMessaging } from 'firebase-admin/messaging';
import type { PushMessage } from '@sabeel/shared';

/**
 * The one place FCM is actually called.
 *
 * A SEAM, for the reason `zoom.ts` and `mediaUrl.ts` are seams: there is no FCM
 * emulator — none exists — so every test in this repo has to run with the send
 * stubbed. Keeping the network call behind one swappable function means the
 * decision logic above it is fully testable and only this file is unverified
 * until a real device confirms delivery.
 *
 * It also means a send failure cannot take down a trigger: per-token failures
 * come back as results, not throws, so the caller can prune dead tokens.
 */

/** Which tokens the send failed for, and are therefore dead. */
export interface SendOutcome {
  /** Tokens the transport rejected as unregistered/invalid — safe to delete. */
  stale: string[];
  /** How many messages were accepted. */
  sent: number;
}

export type Sender = (tokens: string[], message: PushMessage) => Promise<SendOutcome>;

/**
 * FCM error codes that mean "this token will never work again".
 *
 * Anything else — a quota error, a transient unavailable — must NOT delete the
 * token: pruning on a temporary failure would silently unregister a working
 * device and the only symptom would be notifications quietly stopping.
 *
 * `messaging/invalid-argument` is deliberately NOT here, though it looks like it
 * belongs: FCM also returns it for a malformed MESSAGE, so one bad title would
 * come back against every entry in the batch and prune every recipient's tokens
 * at once. Only these two are specific to the token.
 */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Whether a per-token failure code justifies deleting that registration. */
export function isDeadToken(code: string | undefined): boolean {
  return !!code && DEAD_TOKEN_CODES.has(code);
}

export const fcmSender: Sender = async (tokens, message) => {
  if (tokens.length === 0) return { stale: [], sent: 0 };
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: message.title, body: message.body },
    // A data payload as well as a notification, so a foregrounded app can
    // render its own banner rather than relying on the OS one it never sees.
    data: { title: message.title, body: message.body },
  });
  const stale: string[] = [];
  res.responses.forEach((r, i) => {
    if (!r.success && isDeadToken((r.error as { code?: string } | undefined)?.code)) {
      stale.push(tokens[i]);
    }
  });
  return { stale, sent: res.successCount };
};

/**
 * The sender in effect. Swapped in tests; production never touches this.
 *
 * A module-level handle rather than a parameter threaded through every call
 * site, matching how `zoomClient` is stubbed in `zoom.integration.test.ts`.
 */
let sender: Sender = fcmSender;

export function setSender(next: Sender): void {
  sender = next;
}

export function send(tokens: string[], message: PushMessage): Promise<SendOutcome> {
  return sender(tokens, message);
}
