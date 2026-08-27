# Sabeel Class Recordings — Working Rules for Claude

## What this project is

Class recordings for Sabeel Institute: audio-only recordings of Hikam
Foundations classes, in-app listening for adult students, and an accountability
ledger for staff. Faisal is the developer; the institute's staff are the
admins/managers.

**Still being built** — phases 6, 8 and 9 are not started. Source of truth:
`docs/PRODUCT_BRIEF.md` (product decisions & data model), `PLAN.md` (the build
order and locked architecture decisions), `docs/PHASE_STATUS.md` (live status),
`docs/DEV-TOOLING.md` (what each script guards against, and which failures are
environmental rather than yours).

## Stack knowledge lives in a shared skill, not here

Recurring traps of this stack (Expo, Metro, react-native-web, Firebase JS SDK,
Cloud Functions, FCM, emulator behaviour, build/export mechanics) live in the
**`expo-firebase-stack` skill** — source `faisal-shah/agent-skills`, installed at
`~/.claude/skills/expo-firebase-stack/`. Read its closing section, **"How this
stack fools you"**, *before* a debugging session, not during one.

**The boundary is one question: would this be true for a different company
building on the same stack?** Yes → the skill. No → this file (product
invariants, brand, ports/AVD conventions, phase process, division of labour,
anything naming this project).

**The skill repo is PUBLIC.** Nothing naming this project goes into it — no
project ids, internal domains, email addresses, AVD names, secrets or product
decisions. Generalise first, then grep for identifiers before pushing.

**Installation is a COPY, not a symlink.** Editing a skill changes nothing an
agent reads until `skills/<name>/install.sh --claude` runs again, and a stale
installed copy looks identical to a current one. Re-run after every pull.

**Never copy the skill's content into this repo.** `docs/STACK-GOTCHAS.md` is a
stub for that reason. A stub cannot drift.

**Contribute back in the same batch as the fix.** This app is the first Sabeel
project to use Cloud Storage, long-media playback, background audio and offline
media, so it is the one most likely to find something new. The skill already has
**"Cloud Storage and long media"** and the offline-outbox pattern under
**"Offline persistence"**; **background-audio setup** (audio mode, foreground
service, lock-screen controls) is still uncovered — write it in when it next
costs real time.

The skill also carries `tools/bootstrap-linux.sh`, which installs this whole
toolchain on a fresh machine under `$HOME` with no root. See
`docs/DEV-TOOLING.md`.

## Product invariants

Do not silently change any of these.

- **Audio only.** No video playback, no video stored. This is the single biggest
  cost cliff in the product — a 2-hour Zoom MP4 is 15–70x an audio-only M4A, and
  it is what takes the project from $0/month to material spend.
- **Being marked EXCUSED is the whole of a student's entitlement.** One
  `assignments` document both grants access to a recording and requires listening
  to it, and it lapses when the session's due date passes. Enrolment opens nothing
  on its own; `present` and `absent` open nothing at all. "Everyone must listen"
  is said by excusing everyone. Access and accountability were separate until
  2026-08-14 and are now deliberately one fact — see the decision log; do not
  re-split them.
- **A session's due date is required, and is never written in the past.** It is
  the day access closes, so a blank one would mean permanent access. It may
  BECOME past by the passage of time — that is how a recording closes — but no
  callable will write one that has already gone, and none will excuse a student
  for a session whose deadline has passed. Nothing is ever born expired.
- **The deadline is enforced at the AUDIO, not in the rules.** `firestore.rules`
  gates a recording's metadata on an active assignment; `getPlaybackUrl` gates the
  audio on the date. Comparing `request.time` to a `YYYY-MM-DD` string in the
  institute timezone would be a second copy of the maths in `@sabeel/shared`, free
  to drift.
- **Students never read a session.** The attendance map holds the whole roster and
  Firestore has no field-level security, so each student's own mark is projected
  server-side onto `attendanceRecords/{uid}_{sessionId}`. The session stays
  canonical; the projection is derived from it, never the reverse.
- **Completion is student-attested.** Playback progress is audit evidence, not the
  gate. There is no listened-percentage threshold; the app only blocks completion
  if the student has never played the recording.
- **Playback URLs expire.** A 12-hour V4 signed URL minted by a callable that has
  already checked the student's grant. Never `getDownloadURL()` — its download
  token never expires, which is the one thing the threat model rules out. Never
  proxy audio through a Function: the 60-minute timeout kills a 2-hour session.
- **Adult learner tone.** Required listening, listen by, missed, completed, pending
  sync. "Missed" rather than "overdue" once access has closed: overdue implies
  still doable. Never childish, punitive, or shaming language.
- **Two auth populations.** Staff sign in with Google and must be on
  `oursabeel.com` *and* approved by an admin — the domain check is server-side, the
  client `hd` hint is UX only. Students use email/password accounts created by
  staff. Managers are scoped **class by class**; cohort assignment grants nothing.
