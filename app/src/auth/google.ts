import {
  GoogleSignin,
  statusCodes,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { WEB_CLIENT_ID } from '../firebase-config';
import { auth } from '../firebase';

/**
 * Staff Google sign-in on Android (web sibling: google.web.ts).
 *
 * Uses the native Google Sign-In SDK to obtain an ID token, then exchanges it
 * for a Firebase credential — the same signInWithCredential path devSignIn
 * exercises, so everything downstream of the session is identical.
 *
 * Requires BOTH of these, or Google returns an opaque DEVELOPER_ERROR that looks
 * like a code bug and is not:
 *  - the debug/release SHA-1 registered on the Firebase Android app, with
 *    `google-services.json` RE-DOWNLOADED afterwards — the re-download is what
 *    adds the `client_type: 1` entry; adding the SHA-1 in the console does not
 *    update a file you already have;
 *  - `webClientId` set to the WEB client id (client_type: 3), not the Android one.
 */
let configured = false;
function ensureConfigured() {
  if (configured) return;
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
  configured = true;
}

/**
 * Clear the remembered Google account.
 *
 * Without this the next signIn() silently reuses the previous account with no
 * way to switch users — on a shared or handed-over device that is the difference
 * between signing out and only appearing to.
 */
export async function googleSignOut(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.signOut().catch(() => undefined);
}

export async function signInWithGoogle(): Promise<void> {
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return; // user backed out
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google returned no ID token.');
    await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  } catch (e) {
    const code = (e as { code?: string }).code;
    // Cancelling is not an error — see the web sibling for why this matters.
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return;
    throw e;
  }
}
