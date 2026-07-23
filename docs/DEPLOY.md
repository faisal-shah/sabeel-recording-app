# Deploy

**Nothing is deployed yet.** Phase 0 runs entirely against the emulator suite;
`.firebaserc` has no project alias and `app/src/firebase-config.ts` holds
placeholders. This file records the order and the traps so the first deploy is
not improvised. It is filled out properly in Phase 9.

## Order

Always: **indexes → rules → functions → hosting.**

```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules,storage:rules
firebase deploy --only functions
firebase deploy --only hosting
```

Indexes before rules and functions, because a query that needs a missing index
fails as a *listener error* — visible only as an empty screen and a console
warning. Rules before functions so a new function never runs against permissions
that have not landed.

## First-deploy traps

- **Cloud Build 404 on `@sabeel/shared`.** `firebase deploy` ships only
  `functions/` to Cloud Build, so a private workspace package in its
  `package.json` makes `npm install` 404. Handled: `functions/esbuild.config.mjs`
  inlines `@sabeel/*` and leaves real npm deps external. Verify with
  `grep -c 'require("@sabeel/shared")' functions/lib/index.js` — it must be 0.
- **Eventarc permission denied** on the first deploy of a Firestore-trigger
  function. Propagation lag; retry after a few minutes.
- **Secret Manager 403** for every bound secret on first deploy — grant the
  runtime service account access, then redeploy.
- **`roles/iam.serviceAccountTokenCreator`** must be granted before signed-URL
  minting works. The emulator cannot reproduce its absence (see `TODO.md`).
- **Rules pass locally, queries fail in production.** Emulator rules evaluation
  is not identical; test the real queries after deploying rules.
- **Stale config baked into the web bundle.** `web:export` always passes
  `--clear`: Metro's transform cache can serve a bundle built under different
  `EXPO_PUBLIC_*` values, and an emulator-mode bundle must never ship.

## Hosting

`firebase.json` sets `no-cache` on everything except `/_expo/static/**`, which is
content-hashed and therefore immutable. The `predeploy` hook runs the web export,
so hosting always ships a fresh bundle.

`authDomain` in `firebase-config.ts` must be the **hosting** domain
(`<project>.web.app`), not `firebaseapp.com` — hosting serves `/__/auth/*`
itself, keeping the sign-in redirect same-origin. Without it, sign-in from a
chat-app in-app webview dies with `auth/missing-initial-state`, because those
webviews partition storage and the cross-origin handoff loses its state.
**Register the redirect URI on the OAuth client before flipping `authDomain`**,
or sign-in breaks for everyone in between.

## Sentry source maps

Web source-map upload is wired into the hosting deploy: the predeploy runs
`scripts/web-release.mjs`, which exports **with** source maps, injects Sentry
debug ids, uploads the maps to the `sabeel-recording-web` project, then
**deletes the `.map` files from the deploy dir** so Firebase never serves them
publicly. The shipped JS keeps its debug id, so production errors symbolicate
against the maps in Sentry. Debug ids mean no release/version coordination.

The upload needs the auth token in gitignored `app/android/sentry.properties`
(see `docs/SECRETS.md`); without it the script still builds and strips maps,
just skips the upload — so a fresh clone or CI can deploy, they just won't
upload maps. (CI does not deploy anyway.)

Note a `.map` URL on the live site returns **200 with `text/html`** — that is the
SPA `** → /index.html` rewrite catching a missing file, not a served map. Verify
the *content-type*, not the status, to confirm maps are not leaked.

**Native source maps are deferred to the first release build (Phase 9).** They
need the `@sentry/react-native` Gradle plugin active — which means a `prebuild`
(this is the bare workflow) — and only upload on `assembleRelease`, and there is
no release APK yet. The token is already in place for when that happens; Sentry
reporting itself works on native today, just with minified release stack traces.

## After deploying

"Deployed" is not "working." Load the production URL, sign in, and check the
console. For functions, check the logs for an actual invocation rather than
trusting that the deploy succeeded.

## Android

No EAS. Local Gradle builds with a committed `android/` directory. The APK ships
as a **GitHub Release asset**, never committed to any repo — per-release APKs
bloated the sibling pages repo's history and had to be rewritten out.