- **Disable, archive, unpublish — don't delete.** Permanent deletion is admin-only,
  needs strong confirmation, and is audited.
- **BRAND COLORS ARE FIXED.** `docs/BRAND.md` and the shared `sabeel-color-scheme`
  skill are the authority. Single light theme, **no dark mode**. Never hardcode a
  colour; the ESLint rule will reject it. `app/src/theme/palette.ts` is the only
  exception.

## Stack (locked)

- One Expo codebase (`app/`): Android (local Gradle builds, committed `android/`,
  **NO iOS builds yet, NO EAS**) + web via react-native-web
  (`expo export --platform web` → Firebase Hosting). Platform seams as `.web.ts(x)`
  siblings. Architecture must not block a later iOS build.
- Firebase **JS SDK on all surfaces** (not react-native-firebase — no web support).
- Backend: Cloud Functions (TS, nodejs22, us-central1) + Firestore + **Cloud
  Storage**. The bucket must be a modern `*.firebasestorage.app` bucket in
  us-central1/us-west1/us-east1 — only those get the no-cost quotas.
- Monorepo (npm workspaces): `app`, `functions`, `packages/shared`. Shared types
  and constants live in `@sabeel/shared`.
- Config-as-code: `firestore.rules`, `firestore.indexes.json`, `storage.rules`
  deploy from the repo, never console-edited.

## Dev & test loops

- Unit: `npm test` (Vitest: shared + functions).
- Rules/integration: `npm run test:emulator` — Firestore, Auth **and Storage**
  rules. Needs JDK 21. Storage rules have no reference implementation in the
  sibling repos, so this job is what keeps them honest.
- Browser e2e: `npm run test:e2e`. Needs a live Metro dev server **and** the
  emulator suite already running, and it resets Firestore and Auth on every run —
  which is why it is a local pre-commit check and deliberately **not** in CI.
- Layout sweep: `npm run test:screens`. Every screen of both populations at five
  widths straddling the content-column cap, **asserted**, not just photographed.
  It starts its own emulators and its own dev server, which is exactly why it
  **is** in CI where `test:e2e` cannot be. `SWEEP_WIDTHS=320` for a tight loop.
- Web: `npx expo start --web` in `app/`, or `npm run web:export -w @sabeel/app`
  for the bundle that actually ships.
- Android: `scripts/emulator.sh headless` (AVD `tb_emu`), then `npx expo
  run:android` in `app/`. Firebase emulators from the AVD = `10.0.2.2`; from web =
  the literal `127.0.0.1`, never `localhost` (the emulators bind IPv4-only and
  `localhost` can resolve to `::1` first).
- Dead code: `npm run knip` (CI-enforced). It fails on unused files, exports and
  dependencies — which is why infrastructure is added **with its first consumer**,
  not ahead of it. Suppressing knip to keep unused scaffolding would make the audit
  lie, and an audit that reports nothing is worse than no audit.
- **CI is OFF** (2026-08-28, heavy development): `ci.yml` is `workflow_dispatch`
  only. The job is 8m12s and duplicates the local loop, so run that instead —
  `npm run lint && npm run typecheck && npm run knip && npm test &&
  npm run test:emulator && npm run test:screens`. Trigger CI by hand before a
  release or when something must hold on a clean machine
  (`gh workflow run ci.yml --ref <branch>`); the trigger block to restore is at
  the top of `ci.yml`. No deploys from CI.
- **If a suite fails, first ask whether it fails on stashed changes too.** A
  clean-HEAD repro means the cause is environmental — usually a leftover emulator
  (`npm run emulators:free`) — not your diff.

## Verification — what counts as evidence

**Look at the screenshot.** Correct hex values in `palette.ts` survive right up
until you look at the rendered screen; contrast misuse and layout gaps pass every
code-level check. Never claim a screen works because the code looks right.

**A check that cannot fail is a screenshot generator.** A tour wrapped in a
try/catch that logs and continues reports success either way.

### The browser is the default surface for layout work

`npm run test:e2e` drives the real web build, and a narrow browser window is the
right place to iterate on mobile layout. Reach for it on any change to a shared
component, the theme, or a layout — it is faster and more repeatable than a human
on an emulator.

**`npm run test:screens` is the sweep, and it runs on every push.** Every screen
of both populations at five widths straddling `CONTENT_MAX_WIDTH` — which it
reads out of `app/src/theme/index.ts` rather than restating — asserting that the
page never scrolls sideways, that nothing is clipped by the right edge, that no
two same-layer controls overlap, that every pushed screen still has its Back, and
that the content column caps and centres where it should. Targets under 44px are
reported, never failed. Screens with an editor OPEN are toured as their own
screens, because the rows a session editor or a ledger override adds exist in no
other state and 320px is where they run out of room.

