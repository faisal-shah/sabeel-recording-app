# Deploy

**The app is live** — web at `sabeel-class-recordings.web.app`, functions and
rules deployed, `.firebaserc` aliased to `sabeel-class-recordings`, and
`firebase-config.ts` holds the real (non-secret) client config. This file records
the order, the traps, and the versioned release cycle so a deploy is never
improvised. (The Android build ships separately — see "Cutting a release".)

## The device pass, before any of it

**Mandatory, and it comes first** — `CLAUDE.md` requires a real Android pass
before every release, and it is the only thing in this project that can. The web
suites cover layout, flows, rules, data and copy; they cannot reach the seams
below, and this app leans on them harder than its siblings because its whole
subject is long audio.

### It takes TWO builds, and conflating them costs you seams

**The release APK proves the artifact.** Only it can show that what ships is a
production build — `versionName`, the `v<version> · <commit>` label, and the
**absent** dev sign-in panel — and only it, pointed at production, can exercise
signed-URL minting, real FCM delivery and the deployed rules. There is no FCM in
an emulator.

**And it is the worst possible build for everything else.** It has no dev
sign-in row, so staff are a Google identity you must hold real credentials for;
and it can only show you the data production happens to hold that day, which may
be no open grant at all — and therefore no playable audio, on the release of an
audio app.

**A debug build against the emulator suite reaches all of that.**
`app/src/auth/devSignIn.ts` mints staff identities straight through the Auth
emulator, and `scripts/lib/seed-world.mjs` hands you an admin, a manager, a
disabled student, deliberately long names and an **open, incomplete** assignment
on demand. The rows below are Yoga, the IME, gestures and the offline outbox:
native behaviours that do not care whether the backend is production or an
emulator.

So: run the release APK for the rows marked **release**, and a debug build for
the rest. "Do the device pass on the release APK" means *prove the shipped
artifact with the shipped artifact*. It has never meant that the release APK is
the only build allowed on the device, and reading it that way silently converts
every seam it cannot reach into a seam nobody checks — which is exactly what
happened on 2026-09-07, and is how the course header below reached production.

**Never bend production to reach a seam.** Re-seeding the live project or moving
a real due date to open a grant is a production write standing in for a build you
could have run for free.

| Seam | Build | What to actually do |
|---|---|---|
| **Build identity** | release | `versionName` matches `app.json`, the sign-in label reads `v<version> · <commit>`, and the dev sign-in panel is **absent** |
| **Push** | release | Confirm a notification arrives, carries the app's own icon under the `sabeel-alerts` channel rather than "Miscellaneous", and opens the right screen |
| **Playback reaches the audio** | release | A signed URL is minted against production and the recording actually plays |
| **Background audio** | either | Start a recording, leave the app, confirm it keeps playing and the notification shows the right title |
| **Lock screen** | either | Pause, resume, and seek from the lock-screen controls |
| **Seek and rate** | either | Scrub a long recording; change the rate; confirm the position survives both |
| **Resume** | either | Kill the app mid-recording, reopen, confirm it resumes where it was |
| **Offline** | debug | Turn the network off: mark a recording complete, confirm "Pending sync", restore the network, confirm it clears — needs an **incomplete** grant, which the seeded world has and production may not |
| **Staff screens** | debug | Today's queue, the not-recorded control, the notification switches, the attendance report — staff sign-in needs the dev row |
| **Keyboard** | debug | Every text field: the field stays visible above the keyboard |
| **Gestures** | debug | Long-press and swipe paths |
| **Safe area** | either | Notch and gesture bar (the app is `screenOrientation="portrait"`, so there is only one orientation to check) |
| **Flex/wrap** | debug | Long class and student names — Yoga defaults `flexShrink` to 0, and a real device is the only place that shows. The seeded world carries names chosen to break this |

A screenshot is not the check for any row above except the last two.

### Running the debug half

Two rules decide the shape of this, and both were learned by getting them wrong:

- **`EXPO_PUBLIC_USE_EMULATORS` is read from the environment that started
  METRO**, not from the APK.
