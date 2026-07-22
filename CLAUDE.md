# Sabeel Class Recordings — Working Rules for Claude

## Stack knowledge lives in a shared skill, not in this repo
Recurring traps of this stack (Expo, Metro, react-native-web, Firebase JS SDK,
Cloud Functions, FCM, emulator behaviour, build/export mechanics) live in the
**`expo-firebase-stack` skill** — source: `faisal-shah/agent-skills`,
`skills/expo-firebase-stack/SKILL.md`; installed at
`~/.claude/skills/expo-firebase-stack/`. Read its closing section, **"How this
stack fools you"**, *before* a debugging session, not during one.

**Boundary rule — one question: would this be true for a different company
building on the same stack?**
- **Yes → the skill.** Stack behaviour, SDK quirks, tooling, emulator and build
  mechanics.
- **No → this file.** Product invariants, brand, ports/AVD conventions, phase
  process, division of labour, anything naming this project.

**The skill repo is PUBLIC.** Nothing naming this project goes into it — no
project ids, internal domains, email addresses, AVD names, secrets, or product
decisions. Generalise first, then grep the file for identifiers before pushing.

**Installation is a COPY, not a symlink.** Editing a skill changes nothing an
agent reads until `skills/<name>/install.sh --claude` runs again, and a stale
installed copy looks identical to a current one. Re-run after every pull.

**Contribute back in the same batch as the fix.** This app is the first Sabeel
project to use Cloud Storage, long-media playback, background audio and offline
media — none of which the skill covers yet. When one of those costs real time,
write the entry into the skill alongside the code change.

**Never copy the skill's content into this repo.** `docs/STACK-GOTCHAS.md` is a
stub for that reason. A stub cannot drift.

## What this project is
Class recordings for Sabeel Institute: audio-only recordings of Hikam Foundations
classes, in-app listening for adult students, and an accountability ledger for
staff. Faisal is the developer; the institute's staff are the admins/managers.
Source of truth: `docs/PRODUCT_BRIEF.md` (product decisions & data model),
`PLAN.md` (the ten-phase build order and locked architecture decisions),
`docs/PHASE_STATUS.md` (live build status).

Key product invariants (do not silently change):
- **Audio only.** No video playback, no video stored. This is the single biggest
  cost cliff in the product — a 2-hour Zoom MP4 is 15–70x an audio-only M4A, and
  it is what takes the project from $0/month to material spend.
- **Access and accountability are separate.** Class membership controls *access*
  to recordings; assignment controls whether a recording is *required listening*
  in the ledger. Do not collapse these.
- **Completion is student-attested.** Playback progress is audit evidence, not
  the gate. There is no listened-percentage threshold; the app only blocks
  completion if the student has never played the recording.
- **Playback URLs expire.** A 12-hour V4 signed URL minted by a callable that has
  already checked enrollment. Never `getDownloadURL()` — its download token never
  expires, which is the one thing the threat model rules out. Never proxy audio
  through a Function: the 60-minute timeout kills a 2-hour session.
- **Adult learner tone.** Required listening, due, overdue, completed, pending
  sync. Never childish, punitive, or shaming language.
- **Two auth populations.** Staff sign in with Google and must be on
  `oursabeel.com` *and* approved by an admin — the domain check is server-side,
  the client `hd` hint is UX only. Students use email/password accounts created
  by staff. Managers are scoped **class by class**; cohort assignment grants
  nothing.
- **Disable, archive, unpublish — don't delete.** Permanent deletion is
  admin-only, needs strong confirmation, and is audited.
- **BRAND COLORS ARE FIXED.** `docs/BRAND.md` and the shared
  `sabeel-color-scheme` skill are the authority. Single light theme, **no dark
  mode**. Never hardcode a colour; the ESLint rule will reject it.
  `app/src/theme/palette.ts` is the only exception.

## Stack (locked)
- One Expo codebase (`app/`): Android (local Gradle builds, committed `android/`,
  NO iOS builds yet, NO EAS) + web via react-native-web
  (`expo export --platform web` → Firebase Hosting). Platform seams as `.web.ts(x)`
  siblings. Architecture must not block a later iOS build.
