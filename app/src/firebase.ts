import { initializeApp } from 'firebase/app';
import { connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { EMULATOR_PROJECT_ID, REGION } from '@sabeel/shared';
import { firebaseConfig } from './firebase-config';
import { initAuth } from './authInit';
import { USE_EMULATORS, EMULATOR_HOST } from './env';

// Against the emulators, use the emulator's demo project id (what the emulator
// suite and tests run as) so the app reads/writes the same namespace. The
// Firestore and Storage emulators partition by project id, and a mismatch shows
// up as writes that succeed while the client insists the document does not
// exist. The real projectId in firebaseConfig is for production only.
const app = initializeApp(
  USE_EMULATORS ? { ...firebaseConfig, projectId: EMULATOR_PROJECT_ID } : firebaseConfig,
);

// initAuth is a platform seam: React Native has no default persistence in the
// Firebase JS SDK and must be wired to AsyncStorage at init, before any
// getAuth() call anywhere in the app.
export const auth = initAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, REGION);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
}

// Storage arrives in Phase 3, with the first upload.
