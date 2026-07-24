# Deploy

**The app is live** — web at `sabeel-class-recordings.web.app`, functions and
rules deployed, `.firebaserc` aliased to `sabeel-class-recordings`, and
`firebase-config.ts` holds the real (non-secret) client config. This file records
the order, the traps, and the versioned release cycle so a deploy is never
improvised. (The Android build ships separately — see "Cutting a release".)

## Cutting a release (versioned Android + web)

A release bumps one version and ships it to both surfaces. In order:

1. **Bump the version in BOTH files, together:**
   - `app/app.json` → `expo.version` (drives the sign-in build label and the
     manual cover).
   - `app/android/app/build.gradle` → `versionName` **and** `versionCode` — the
     code MUST increment or Android refuses the upgrade.

   Commit the bump **first**, so the build carries that commit: the sign-in label
   is `v<version> · <commit>`, injected from `EXPO_PUBLIC_COMMIT` (the
   `web:export` / `android` npm scripts inject it; the release gradle build takes
   it from the environment — see below).

2. **Web:** `firebase deploy --only hosting`. The predeploy
   (`scripts/web-release.mjs`) exports the production bundle with the commit
   injected, uploads source maps to Sentry, and strips the `.map` files. Make
   sure `EXPO_PUBLIC_USE_EMULATORS` is **not** set in the shell, or you ship an
   emulator bundle. Verify against the LIVE site (not "Deploy complete"):
   - the commit is inlined in the deployed JS bundle;
   - `EXPO_PUBLIC_USE_EMULATORS` does not appear in the bundle — the emulator path
     is compiled out, so the dev sign-in panel cannot render;
   - a `.map` URL returns `text/html` (the SPA rewrite for a stripped file), not a
     served map — check the CONTENT-TYPE, not the status.

3. **Android:** from `app/android`,
   `EXPO_PUBLIC_COMMIT=$(git rev-parse --short HEAD) ./gradlew assembleRelease`
   — default **JDK 17** (not the emulator's JDK 21), and NO emulator flag (it must
   point at production). `BUILD SUCCESSFUL` is not proof: install
   `app-x86_64-release.apk` on the AVD, launch, and confirm `versionName`, the
   `v<version> · <commit>` label, and — crucially — that the dev sign-in panel is
   **absent** (which proves it is a production build, not an emulator one).

4. **Publish the APKs to BOTH release homes** (never commit an APK — `*.apk` is
   gitignored; committed APKs bloated the sibling pages history and had to be
   rewritten out):
   - **This (source) repo — the versioned archive.** Tag the build commit and cut
     a matching GitHub Release, or the repo's own release history falls behind the
     shipped version (easy to forget, because the public download comes from the
     pages repo — do NOT skip it):
     ```bash
     git tag vX.Y.Z <build-commit> && git push origin vX.Y.Z   # tag first
     gh release create vX.Y.Z -R faisal-shah/sabeel-recording-app \
       --title "vX.Y.Z — Android" --notes-file NOTES.md \
       "…-0.1.2-arm64-v8a.apk#Android — arm64-v8a (most phones, 40 MB)" …
     ```
     Assets are named `sabeel-class-recordings-X.Y.Z-<abi>.apk` (versioned) with a
     per-version changelog. (`gh release create --target <sha>` on a not-yet-tagged
     release 422s; create and push the tag first, then the release.)
   - **Pages repo — the public download.** Upload the same APKs to the rolling
     `recording-latest` release, renamed `sabeel-recording-app-<abi>.apk`, with
     `gh release upload recording-latest … --clobber -R faisal-shah/faisal-shah.github.io`.
     Private-repo release assets are not publicly downloadable — that is the whole
     reason the public download lives on the pages repo.

5. **Bump the download-page version** in
   `faisal-shah.github.io/sabeel-recording-app/index.html` and push. The APK
   filenames are unversioned, so the download link itself never changes.

There is no `npm run release` script yet (the sibling time-tracker has one); this
is the manual recipe until one exists.

## Order

Always: **indexes → rules → functions → hosting.**

```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules
firebase deploy --only storage          # NOT storage:rules — the config has no named target
firebase deploy --only functions        # add --force when functions were renamed/removed (prunes the stale ones)
firebase deploy --only hosting
```

`storage:rules` errors with "Could not find rules for the following storage
targets: rules" — the `storage` block in `firebase.json` is a single unnamed
config, so the target is just `storage`. And a deploy that must delete functions
(e.g. after a rename) aborts in non-interactive mode unless you pass `--force`.

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
