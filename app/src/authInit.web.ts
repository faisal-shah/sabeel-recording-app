// Web side of the auth-init seam (native sibling: authInit.ts).
import type { FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

export function initAuth(app: FirebaseApp): Auth {
  return getAuth(app); // browserLocalPersistence by default
}
