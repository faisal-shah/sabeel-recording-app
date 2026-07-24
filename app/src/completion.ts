import { addDoc, collection, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  type AssignmentDoc,
  type CompletionDoc,
  type CompletionEventDoc,
} from '@sabeel/shared';
import { db } from './firebase';
import { useLiveQuery } from './liveQuery';
import { persistCompletionState } from './completionOutbox';

export interface AssignmentRow extends AssignmentDoc {
  id: string;
}

/** Completion state for one recording, from the student's own point of view. */
export interface CompletionState {
  completed: boolean;
  /** The write has not yet reached the server — shown as "Pending sync". */
  pending: boolean;
}

/**
 * The student's active obligations. Self-constrained, as the rule requires.
 */
export function useMyAssignments(uid: string | null): AssignmentRow[] {
  return useLiveQuery<AssignmentRow[]>(
    'myAssignments',
    () =>
      uid
        ? query(
            collection(db, COLLECTIONS.assignments),
            where('studentUid', '==', uid),
            where('active', '==', true),
          )
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as AssignmentDoc) })),
    [],
    [uid],
  );
}

/**
 * The student's completion state, keyed by recordingId.
 *
 * Subscribes with metadata changes so a completion marked offline flips from
 * `pending: true` to `pending: false` on screen the moment it syncs — the
 * "Pending sync" badge would otherwise stick forever.
 */
export function useMyCompletions(uid: string | null): Map<string, CompletionState> {
  return useLiveQuery<Map<string, CompletionState>>(
    'myCompletions',
    () =>
      uid
        ? query(collection(db, COLLECTIONS.completions), where('studentUid', '==', uid))
        : null,
    (snap) => {
      const map = new Map<string, CompletionState>();
      for (const d of snap.docs) {
        const data = d.data() as CompletionDoc;
        map.set(data.recordingId, {
          completed: data.completed,
          pending: d.metadata.hasPendingWrites,
        });
      }
      return map;
    },
    new Map(),
    [uid],
    true, // includeMetadataChanges — needed for the pending→synced transition
  );
}

/**
 * One recording's completion state, for the player. Live (with metadata) so the
 * Pending-sync state and cross-device completion both reflect immediately.
 */
export function useCompletion(uid: string | null, recordingId: string): CompletionState {
  return useLiveQuery<CompletionState>(
    'completion',
    () =>
      uid
        ? query(
            collection(db, COLLECTIONS.completions),
            where('studentUid', '==', uid),
            where('recordingId', '==', recordingId),
          )
        : null,
    (snap) => {
      const d = snap.docs[0];
      if (!d) return { completed: false, pending: false };
      return {
        completed: (d.data() as CompletionDoc).completed,
        pending: d.metadata.hasPendingWrites,
      };
    },
    { completed: false, pending: false },
    [uid, recordingId],
    true,
  );
}

/**
 * Mark or unmark a recording complete.
 *
 * Two writes, both direct to Firestore rather than through a callable — the
 * whole point is that this works OFFLINE, which a callable cannot. The
 * persistent cache queues them and `hasPendingWrites` surfaces as "Pending
 * sync" until they flush.
 *
 * The current-state doc drives the UI and reporting; the appended event is the
 * append-only audit trail. The "never played" gate is enforced by the caller
 * (the player disables the control) — deliberately NOT in the rules, because a
 * rule requiring the progress doc would false-reject a completion whose queued
 * progress write has not synced yet.
 */
export async function setCompleted(
  studentUid: string,
  recordingId: string,
  courseId: string,
  completed: boolean,
): Promise<void> {
  const now = Date.now();
  const state: CompletionDoc = {
    studentUid,
    recordingId,
    courseId,
    completed,
    completedAt: completed ? now : null,
    updatedAt: now,
  };
  const event: CompletionEventDoc = {
    studentUid,
    recordingId,
    courseId,
    action: completed ? 'complete' : 'uncomplete',
    actor: 'student',
    at: now,
  };
  // The STATE write goes through the durability seam (a native AsyncStorage
  // outbox; a plain setDoc on web). Not awaited: offline it would not resolve
  // until sync and would hang the caller. The event is best-effort audit.
  void persistCompletionState(state);
  void addDoc(collection(db, COLLECTIONS.completionEvents), event);
}
