// Web side of the completion-durability seam (native sibling:
// completionOutbox.ts).
//
// The browser has a real persistent IndexedDB cache (firestoreInit.web.ts), so a
// completion marked offline already survives a page close and flushes on the
// next load. No outbox is needed: the state write goes straight to Firestore and
// the cache does the durability, and there is nothing to replay on launch.
import { doc, setDoc } from 'firebase/firestore';
import { COLLECTIONS, completionId, type CompletionDoc } from '@sabeel/shared';
import { db } from './firebase';

export async function persistCompletionState(state: CompletionDoc): Promise<void> {
  await setDoc(
    doc(db, COLLECTIONS.completions, completionId(state.studentUid, state.recordingId)),
    state,
  );
}

// Nothing queued outside Firestore's own cache, so nothing to drain.
export async function drainCompletionOutbox(_studentUid: string): Promise<void> {}