- Firebase **JS SDK on all surfaces** (not react-native-firebase — no web support).
- Backend: Cloud Functions (TS, nodejs22, us-central1) + Firestore + **Cloud
  Storage**. Bucket must be a modern `*.firebasestorage.app` bucket in
  us-central1/us-west1/us-east1 — only those get the no-cost quotas.
- Monorepo (npm workspaces): `app`, `functions`, `packages/shared`. Shared types
  and constants live in `@sabeel/shared`.
- Config-as-code: `firestore.rules`, `firestore.indexes.json`, `storage.rules`
  deploy from the repo, never console-edited.

## Dev & test loops
- Unit: `npm test` (Vitest: shared + functions).
- Rules/integration: `npm run test:emulator` (needs JDK 21; wraps
  `firebase emulators:exec --project demo-sabeel --only firestore,auth,storage`).
- Android: `scripts/emulator.sh headless` (AVD `tb_emu`, Google-APIs image), then
  `npx expo run:android` in `app/`. Firebase emulators from the AVD = `10.0.2.2`;
  from web = literal `127.0.0.1`, never `localhost`.
- Web: `npx expo start --web` in `app/`, or `npm run web:export -w @sabeel/app`
  for the bundle that actually ships.
- Dead code: `npm run knip` (CI-enforced). It fails on unused files, exports and
  dependencies — which is why infrastructure is added **with its first consumer**,
  not ahead of it.
- If a suite fails, first ask whether it fails on **stashed changes too** — a
  clean-HEAD repro means the cause is environmental (usually a leftover
  emulator: `npm run emulators:free`), not your diff.
- CI (GitHub Actions): lint + typecheck + knip + unit + emulator tests on every
  push. Keep it green. No deploys from CI.

## Verification — what counts as evidence
- **`BUILD SUCCESSFUL` is not proof the APK installed.** If the AVD drops during
  the run, yesterday's build stays on the device and every screenshot after it is
  a lie. Confirm with
  `adb shell dumpsys package com.sabeelinstitute.classrecordings | grep versionName`
  against `app/app.json`.
- **A native debug build takes `EXPO_PUBLIC_*` from the environment that started
  METRO**, not from the APK. If a flag looks unset, restart Metro with `--clear`.
- **Web is not evidence about native, and an emulator is not a device.**
- **Look at the screenshot.** Correct hex values in `palette.ts` survive right up
  until you look at the rendered screen; contrast misuse and layout gaps pass
  every code-level check.
- **A rules test that only asserts denials must be shown to fail when the rules
  are opened.** `assertFails` passes when an operation fails for *any* reason,
  including a broken connection — so flip the rule to `if true`, watch the suite
  go red, and flip it back. Done for the Phase 0 baseline; do it again whenever
  the rules change shape.

## Secrets (zero tolerance)
- NEVER ask for, accept, or echo real API keys/DSNs/tokens in chat; never hardcode
  them. Server secrets: output the exact `firebase functions:secrets:set NAME`
  command for Faisal to run. Client-side non-secrets (Firebase web config) are
  committed; client DSNs go in gitignored `.env.local` (key names only in docs).
- Zoom credentials live only in Secret Manager, never in the app bundle.

## Division of labor
- Agent: all code, rules, indexes, tests, emulator runs, CI, exact click-by-click
  console checklists, diagnosing pasted logs.
- Faisal only: third-party consoles (Firebase/GCP/Sentry/Zoom), OAuth/SHA-1
  registration, App Check registration, IAM grants, anything with production
  secrets. Everything Faisal must do himself is tracked in `TODO.md` — keep it
  current.

## Conventions
- Commit at phase boundaries (see `docs/PHASE_STATUS.md`); work autonomously
  within a phase. Before ANY significant install (global/system/major framework),
  ask first; routine project-local npm deps of the locked stack are fine.
- All repo artifacts (docs, plans, protocols) live in this repo.
- User-visible changes ship with their documentation.
- Never `git add` a binary. The APK ships as a GitHub Release asset; committing
  per-release APKs bloated the sibling pages repo's history and had to be
  rewritten out. `*.apk` is gitignored as the backstop.
