// Firebase WEB APP client config — NOT a secret (it ships in every client bundle).
// From Firebase console → Project settings → Your apps → Web app.
//
// PLACEHOLDERS. Phase 0 runs entirely against the emulator suite, so no real
// project exists yet; firebase.ts overrides projectId to the demo project under
// EXPO_PUBLIC_USE_EMULATORS=1 and never reads the rest. These are replaced when
// the real Firebase project is created (see TODO.md).
//
// Two things to get right at that point, both recorded in docs/DEPLOY.md:
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
  authDomain: "sabeel-class-recordings.firebaseapp.com",
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
export const WEB_CLIENT_ID = 'PLACEHOLDER.apps.googleusercontent.com';
