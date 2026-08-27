# Dev tooling

What each script guards against, and which failures are environmental rather
than yours. Read this before debugging the harness.

**First question when a suite fails: does it also fail on stashed changes?** A
clean-HEAD repro means the cause is environmental — almost always a leftover
emulator — not your diff.

## Commands

| Command | What it does |
|---|---|
| `npm run lint` | ESLint + `check:text` |
| `npm run typecheck` | Builds `@sabeel/shared` first, then typechecks every workspace |
| `npm test` | Vitest unit tests (shared + functions), no emulators needed |
| `npm run test:emulator` | Firestore + Auth + Storage emulators, then the rules suite |
| `npm run knip` | Dead-code audit — fails on unused files, exports and dependencies |
| `npm run emulators:free` | Kills whatever is squatting on the emulator ports |
| `npm run build` | Builds shared, then bundles functions with esbuild |
| `npm run test:e2e` | Playwright walkthrough against the web dev server (see below) |
| `npm run web:export -w @sabeel/app` | The web bundle that actually ships |
| `scripts/emulator.sh headless` | Boots the `tb_emu` AVD with no window |

## Setting up a machine

Node 22+, **two** JDKs — 21 for the Firebase emulators (they are Java), 17 as
the default `java` because the Android Gradle Plugin targets it — plus the
Android SDK and the `tb_emu` AVD.

Do not install these by hand. The `expo-firebase-stack` skill in
`../agent-skills/` carries a bootstrap that installs the lot under `$HOME` with
no root, and is idempotent:

```sh
../agent-skills/skills/expo-firebase-stack/tools/check-host.sh   # what is missing
../agent-skills/skills/expo-firebase-stack/tools/bootstrap-linux.sh \
    --jdk21-aliases SR --repo "$PWD"
```

`--jdk21-aliases SR` sets `SR_JDK21_HOME`, which
`scripts/test-emulator.sh` reads to find JDK 21 without disturbing the Gradle
default.

**The Android emulator needs hardware virtualization, which a VM may not have.**
`emulator -accel-check` is authoritative — `accel: 3` means no KVM, and if
`/proc/cpuinfo` shows `hypervisor` with neither `vmx` nor `svm` then nested
virtualization is off at the host and nothing inside the machine, root
included, can enable it. The AVD still boots in software: measured at **805 s
to boot and ~14 s per `screencap`**, so screenshot-based verification stops
being practical while input events (~1.4 s) remain usable. **Builds are
unaffected** — Gradle needs no KVM. `check-host.sh` gives the verdict.

## The ESLint rules that are not style

Two rules encode real incidents and should not be relaxed:

- **No hardcoded colours** under `app/**`, exempting `app/src/theme/**`. Every
  colour goes through a semantic token, which is what made the sibling apps'
  Option-1 palette refresh a one-file change.
- **No `onSnapshot` import** outside `app/src/liveQuery.ts`. Hand-rolled
  subscription state persists across dependency changes, showing the previous
  query's results under the new one on a slow connection. That cost the sibling
  time-tracker a week
  (its `docs/POSTMORTEM-2026-07-16-stale-week.md`).

  Two files are exempt: `liveQuery.ts` is the choke point itself, and
  `session.ts` subscribes inside `onAuthStateChanged` rather than a hook — it
  cannot call one there, and it already does its own reset on every auth change.

## knip: expected output

Two **configuration hints** are expected until the first platform seam exists:

```
src/**/*.web.ts    Refine entry pattern (no matches)
src/**/*.web.tsx   Refine entry pattern (no matches)
```

They are hints, not errors — knip still exits 0. The patterns are there so that
Phase 1's first `.web.ts` seam is treated as an entry point rather than reported
as dead code, which is knip's most common false positive in this stack.

`ignoreDependencies` in the `app` workspace lists `expo-updates`,
`@expo/metro-runtime` and `expo-system-ui`: Expo's config references them
implicitly, so knip reports them as "unlisted" without it.

**knip is load-bearing, which is why infrastructure is added with its first
consumer rather than ahead of it.** Firestore/Storage/Auth initialisation,
`liveQuery.ts` and navigation were all deliberately left out of Phase 0 because
nothing used them. Suppressing knip to keep unused scaffolding would make the
audit lie, and an audit that reports nothing is worse than no audit.

## Emulators

- **JDK 21+ required.** `scripts/test-emulator.sh` resolves `SR_JDK21_HOME` →
  `~/opt/jdk-21` → whatever `java` is on PATH, so JDK 17 can stay the default for
  the Android/Gradle build.
