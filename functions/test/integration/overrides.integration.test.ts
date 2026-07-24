import { describe, it, beforeAll, beforeEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  effectiveCompletion,
  overrideId,
  type CompletionOverrideDoc,
} from '@sabeel/shared';
import { applyOverride, clearOverride } from '../../src/overrides';

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

const db = () => getFirestore();
const S = 'stu1';
const R = 'rec1';
const CLASS = 'class1';

async function clear() {
  const snap = await db().collection(COLLECTIONS.completionOverrides).get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

const readOverride = async () =>
  (await db().collection(COLLECTIONS.completionOverrides).doc(overrideId(S, R)).get()).data() as
    | CompletionOverrideDoc
    | undefined;

beforeEach(clear);

describe('completion override', () => {
  it('writes a separate override doc and the ledger reads override over student', async () => {
    // Student says NOT complete; staff override says complete.
    await applyOverride('mgr1', { studentUid: S, recordingId: R, completed: true, reason: 'attended live' }, CLASS);

    const ov = await readOverride();
    expect(ov).toMatchObject({
      studentUid: S,
      recordingId: R,
      courseId: CLASS,
      completed: true,
      reason: 'attended live',
      overriddenBy: 'mgr1',
    });

    // The student's own doc is untouched; effective status is the override.
    const eff = effectiveCompletion({ completed: false }, ov ?? null);
    expect(eff).toEqual({ completed: true, source: 'override', reason: 'attended live' });
  });

  it('clearing the override lets effective status fall back to the student', async () => {
    await applyOverride('mgr1', { studentUid: S, recordingId: R, completed: false, reason: 'no' }, CLASS);
    expect(await readOverride()).toBeDefined();

    await clearOverride(S, R);
    expect(await readOverride()).toBeUndefined();
    expect(effectiveCompletion({ completed: true }, null)).toEqual({ completed: true, source: 'student' });
  });
});
