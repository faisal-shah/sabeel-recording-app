import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CompletionDoc } from '@sabeel/shared';

/**
 * The native outbox's two promises: what is replayed never overwrites a newer
 * state, and an acknowledgement only forgets the entry it acknowledged.
 *
 * AsyncStorage is an in-memory map; Firestore is a map of documents with a
 * `setDoc` that can be held open, so the window between two queued writes is
 * reachable — that window is where the un-mark was being lost.
 */
const storage = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => storage.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      storage.set(k, v);
    },
  },
}));

const docs = new Map<string, object>();
type Held = { resolve: () => void; reject: (e: unknown) => void };
const held: Held[] = [];
let holdSet = false;
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  setDoc: (ref: { path: string }, value: object) => {
    docs.set(ref.path, value);
    if (!holdSet) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      held.push({ resolve, reject });
    });
  },
  runTransaction: async (
    _db: unknown,
    fn: (tx: {
      get: (ref: { path: string }) => Promise<{ data: () => object | undefined }>;
      set: (ref: { path: string }, value: object) => void;
    }) => Promise<void>,
  ) => {
    await fn({
      get: async (ref) => ({ data: () => docs.get(ref.path) }),
      set: (ref, value) => {
        docs.set(ref.path, value);
      },
    });
  },
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./sentry', () => ({ captureError: vi.fn() }));

const KEY = 'sabeel.completionOutbox.v1';
const outbox = () => JSON.parse(storage.get(KEY) ?? '{}') as Record<string, CompletionDoc>;
const state = (completed: boolean, updatedAt: number): CompletionDoc => ({
  studentUid: 'stu-1',
  recordingId: 'rec-1',
  courseId: 'crs-1',
  completed,
  completedAt: completed ? updatedAt : null,
  updatedAt,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  storage.clear();
  docs.clear();
  held.length = 0;
  holdSet = false;
  vi.resetModules();
});

describe('the completion outbox', () => {
  it('replays a queued mark — the normal case, an app killed before it synced', async () => {
    storage.set(KEY, JSON.stringify({ 'stu-1_rec-1': state(true, 100) }));
    const { drainCompletionOutbox } = await import('./completionOutbox');
    await drainCompletionOutbox('stu-1');
    await flush();
    await flush();
    expect(docs.get('completions/stu-1_rec-1')).toMatchObject({ completed: true, updatedAt: 100 });
    expect(outbox()).toEqual({});
  });

  it('yields to a newer state written elsewhere, and forgets the stale entry', async () => {
    // Un-marked on the web at 200 while the phone still held a mark from 100.
    docs.set('completions/stu-1_rec-1', state(false, 200));
    storage.set(KEY, JSON.stringify({ 'stu-1_rec-1': state(true, 100) }));
    const { drainCompletionOutbox } = await import('./completionOutbox');
    await drainCompletionOutbox('stu-1');
    await flush();
    await flush();
    expect(docs.get('completions/stu-1_rec-1')).toMatchObject({ completed: false, updatedAt: 200 });
    expect(outbox()).toEqual({});
  });

  it("keeps the un-mark when the earlier mark's acknowledgement comes back first", async () => {
    holdSet = true;
    const { persistCompletionState } = await import('./completionOutbox');
    await persistCompletionState(state(true, 100)); // mark
    await persistCompletionState(state(false, 200)); // then un-mark, both still queued
    expect(outbox()['stu-1_rec-1']).toMatchObject({ completed: false, updatedAt: 200 });
    held[0].resolve(); // the mark is acknowledged
    await flush();
    await flush();
    // The un-mark is still owed to the server, so it is still in the outbox.
    expect(outbox()['stu-1_rec-1']).toMatchObject({ completed: false, updatedAt: 200 });
    held[1].resolve();
    await flush();
    await flush();
    expect(outbox()).toEqual({});
  });

  it('does not lose one recording\'s entry while another is being written', async () => {
    holdSet = true;
    const { persistCompletionState } = await import('./completionOutbox');
    await Promise.all([
      persistCompletionState(state(true, 100)),
      persistCompletionState({ ...state(true, 100), recordingId: 'rec-2' }),
    ]);
    expect(Object.keys(outbox()).sort()).toEqual(['stu-1_rec-1', 'stu-1_rec-2']);
  });

  it('drops an entry the server will never accept, and keeps one it merely could not reach', async () => {
    const { captureError } = await import('./sentry');
    holdSet = true;
    const { persistCompletionState } = await import('./completionOutbox');
    await persistCompletionState(state(true, 100));
    held[0].reject({ code: 'unavailable' });
    await flush();
    expect(outbox()['stu-1_rec-1']).toBeDefined();
    await persistCompletionState({ ...state(true, 100), recordingId: 'rec-2' });
    held[1].reject({ code: 'permission-denied' });
    await flush();
    await flush();
    expect(outbox()['stu-1_rec-2']).toBeUndefined();
    expect(captureError).toHaveBeenCalled();
  });
});
