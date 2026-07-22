// Native side of the auth-init seam (web sibling: authInit.web.ts).
// RN has no default persistence in the Firebase JS SDK — it must be wired to
// AsyncStorage at init, before any getAuth() call anywhere. Without it, users
// are signed out every time the app restarts.
import type { FirebaseApp } from 'firebase/app';
import * as fbAuth from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Metro resolves firebase/auth to the react-native build, which exports
// getReactNativePersistence — but the published .d.ts only describes the browser
// build (TS always matches the top-level "types" condition first), so the export
// has to be pulled out past the type system.
const { getReactNativePersistence } = fbAuth as unknown as {
  getReactNativePersistence: (storage: unknown) => fbAuth.Persistence;
};

export function initAuth(app: FirebaseApp): fbAuth.Auth {
  return fbAuth.initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}