- **Do NOT reach for `expo run:android --no-bundler`** to reuse a dev server you
  started yourself. The app builds, installs, signs in and looks completely
  healthy — and never picks up another source edit. Metro logs the rebuild, the
  served bundle contains the change, and the device goes on rendering the old
  one, so every "the fix did not work" reading is a lie. Let `expo run:android`
  start its own Metro.

The seed needs a web dev server (staff are Google identities the Admin SDK
cannot mint, so `seedWorld` drives the app's own dev sign-in row and lets
`onUserCreate` provision them). So seed first, stop that server, then hand the
port to `run:android`:

```sh
scripts/emulator.sh headless &                                  # the AVD
bash scripts/free-emulator-ports.sh
npm run build -w @sabeel/shared && npm run build -w functions    # the emulator loads functions/lib
npx firebase emulators:start --project demo-sabeel-recordings \
  --only firestore,auth,storage,functions                       # leave running

( cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --web --port 8081 --clear ) &
npm run seed:emulators        # prints the student's credentials and the fixture ids
kill %2                       # release 8081

( cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo run:android )   # its own Metro
```

The emulators bind loopback, which the AVD reaches as `10.0.2.2` — already wired
in `app/src/env.ts`. And `adb root` drops every `adb reverse` mapping, so avoid
it while a debug build is attached, or restore the mapping afterwards.

## Cutting a release (versioned Android + web)

A release bumps one version and ships it to both surfaces. In order:

0. **Run the two production checks**, which nothing else runs — they
   authenticate against the live project, so neither CI nor the emulator suite
   can: `npm run check:queries` (every query shape the app sends, against the
   real indexes) and `npm run check:push` (FCM credentials and the VAPID key).
   See `docs/DEV-TOOLING.md`.

1. **Bump the version in BOTH files, together:**
   - `app/app.json` → `expo.version` (drives the sign-in build label and the
     manual cover).
   - `app/android/app/build.gradle` → `versionName` **and** `versionCode` — the
     code MUST increment or Android refuses the upgrade.

   `functions/test/unit/appVersion.test.ts` fails if the two `versionName`s
   diverge, so forgetting one is caught by `npm test` rather than on a device.

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

5. **Update the download page** in
   `faisal-shah.github.io/sabeel-recording-app/` and push. The APK filenames are
   unversioned, so the download link itself never changes — but three things do:
   - the **version and publish date** in `index.html`;
   - the **What's new** list — a handful of plain-language lines, no jargon. This
     is the only release note most people ever read;
   - **`USER-MANUAL.pdf`**, copied from `docs/USER-MANUAL.pdf`. It is a SEPARATE
     COPY, not a link, so it does not follow the repo automatically. Skipping this
     is invisible — the page keeps serving an older manual quite happily, and it
     had drifted three versions behind before anyone looked:
     ```bash
     cp docs/USER-MANUAL.pdf ../faisal-shah.github.io/sabeel-recording-app/
     ```
     Verify the published copy, not the local one:
     `pdftotext -f 1 -l 1 USER-MANUAL.pdf - | grep -i version`

There is no `npm run release` script yet (the sibling time-tracker has one); this
is the manual recipe until one exists.

## Demo data in the live project

There is a pair of scripts for filling production with a realistic dataset to look
at the reports with, and for taking it out again:

```bash
node scripts/seed-demo-prod.mjs     # 3 cohorts, 8 courses, 50 students, ~80 sessions
node scripts/wipe-demo-prod.mjs     # DRY RUN — prints the plan, deletes nothing
node scripts/wipe-demo-prod.mjs --yes
```

**If you are asked to "clean up the demo data", that second command is the whole
job** — there is nothing else to undo. The seed changed no application code,
deployed no functions, and touched no rules; it wrote to Firestore/Auth/Storage
with the Admin SDK, which needs no loosening of anything.

Read the header of `wipe-demo-prod.mjs` before running it with `--yes`. Two things
are easy to get wrong if you reimplement the cleanup by hand instead:

