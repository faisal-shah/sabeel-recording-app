// Firebase WEB APP client config — NOT a secret (it ships in every client bundle).
// From Firebase console → Project settings → Your apps → Web app.
//
// These are the REAL `sabeel-class-recordings` values (live since Phase 3).
// Under EXPO_PUBLIC_USE_EMULATORS=1, firebase.ts overrides projectId to the demo
// project and ignores the rest, so a dev/emulator bundle never touches them.
//
// Two things that were got right here, both recorded in docs/DEPLOY.md:
//  - `authDomain` must be the HOSTING domain (<project>.web.app), not
//    firebaseapp.com. Hosting serves /__/auth/* itself, keeping the sign-in
//    redirect same-origin — required in storage-partitioned in-app webviews,
//    where the cross-domain helper dies with "missing initial state".
//  - `storageBucket` must be a modern *.firebasestorage.app bucket in
//    us-central1, us-west1 or us-east1. Only those get the 5 GB-month /
//    100 GB-month no-cost quotas; a legacy appspot.com bucket is capped at
//    1 GB/day of downloads (docs/research/firebase-recording-costs.md).
export const firebaseConfig = {
  apiKey: "AIzaSyB53BouBcPy1_dTi3sCXcDibbCFSWTSBCk",
  // Hosting domain, NOT the console-supplied firebaseapp.com — see the note
  // above. Both are registered as OAuth redirect URIs, so this can be switched
  // back without console work if it ever needs to be.
  authDomain: "sabeel-class-recordings.web.app",
  projectId: "sabeel-class-recordings",
  storageBucket: "sabeel-class-recordings.firebasestorage.app",
  messagingSenderId: "977423479850",
  appId: "1:977423479850:web:ffb551dcf015bd5f33bf53"
};


/**
 * The WEB OAuth client id (client_type: 3) from google-services.json, used by
 * the native Google Sign-In SDK.
 *
 * It must be the *web* client id even on Android — passing the Android one is a
 * classic source of the opaque DEVELOPER_ERROR. Only used by the native seam;
 * the emulator dev sign-in path never reads it.
 */
export const WEB_CLIENT_ID =
  '977423479850-k1r54fn135p62fa165n8gfngbafssv5q.apps.googleusercontent.com';

/**
 * The WEB PUSH public key (VAPID), from Firebase console → Project settings →
 * Cloud Messaging → Web configuration → "Generate key pair".
 *
 * Not a secret: the public half of the pair ships in every client bundle, which
 * is what it is for. Empty until Faisal generates it, and an empty value is
 * handled — `push.web.ts` returns no token and the settings screen says this
 * device cannot receive push, rather than throwing on load.
 */
export const VAPID_PUBLIC_KEY = '';
