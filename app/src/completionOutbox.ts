// Native side of the completion-durability seam (web sibling:
// completionOutbox.web.ts).
//
// WHY THIS EXISTS: on native the Firebase JS SDK has only a MEMORY cache (no
// IndexedDB — see firestoreInit.ts). A completion marked offline is queued in
// memory and flushes fine if the app stays open until reconnect — but a
// force-kill before reconnect loses it, and the student would reopen to find
// their completion silently reverted. That is exactly the "offline queue that
// never drains looks like one that works" failure the brief warns about.
//
// So on native, the completion STATE write goes through a small AsyncStorage
// outbox: record intent durably, fire the write, and remove the record only
// once the server acknowledges. On launch, whatever is still in the outbox is
// replayed. This is NOT a bespoke sync engine — it is a durability shim over the
// SAME direct Firestore write, idempotent because the completion doc id is
// deterministic (`${studentUid}_${recordingId}`).
//
// Only the current-state doc is outboxed. The append-only completionEvents are
// best-effort audit: a force-kill may drop one event, but the state — which
// carries `completedAt` — is preserved, and replaying events would duplicate
// them (they have generated ids).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, setDoc } from 'firebase/firestore';
import { COLLECTIONS, completionId, type CompletionDoc } from '@sabeel/shared';
import { db } from './firebase';
import { captureError } from './sentry';

const KEY = 'sabeel.completionOutbox.v1';

async function readAll(): Promise<Record<string, CompletionDoc>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, CompletionDoc>) : {};
  } catch {
    return {};
  }
}

async function writeAll(map: Record<string, CompletionDoc>): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(map));
}

async function forget(id: string): Promise<void> {
  const map = await readAll();
  if (id in map) {
    delete map[id];
    await writeAll(map);
  }
}

/**
 * Fire the completion write, but keep a durable copy until the server confirms.
 * `setDoc` resolves only on server ack, so its resolution is the signal to
 * forget the outbox entry; offline it never resolves and the entry survives an
 * app kill.
 */
function fireAndForget(id: string, state: CompletionDoc): void {
  void setDoc(doc(db, COLLECTIONS.completions, id), state)
    .then(() => forget(id))
    .catch((e: { code?: string }) => {
      /*
       * A REFUSAL IS FINAL; ANYTHING ELSE IS WORTH RETRYING.
       *
       * Retrying everything means an entry the server will never accept is
       * re-sent on every launch for the life of the install. The reachable case
       * is small but real: mark complete offline, the app is killed before it
       * syncs, and the recording is permanently deleted in the meantime — the
       * cascade takes the assignment with it, so the rule can no longer find the
       * grant the write has to name. There is nothing left to write it against.
       *
       * Everything else — offline, a dropped connection, a server hiccup — keeps
       * the entry, which is the whole point of the outbox.
       */
      if (e?.code !== 'permission-denied') return;
      /*
       * REPORTED, because this is the one path that throws away a student's own
       * record of having finished a lecture. Silent, it looks to them like the
       * app forgot: the native SDK's cache is memory-only, so after an app kill
       * there is no local copy either, and the recording simply reads as
       * incomplete again with nothing anywhere saying why.
       */
      captureError(e, { source: 'completionOutbox', outboxId: id });
      void forget(id);
    });
}

/** Persist a completion state durably (native path). */
export async function persistCompletionState(state: CompletionDoc): Promise<void> {
  const id = completionId(state.studentUid, state.recordingId);
  const map = await readAll();
  map[id] = state;
  await writeAll(map);
  fireAndForget(id, state);
}

/**
 * Replay any completion writes that never confirmed. Called on launch once a
 * student is signed in — scoped to that uid so a shared device never tries to
 * write one student's completion under another's auth (the rules would deny it,
 * and it would wedge the outbox).
 */
export async function drainCompletionOutbox(studentUid: string): Promise<void> {
  const map = await readAll();
  for (const [id, state] of Object.entries(map)) {
    if (state.studentUid === studentUid) fireAndForget(id, state);
  }
}
