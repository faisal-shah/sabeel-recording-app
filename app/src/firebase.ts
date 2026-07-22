import { initializeApp } from 'firebase/app';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { EMULATOR_PROJECT_ID, REGION } from '@sabeel/shared';
import { firebaseConfig } from './firebase-config';
import { USE_EMULATORS, EMULATOR_HOST } from './env';

// Against the emulators, use the emulator's demo project id (what the emulator
// suite and tests run as) so the app reads/writes the same namespace. The
// Firestore and Storage emulators partition by project id, and a mismatch shows
// up as writes that succeed while the client insists the document does not
// exist. The real projectId in firebaseConfig is for production only.
const app = initializeApp(
  USE_EMULATORS ? { ...firebaseConfig, projectId: EMULATOR_PROJECT_ID } : firebaseConfig,
);

export const functions = getFunctions(app, REGION);

if (USE_EMULATORS) {
  connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
}

// Firestore, Storage and Auth are deliberately absent until the phase that
// first reads them (1, 2 and 3 respectively). Initialising a service nothing
// consumes proves nothing and reads as dead code to the knip audit — each one
// arrives with its consumer, and connects to its emulator here at that point.
