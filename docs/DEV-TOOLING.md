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
| `npm run web:export -w @sabeel/app` | The web bundle that actually ships |
| `scripts/emulator.sh headless` | Boots the `tb_emu` AVD with no window |

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

  **`liveQuery.ts` does not exist yet** — it arrives in Phase 1 with the first
  live query. The rule is already in place, so the first `onSnapshot` import
  will be rejected and point at the file to create.

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
  The script looks up owners by port instead.
- **Waiting for the port is not waiting for readiness.** The functions emulator
  accepts connections before it has registered anything. Poll a known callable
  until it stops 404ing.

## Rules tests: the trap in the test itself

`assertFails` passes when an operation fails for **any** reason — including a
broken connection or a typo'd path. A deny-all suite can therefore pass while
testing nothing at all.

So whenever the rules change shape, **mutation-test the suite**: flip the rule to
`allow read, write: if true`, confirm the tests go red, and flip it back. Done
for the Phase 0 baseline (see `PHASE_STATUS.md`), and it is the only thing that
makes a suite of denials meaningful.

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
