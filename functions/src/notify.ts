import { type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  prefEnabled,
  sentNotificationId,
  type DeviceTokenDoc,
  type NotificationKind,
  type NotificationPrefsDoc,
  type PushMessage,
  type SentNotificationDoc,
} from '@sabeel/shared';
import { send } from './messaging';

/**
 * Deliver one message to one person, once.
 *
 * The one path every notification takes, so the three rules that make push
 * bearable live in one place rather than three:
 *
 *  1. **Their switch decides.** A missing preferences document means ON — a
 *     person who has never opened the settings screen should still hear about a
 *     recording, and defaulting the absent document to OFF would mean nobody is
 *     ever notified until they visit a screen whose purpose is turning
 *     notifications off.
 *  2. **Once.** Trigger delivery is at-least-once and the scheduled job runs
 *     every morning regardless of whether yesterday's finished, so without a
 *     durable marker a student would be told twice about the same recording. The
 *     marker is written BEFORE the send, and a create that loses the race is
 *     what stops the second delivery — checking first and writing after would
 *     leave a window two invocations can both pass through.
 *  3. **Dead tokens are pruned, transient failures are not.** Deleting on any
 *     failure would unregister working devices during an outage, and the only
 *     symptom would be notifications quietly stopping.
 *
 * Returns whether anything was actually sent, which is what the tests assert on.
 */
export async function notifyOnce(
  db: Firestore,
  uid: string,
  kind: NotificationKind,
  targetId: string,
  message: PushMessage,
): Promise<boolean> {
  const person = db.collection(COLLECTIONS.notifications).doc(uid);

  const prefs = (await person.get()).data() as NotificationPrefsDoc | undefined;
  if (!prefEnabled(prefs, kind)) return false;

  // Claim the send. `create` fails if the document exists, which is exactly the
  // "someone already did this" answer, and it is atomic — so two concurrent
  // invocations cannot both win.
  const marker = person.collection('sent').doc(sentNotificationId(kind, targetId));
  const record: SentNotificationDoc = { kind, targetId, at: Date.now() };
  try {
    await marker.create(record);
  } catch {
    return false; // already claimed
  }

  const devices = await person.collection('devices').get();
  const tokens = devices.docs.map((d) => (d.data() as DeviceTokenDoc).token);
  if (tokens.length === 0) return false;

  const { stale } = await send(tokens, message);
  for (const token of stale) {
    await person.collection('devices').doc(token).delete();
  }
  return true;
}
