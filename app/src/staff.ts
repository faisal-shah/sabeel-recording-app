import { collection, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type Role, type StaffUserDoc, type UserStatus } from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveQuery } from './liveQuery';

export interface StaffRow extends StaffUserDoc {
  uid: string;
}

/**
 * Staff awaiting approval. Ordered oldest-first: the person who has been waiting
 * longest is the one to deal with next.
 */
export function usePendingStaff(enabled: boolean): StaffRow[] {
  return useLiveQuery<StaffRow[]>(
    'pendingStaff',
    () =>
      enabled
        ? query(
            collection(db, COLLECTIONS.staffUsers),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'asc'),
          )
        : null,
    (snap) => snap.docs.map((d) => ({ uid: d.id, ...(d.data() as StaffUserDoc) })),
    [],
    [enabled],
  );
}

/** Everyone who is not pending — the running list of who has access. */
export function useDecidedStaff(enabled: boolean): StaffRow[] {
  return useLiveQuery<StaffRow[]>(
    'decidedStaff',
    () =>
      enabled
        ? query(
            collection(db, COLLECTIONS.staffUsers),
            where('status', 'in', ['active', 'disabled']),
            orderBy('displayName', 'asc'),
          )
        : null,
    (snap) => snap.docs.map((d) => ({ uid: d.id, ...(d.data() as StaffUserDoc) })),
    [],
    [enabled],
  );
}

/** Admin-only; the callable enforces it regardless of what the UI shows. */
export async function setStaffAccess(input: {
  uid: string;
  role?: Extract<Role, 'admin' | 'manager'>;
  status?: Extract<UserStatus, 'active' | 'disabled'>;
}): Promise<void> {
  await httpsCallable(functions, 'setStaffAccess')(input);
}
