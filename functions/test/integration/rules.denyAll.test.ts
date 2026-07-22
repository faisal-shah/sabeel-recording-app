import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { COLLECTIONS, EMULATOR_PROJECT_ID } from '@sabeel/shared';

/**
 * Phase 0: prove the deny-all baseline on BOTH Firestore and Storage.
 *
 * A suite that only asserts denials still earns its place — it proves the rules
 * harness runs, which is the thing later phases depend on. Storage rules in
 * particular have no reference implementation in the sibling Sabeel repos
 * (kanban refused a bucket outright, the time tracker has none), so this is
 * where that wiring is established.
 */

let testEnv: RulesTestEnvironment;

/** `host:port` from the emulator env var the CLI exports, with a local default. */
function hostPort(envValue: string | undefined, fallbackPort: number) {
  const [host, port] = (envValue ?? `127.0.0.1:${fallbackPort}`).split(':');
  // Literal 127.0.0.1, never 'localhost': the emulators bind IPv4 only, while
  // 'localhost' can resolve to IPv6 ::1 first and fail at connect.
  return { host: host || '127.0.0.1', port: Number(port) };
}

beforeAll(async () => {
  const fs = hostPort(process.env.FIRESTORE_EMULATOR_HOST, 8080);
  const st = hostPort(process.env.FIREBASE_STORAGE_EMULATOR_HOST, 9199);
  testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      ...fs,
      rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      ...st,
      rules: readFileSync(new URL('../../../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const signedIn = () => testEnv.authenticatedContext('someone');
const anon = () => testEnv.unauthenticatedContext();

describe('firestore rules: deny-all baseline', () => {
  // Every collection the product will eventually use. Adding a collection to
  // @sabeel/shared without opening it in the rules should keep failing here,
  // which is exactly the behaviour we want between now and Phase 1.
  const names = Object.values(COLLECTIONS);

  it('denies reads to a signed-in user', async () => {
    const db = signedIn().firestore();
    for (const name of names) {
      await assertFails(getDocs(collection(db, name)));
    }
  });

  it('denies writes to a signed-in user', async () => {
    const db = signedIn().firestore();
    for (const name of names) {
      await assertFails(setDoc(doc(db, name, 'x'), { any: 'thing' }));
    }
  });

  it('denies an anonymous read', async () => {
    const db = anon().firestore();
    await assertFails(getDoc(doc(db, COLLECTIONS.recordings, 'x')));
  });
});

describe('storage rules: deny-all baseline', () => {
  const audioPath = 'recordings/rec123/audio.m4a';
  const bytes = () => new Uint8Array([0, 1, 2, 3]);

  it('denies a signed-in user uploading', async () => {
    const storage = signedIn().storage();
    await assertFails(uploadBytes(ref(storage, audioPath), bytes()));
  });

  it('denies a signed-in user reading', async () => {
    // Seed past the rules so the object genuinely exists — otherwise a denial
    // could just be "not found" and the test would prove nothing.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), audioPath), bytes());
    });
    const storage = signedIn().storage();
    await assertFails(getDownloadURL(ref(storage, audioPath)));
  });

  it('denies an anonymous read', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), audioPath), bytes());
    });
    await assertFails(getDownloadURL(ref(anon().storage(), audioPath)));
  });
});
