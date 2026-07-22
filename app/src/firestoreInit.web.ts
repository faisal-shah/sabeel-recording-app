// Web side of the Firestore-init seam (native sibling: firestoreInit.ts).
//
// The browser HAS IndexedDB, so web gets a real persistent cache: offline
// writes (a completion marked with no network) survive a full page close and
// flush on the next load. `snapshot.metadata.hasPendingWrites` is what the UI
// reads to show "Pending sync" until that flush lands.
//
// `persistentMultipleTabManager` lets several tabs share one cache instead of
// the first tab taking an exclusive lock and the rest failing to initialise —
// the default single-tab manager throws `failed-precondition` in the second tab.
import type { FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

export function initDb(app: FirebaseApp): Firestore {
  return initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}