It is not a substitute for looking: it says a layout is not broken, never that it
is good. Read `shots/screens/` after a change to a shared component or the theme
— CI uploads them on failure.

### The Android emulator is reserved for the seams a browser cannot reach

Not for routine layout work. Use it for:

| Seam | Why the browser cannot cover it |
|---|---|
| **Audio** | Background playback, the foreground service, lock-screen controls, seek and rate — the core of this product, and none of it is web-equivalent |
| **Offline** | The download store and the offline outbox |
| **Flex shrink / wrap / overflow** | Yoga ≠ CSS — Yoga defaults `flexShrink` to **0** |
| **Keyboard / IME** | Emulators misreport IME insets; edge-to-edge makes `Keyboard` events no-ops |
| **Gestures** | Long-press and swipe have no web path |
| **Native modules** | FCM/push, document picker, sharing |
| **Safe area / insets** | No browser equivalent |

Plus **before a release**, and whenever Faisal asks. That pre-release pass is
mandatory, not optional.

**Why this is safe, and exactly where it is not.** react-native-web resolves
flexbox through the browser's engine, so a narrow viewport tests *your layout
intent* but not *Yoga's behaviour*. This repo owns the documented proof: a button
shrank below its basis on a real device and **never reproduced under
react-native-web at any of 12 widths** — it is a Yoga behaviour
(`docs/PHASE_STATUS.md` 2026-07-24). The same run also caught a control sitting
outside its confirmation wrapper, invisible on web because that check ran in a
state where the button was not rendered: **a state-dependent control needs its
assertions in that state.**

Note this project's audio seam is unusually wide, so it leans on the emulator
more than its siblings do. That is a property of the product, not a licence to
skip the browser check.

**Two traps when you do run native:**

- **`BUILD SUCCESSFUL` is not proof the APK installed.** If the AVD drops during
  the run, yesterday's build stays on the device and every screenshot after it is
  a lie. Confirm with
  `adb shell dumpsys package com.sabeelinstitute.classrecordings | grep versionName`
  against `app/app.json`.
- **A native debug build takes `EXPO_PUBLIC_*` from the environment that started
  METRO**, not from the APK. If a flag looks unset, restart Metro with `--clear`.

**The AVD needs hardware virtualization and a VM may not have it.**
`emulator -accel-check` is authoritative; without it the AVD still boots in
software at ~805 s and ~14 s per screenshot, which retires the screenshot loop
while leaving input usable. Builds are unaffected — Gradle needs no KVM.
`check-host.sh` in the skill's `tools/` gives the verdict.

**A rules test that only asserts denials must be shown to fail when the rules are
opened.** `assertFails` passes when an operation fails for *any* reason, including
a broken connection — so flip the rule to `if true`, watch the suite go red, and
flip it back. Done for the Phase 0 baseline; do it again whenever the rules change
shape.

## Secrets (zero tolerance)

NEVER ask for, accept, or echo real API keys/DSNs/tokens in chat; never hardcode
them. Server secrets: output the exact `firebase functions:secrets:set NAME`
command for Faisal to run. Client-side non-secrets (Firebase web config) are
committed by design — rules are enforced server-side. Client DSNs go in gitignored
`.env.local` (key names only in docs). **Zoom credentials live only in Secret
Manager, never in the app bundle.**

## Division of labor

- Agent: all code, rules, indexes, tests, emulator runs, CI, exact click-by-click
  console checklists, diagnosing pasted logs.
- Faisal only: third-party consoles (Firebase/GCP/Sentry/Zoom), OAuth/SHA-1
  registration, App Check registration, IAM grants, anything with production
  secrets. Everything Faisal must do himself is tracked in `TODO.md` — keep it
  current.

## Conventions

- **Commit at phase boundaries** (see `docs/PHASE_STATUS.md`); work autonomously
  within a phase. Before ANY significant install (global/system/major framework),
  ask first; routine project-local npm deps of the locked stack are fine.
- All repo artifacts (docs, plans, protocols) live in this repo.
- User-visible changes ship with their documentation, in the same batch as the
  code.
- **The ESLint rules that are not style**, and should not be relaxed: no hardcoded
  colours under `app/**` (exempting `app/src/theme/**`), and no `onSnapshot`
  import outside `app/src/liveQuery.ts`. Hand-rolled subscription state persists
  across dependency changes, showing the previous query's results under the new
  one on a slow connection — that cost the sibling time-tracker a week. Two files
  are exempt: `liveQuery.ts` itself, and `session.ts`, which subscribes inside
  `onAuthStateChanged` rather than a hook.
- Never `git add` a binary. The APK ships as a GitHub Release asset; committing
  per-release APKs bloated the sibling pages repo's history and had to be
  rewritten out. `*.apk` is gitignored as the backstop.
