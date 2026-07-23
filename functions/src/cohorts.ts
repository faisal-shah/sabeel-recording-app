import { HttpsError } from 'firebase-functions/v2/https';
import { auditedCall } from './audited';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  deriveEffectiveActive,
  type ClassDoc,
  type CohortDoc,
} from '@sabeel/shared';
import { requireAdmin } from './guards';

export function validateCohortName(data: unknown): string {
  const name = typeof (data as { name?: unknown })?.name === 'string'
    ? (data as { name: string }).name.trim()
    : '';
  if (!name) throw new HttpsError('invalid-argument', 'A cohort name is required.');
  if (name.length > 120) throw new HttpsError('invalid-argument', 'That name is too long.');
  return name;
}

export async function createCohortRecord(callerUid: string, name: string) {
  const doc: CohortDoc = {
    name,
    archived: false,
    createdAt: Date.now(),
    createdBy: callerUid,
  };
  const ref = await getFirestore().collection(COLLECTIONS.cohorts).add(doc);
  return { id: ref.id };
}

// Cohort-level actions are not class-scoped: their audit entries carry no
// classId and are admin-only to read.
export const createCohort = auditedCall('createCohort', async (req) => {
  const uid = requireAdmin(req);
  return createCohortRecord(uid, validateCohortName(req.data));
});

export function validateSetCohortArchived(data: unknown): { cohortId: string; archived: boolean } {
  const d = data as { cohortId?: unknown; archived?: unknown } | null;
  if (typeof d?.cohortId !== 'string' || !d.cohortId) {
    throw new HttpsError('invalid-argument', 'cohortId is required.');
  }
  if (typeof d.archived !== 'boolean') {
    throw new HttpsError('invalid-argument', 'archived must be a boolean.');
  }
  return { cohortId: d.cohortId, archived: d.archived };
}

/**
 * Archive or reactivate a cohort, cascading to every class inside it.
 *
 * The cascade recomputes each class's denormalised `effectiveActive` and
 * **never touches the class's own `archived` flag**. That is precisely what
 * makes the round-trip work: reactivating a cohort restores each class to
 * whatever state it was already in, rather than switching them all on. See
 * `deriveEffectiveActive` in @sabeel/shared, whose tests assert exactly this.
 *
 * Done synchronously here rather than in a Firestore trigger. Clients cannot
 * write these collections at all, so there is nothing for a trigger to defend
 * against — and doing it inline means no propagation lag and one testable path.
 */
export async function applyCohortArchived(input: { cohortId: string; archived: boolean }) {
  const db = getFirestore();
  const cohortRef = db.collection(COLLECTIONS.cohorts).doc(input.cohortId);
  if (!(await cohortRef.get()).exists) throw new HttpsError('not-found', 'No such cohort.');

  const classes = await db
    .collection(COLLECTIONS.classes)
    .where('cohortId', '==', input.cohortId)
    .get();

  const batch = db.batch();
  batch.update(cohortRef, { archived: input.archived });
  for (const cls of classes.docs) {
    const data = cls.data() as ClassDoc;
    batch.update(cls.ref, {
      effectiveActive: deriveEffectiveActive(input.archived, data.archived),
    });
  }
  await batch.commit();

  return { cohortId: input.cohortId, archived: input.archived, classesUpdated: classes.size };
}

export const setCohortArchived = auditedCall('setCohortArchived', async (req) => {
  requireAdmin(req);
  return applyCohortArchived(validateSetCohortArchived(req.data));
});
