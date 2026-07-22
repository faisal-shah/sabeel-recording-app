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
  apiKey: 'PLACEHOLDER',
  authDomain: 'PLACEHOLDER.web.app',
  projectId: 'PLACEHOLDER',
  storageBucket: 'PLACEHOLDER.firebasestorage.app',
  messagingSenderId: 'PLACEHOLDER',
  appId: 'PLACEHOLDER',
};
