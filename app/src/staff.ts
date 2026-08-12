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
    () =>
      enabled
        ? query(
            collection(db, COLLECTIONS.staffUsers),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'asc'),
          )
        : null,
    [enabled],
    {
      label: 'pendingStaff',
      map: (snap) => snap.docs.map((d) => ({ uid: d.id, ...(d.data() as StaffUserDoc) })),
      empty: [],
    },
  );
}

/** Everyone who is not pending — the running list of who has access. */
export function useDecidedStaff(enabled: boolean): StaffRow[] {
  return useLiveQuery<StaffRow[]>(
    () =>
      enabled
        ? query(
            collection(db, COLLECTIONS.staffUsers),
            where('status', 'in', ['active', 'disabled']),
            orderBy('displayName', 'asc'),
          )
        : null,
    [enabled],
    {
      label: 'decidedStaff',
      map: (snap) => snap.docs.map((d) => ({ uid: d.id, ...(d.data() as StaffUserDoc) })),
      empty: [],
    },
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
