import { HttpsError } from 'firebase-functions/v2/https';
import { reportedCall } from './reported';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  deriveEffectiveActive,
  type ClassDoc,
  type CohortDoc,
  type StaffUserDoc,
} from '@sabeel/shared';
import { requireAdmin } from './guards';

export interface CreateClassInput {
  cohortId: string;
  name: string;
}

export function validateCreateClass(data: unknown): CreateClassInput {
  const d = data as { cohortId?: unknown; name?: unknown } | null;
  if (typeof d?.cohortId !== 'string' || !d.cohortId) {
    throw new HttpsError('invalid-argument', 'cohortId is required.');
  }
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (!name) throw new HttpsError('invalid-argument', 'A class name is required.');
  if (name.length > 120) throw new HttpsError('invalid-argument', 'That name is too long.');
  return { cohortId: d.cohortId, name };
}

export async function createClassRecord(callerUid: string, input: CreateClassInput) {
  const db = getFirestore();
  const cohortSnap = await db.collection(COLLECTIONS.cohorts).doc(input.cohortId).get();
  if (!cohortSnap.exists) throw new HttpsError('not-found', 'No such cohort.');
  const cohort = cohortSnap.data() as CohortDoc;

  const doc: ClassDoc = {
    cohortId: input.cohortId,
    name: input.name,
    archived: false,
    // Seeded from the cohort: a class created inside an archived cohort is
    // inactive from birth, without anyone having to remember to run a cascade.
    effectiveActive: deriveEffectiveActive(cohort.archived, false),
    // Archiving turns student access off unless staff explicitly say otherwise.
    archivedAccess: false,
    managerUids: [],
    createdAt: Date.now(),
    createdBy: callerUid,
  };
  const ref = await db.collection(COLLECTIONS.classes).add(doc);
  return { id: ref.id };
}

export const createClass = reportedCall(async (req) => {
  const uid = requireAdmin(req);
  return createClassRecord(uid, validateCreateClass(req.data));
});

export interface UpdateClassInput {
  classId: string;
  name?: string;
  archived?: boolean;
  archivedAccess?: boolean;
}

export function validateUpdateClass(data: unknown): UpdateClassInput {
  const d = data as UpdateClassInput | null;
  if (typeof d?.classId !== 'string' || !d.classId) {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }
  const out: UpdateClassInput = { classId: d.classId };
  if (d.name !== undefined) {
    const name = typeof d.name === 'string' ? d.name.trim() : '';
    if (!name) throw new HttpsError('invalid-argument', 'A class name cannot be empty.');
    out.name = name;
  }
  if (d.archived !== undefined) {
    if (typeof d.archived !== 'boolean') {
      throw new HttpsError('invalid-argument', 'archived must be a boolean.');
    }
    out.archived = d.archived;
  }
  if (d.archivedAccess !== undefined) {
    if (typeof d.archivedAccess !== 'boolean') {
      throw new HttpsError('invalid-argument', 'archivedAccess must be a boolean.');
    }
    out.archivedAccess = d.archivedAccess;
  }
  if (out.name === undefined && out.archived === undefined && out.archivedAccess === undefined) {
    throw new HttpsError('invalid-argument', 'Nothing to change.');
  }
  return out;
}

export async function applyClassUpdate(input: UpdateClassInput) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.classes).doc(input.classId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such class.');
  const current = snap.data() as ClassDoc;

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.archivedAccess !== undefined) update.archivedAccess = input.archivedAccess;

  if (input.archived !== undefined) {
    update.archived = input.archived;
    // The cohort is the other half of the derivation, so it has to be read —
    // a class archived inside an archived cohort must stay inactive.
    const cohortSnap = await db.collection(COLLECTIONS.cohorts).doc(current.cohortId).get();
    const cohortArchived = (cohortSnap.data() as CohortDoc | undefined)?.archived ?? false;
    update.effectiveActive = deriveEffectiveActive(cohortArchived, input.archived);
  }

  await ref.update(update);
  return { classId: input.classId, ...update };
}

export const updateClass = reportedCall(async (req) => {
  requireAdmin(req);
  return applyClassUpdate(validateUpdateClass(req.data));
});

export interface SetClassManagersInput {
  classId: string;
  managerUids: string[];
}

export function validateSetClassManagers(data: unknown): SetClassManagersInput {
  const d = data as { classId?: unknown; managerUids?: unknown } | null;
  if (typeof d?.classId !== 'string' || !d.classId) {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }
  if (!Array.isArray(d.managerUids) || d.managerUids.some((u) => typeof u !== 'string' || !u)) {
    throw new HttpsError('invalid-argument', 'managerUids must be an array of uids.');
  }
  // De-duplicate: a repeated uid would not grant anything twice, but it makes
  // the array a poor answer to "who manages this class?".
  return { classId: d.classId, managerUids: [...new Set(d.managerUids as string[])] };
}

/**
 * Replace the set of managers scoped to a class.
 *
 * Every uid is checked against `staffUsers` first. `managerUids` is not a label
 * — the security rules read it directly, so writing an invented or disabled uid
 * into it *is* granting access. Validating here is the only place that can be
 * caught, since clients cannot write the collection at all.
 */
export async function applyClassManagers(input: SetClassManagersInput) {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.classes).doc(input.classId);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'No such class.');

  const checks = await Promise.all(
    input.managerUids.map((uid) => db.collection(COLLECTIONS.staffUsers).doc(uid).get()),
  );
  checks.forEach((snap, i) => {
    const staff = snap.data() as StaffUserDoc | undefined;
    if (!snap.exists || staff?.status !== 'active') {
      throw new HttpsError(
        'failed-precondition',
        `${input.managerUids[i]} is not an active staff member.`,
      );
    }
  });

  await ref.update({ managerUids: input.managerUids });
  return { classId: input.classId, managerUids: input.managerUids };
}

export const setClassManagers = reportedCall(async (req) => {
  requireAdmin(req);
  return applyClassManagers(validateSetClassManagers(req.data));
});
