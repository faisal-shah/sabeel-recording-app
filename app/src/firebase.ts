import { initializeApp } from 'firebase/app';
import { connectAuthEmulator } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { EMULATOR_PROJECT_ID, EMULATOR_STORAGE_BUCKET, REGION } from '@sabeel/shared';
import { firebaseConfig } from './firebase-config';
import { initAuth } from './authInit';
import { initDb } from './firestoreInit';
import { USE_EMULATORS, EMULATOR_HOST } from './env';

// Against the emulators, use the emulator's demo project id (what the emulator
// suite and tests run as) so the app reads/writes the same namespace. The
// Firestore and Storage emulators partition by project id, and a mismatch shows
// up as writes that succeed while the client insists the document does not
// exist. The real projectId in firebaseConfig is for production only.
const app = initializeApp(
  USE_EMULATORS
    ? {
        ...firebaseConfig,
        projectId: EMULATOR_PROJECT_ID,
        // The bucket has to be overridden too, not just the project id. Leaving
        // the placeholder here uploads to a bucket the server never looks in,
        // and the only symptom is finalize reporting "no audio found" for a
        // file that uploaded fine.
        storageBucket: EMULATOR_STORAGE_BUCKET,
      }
    : firebaseConfig,
);

// initAuth is a platform seam: React Native has no default persistence in the
// Firebase JS SDK and must be wired to AsyncStorage at init, before any
// getAuth() call anywhere in the app.
export const auth = initAuth(app);
// Platform seam: persistent IndexedDB cache on web, memory cache on native
// (the JS SDK has no native persistence — see firestoreInit.ts). Must be the
// FIRST Firestore call on the app, before any getFirestore elsewhere.
export const db = initDb(app);
export const functions = getFunctions(app, REGION);
export const storage = getStorage(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
  connectStorageEmulator(storage, EMULATOR_HOST, 9199);
}