- **The `demoSeed` flag is not sufficient.** The fan-out assignments, any
  listening progress and audit rows generated by playing a demo recording, and
  anything *you* created inside a demo course carry no flag. The script also
  sweeps by reference (`demo-rec-` / `demo-stu-` / `demo-crs-` / `demo-ses-`).
- **Storage is keyed on the recordings actually removed**, not on a path prefix —
  a recording added inside a demo course has an ordinary random id, and its audio
  would otherwise be stranded in the bucket, billable, forever.

## Order

Always: **indexes → rules → functions → hosting.**

```bash
firebase deploy --only firestore:indexes
firebase deploy --only firestore:rules
firebase deploy --only storage          # NOT storage:rules — the config has no named target
firebase deploy --only functions        # add --force when functions were renamed/removed (prunes the stale ones)
firebase deploy --only hosting
```

### `accountExists` must be LIVE before an APK that calls it ships

The native Google door asks `accountExists` before it will exchange a credential,
so on a build that has the gate, a missing callable is not a degraded sign-in —
**it is no staff sign-in at all**. The order is therefore not just a deploy
convention:

1. `firebase deploy --only functions` (the callable),
2. *then* build and publish the APK.

The web app is unaffected either way — `google.web.ts` has no gate and creates
accounts as it always has — so a hosting deploy carries no such constraint. And
the reverse mistake is harmless: the callable can sit deployed and uncalled for
as long as you like, which is why it is worth deploying it early rather than in
the same rush as a release.

### One-off: the excused-only migration (2026-08-14)

The switch to excused-only access needs one data step, and it goes **after
functions and before hosting**:

```bash
node scripts/migrate-excused-only.mjs --dry-run   # read the counts first
node scripts/migrate-excused-only.mjs
```

It backfills the due dates that became required and then touches every session,
letting the deployed `onSessionWritten` re-derive the grants and write each
student's attendance projection. Running it against the OLD functions would
faithfully re-create the very grants it exists to remove, and report success
doing so — hence the position in the order. Hosting goes last so no student sees
the new screens against un-migrated data.

### One-off: the `notRecorded` rename (v0.5.0)

`sessions.archived` became `sessions.notRecorded`, which is the field the new
"This class was not recorded" control writes. It goes **after functions**, and
its position is the only thing that matters — hosting can come before or after:

```bash
node scripts/migrate-not-recorded.mjs --dry-run   # read the counts first
node scripts/migrate-not-recorded.mjs
```

Unlike the excused-only migration this changes no behaviour and wakes no
trigger. Both readers of the field test truthiness, so a session carrying
neither name already behaves as `notRecorded: false`; the sweep exists so the
stored documents match the type that says the field is required. It refuses to
run if it finds `archived: true`, which nothing could ever have written — a
value there means the assumption behind the rename is wrong.

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
- **`functions/package-lock.json` is committed, and must stay in step.**
  Without it a cold Cloud Build cannot resolve this codebase's dependencies at
  all, and the failure is invisible until the first genuinely new function —
  see the `expo-firebase-stack` skill for the mechanism and the recovery. It is
  pinned to the versions the suite runs against, so regenerate it whenever a
  dependency in `functions/package.json` changes, and check
  `npm ci --dry-run --omit=dev` accepts the pair before deploying.
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

When a function's RUNTIME CONFIG changed — timeout, memory — logs prove nothing,
because a config that did not take looks identical until something runs long
enough to hit the old limit. Read it back instead (gcloud has no default project
here, so name it):

```bash
gcloud functions describe importZoomRecording --region=us-central1 --gen2 \
  --project=sabeel-class-recordings \
  --format="value(serviceConfig.timeoutSeconds,serviceConfig.availableMemory)"
```

That verifies the CONFIG, not the import. No suite moves a genuinely large file —
the fixtures are kilobytes — so the only end-to-end proof is importing a real
two-hour meeting.

## Android

No EAS. Local Gradle builds with a committed `android/` directory. The APK ships
as a **GitHub Release asset**, never committed to any repo — per-release APKs
bloated the sibling pages repo's history and had to be rewritten out.
