/* eslint-env serviceworker */
/* global importScripts, firebase */
/**
 * Web push service worker.
 *
 * It exists to receive messages while the tab is closed — that is the whole of
 * its job, and it cannot be part of the app bundle: a service worker has to be a
 * separate file served from the origin root, or its scope is limited to the
 * directory it came from.
 *
 * `app/public/` is copied verbatim into `dist-web` by `expo export`, and Firebase
 * Hosting serves a matching real file before applying the `**` → `/index.html`
 * rewrite — so no rewrite exception is needed, but the file must genuinely reach
 * the export. Check the EXPORTED bundle, never the dev server.
 *
 * The compat SDK, deliberately: a service worker has no bundler, and the modular
 * SDK cannot be loaded from a plain `importScripts`. The version is pinned
 * rather than floating, because a worker that fails to parse does not fall back
 * to anything — push simply stops, silently.
 */
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');

// Only the messaging fields matter here; this worker never reads Firestore or
// signs anyone in. `apiKey` and `projectId` are not secrets — they ship in the
// app bundle already.
firebase.initializeApp({
  apiKey: 'AIzaSyB53BouBcPy1_dTi3sCXcDibbCFSWTSBCk',
  projectId: 'sabeel-class-recordings',
  messagingSenderId: '977423479850',
  appId: '1:977423479850:web:ffb551dcf015bd5f33bf53',
});

// Registering messaging is enough: the SDK shows the notification payload
// itself when the page is not in the foreground. A custom onBackgroundMessage
// handler here would produce a SECOND banner alongside the automatic one.
firebase.messaging();