- **`free-emulator-ports.sh` runs first, every time.** A killed run leaves
  emulators squatting on ports 4000/4400/4500/5001/8080/9099/9150/**9199**. The
  next run then talks to a half-dead emulator that answers on the port but has no
  functions registered, so every callable 404s — and a 404 carries no CORS
  headers, so the browser reports "blocked by CORS policy" while the callable
  surfaces a bare `internal`. Every symptom points at the app rather than at the
  leftover process.
- **Never `pkill -f firebase`.** The pattern matches the cleanup script's own
  command line and the shell that spawned it, so the "cleanup" kills the caller.
  The script looks up owners by port instead. The same trap catches
  `pkill -f "expo start"` / `pkill -f "expo run"` — it matches the agent's own
  tool process and the command exits **144** as its shell is killed mid-run.
  **Kill dev servers by port:** `lsof -ti tcp:8083 tcp:8081 | xargs -r kill`
  (or `free-emulator-ports.sh` for the emulator suite).
- **Waiting for the port is not waiting for readiness.** The functions emulator
  accepts connections before it has registered anything. Poll a known callable
  until it stops 404ing.

## The e2e harness

`npm run test:e2e` needs TWO things already running:

```bash
firebase emulators:start --project demo-sabeel --only firestore,auth,storage,functions
cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --web --port 8083 --clear
```

**`npm run test:emulator` will kill that emulator suite.** It runs
`free-emulator-ports.sh` first, by design — so the two cannot be used at once,
and after running the unit-style emulator suite you must restart the long-lived
one before the e2e will work. The symptom is every e2e check failing at once.

**It resets Firestore and Auth on every run.** Leftover state silently SKIPS the
paths that matter: an early version left an admin behind, and every later run
then jumped straight past the pending screen while still reporting success.

**It is a FLOW suite, not a security suite.** Most screens only query what the
user is allowed to see, so a widened rule can leave every screen looking
correct — verified by widening the manager-scope rule and watching the e2e
checks stay green. Authorization lives in the rules tests below. The e2e check
names say "the manager's class list omits…" rather than "a manager cannot
see…" for exactly that reason.

Two more things that cost time here:

- **`page.goBack()` works, and is worth asserting.** The navigator has a
  `linking` config, so every screen has a URL and the stack IS browser history.
  Reloading a deep URL restores that screen rather than Home — `goto(WEB)` still
  lands on Home only because `/` is the Home path.
- **Text locators can resolve to hidden nodes.** React Navigation keeps the
  previous screen mounted, so `getByText('Managers')` can match a stale hidden
  element and hang until timeout. Wait on `getByTestId` instead. `innerText()`
  is safe for assertions because it returns only visible text.

## Rules tests: the trap in the test itself

`assertFails` passes when an operation fails for **any** reason — including a
broken connection or a typo'd path. A deny-all suite can therefore pass while
testing nothing at all.

So whenever the rules change shape, **mutation-test the suite**: flip the rule to
`allow read, write: if true`, confirm the tests go red, and flip it back. Done
for Phase 0's baseline and again for every predicate added in Phase 1 (see
`PHASE_STATUS.md`), and it is the only thing that makes a suite of denials
meaningful.

Two Phase 1 specifics worth keeping in mind when editing `firestore.rules`:

- **A `list` rule that does not reference `resource.data` grants everything.**
  Referencing it is what forces the client's query to be constrained; a comment
  describing the expected query shape enforces nothing.
- **A `get()` resolved from document data costs one read per row** unless every
  row resolves the same path, and Firestore caps document-access calls per
  query. Keep such an arm behind a role guard that excludes any population whose
  queries span many parents, and size the test past the limit —
  `rules.structure.test.ts` uses 25 rows because at three it passes either way.

Reading Firestore out of band (as the e2e does) needs
`Authorization: Bearer owner`; without it the rules apply and the read is
denied. Note the two different URL shapes: reads use
`/v1/projects/.../documents/...`, while the wipe endpoint is
`/emulator/v1/projects/.../documents`.

## Android

- AVD `tb_emu` (Pixel 6, API 35, Google APIs image) is shared with the sibling
  projects. Override with `SR_AVD`.
- Firebase emulators are reachable from the AVD at `10.0.2.2`; from web use the
  literal `127.0.0.1`, never `localhost` (the emulators bind IPv4 only, and
  `localhost` can resolve to `::1` first — which surfaces as a CORS error,
  because a failed connect produces no response to carry headers).
- **`EXPO_PUBLIC_*` in a debug build comes from the environment that started
  METRO**, not from the APK. If a flag looks unset on device, restart Metro with
  `--clear` and the variable set.
- **`BUILD SUCCESSFUL` is not proof the APK installed.** Confirm before trusting
  any screenshot:

  ```bash
  adb shell dumpsys package com.sabeelinstitute.classrecordings | grep versionName
  ```

  It must match `version` in `app/app.json`.

### Driving the app by adb (headless verification)

There is no device — the AVD `tb_emu` is a Pixel 6 at **1080×2400**. When a
screenshot is read back it is displayed at 900×2000, so **multiply the
coordinates you read off the image by 1.2** to get the real `adb shell input tap
X Y` target. Sign in headlessly with the emulator dev row
(`dev-signin-first-admin`), then `curl` the emulator's `bootstrapAdmin` to
promote (409 = already an admin, fine).

- **A pure-JS change needs a reload, not a rebuild.** After editing only JS,
  Metro fast-refreshes, but to be sure the running app has the new bundle,
  `adb shell am force-stop <pkg>` then relaunch — it refetches from Metro. Only a
  new *native* module (a new dependency) needs `expo run:android` again.
- **Uploads go through the Android SAF picker**, not the app. `adb push` a file
  to `/sdcard/Download`, tap the app's file button, then in the system picker:
  hamburger → Downloads → the file. The picker OPENING at all is already proof
  the native picker module is wired.
- The `Open debugger to view warnings` toast is dev-only LogBox noise; check
  `adb logcat -d | grep -i deprecated` for the actual warning rather than trusting
  the toast — and it never appears in a release build.

## Verifying the dev sign-in row is not shippable

`app/src/auth/devSignIn.ts` is gated on `IS_DEV && USE_EMULATORS` — two
independent conditions, because either alone could be got wrong (a release build
carrying a stale emulator env, or a dev build pointed at production).

**Do not verify this by grepping the exported bundle.** The strings survive
minification: the `DevRow` component is still referenced from a branch the
minifier cannot prove dead, so `grep "Emulator sign-in" app/dist-web/` finds it
in a perfectly safe build. That check produces a false alarm and teaches you to
ignore it.

Verify what actually matters — that it does not **render**:

```bash
npm run web:export -w @sabeel/app     # no EXPO_PUBLIC_USE_EMULATORS set
npx serve -s app/dist-web -l 4601
# then load it and assert the row is absent from the DOM
```

Confirmed absent on 2026-07-21 against a production export.
