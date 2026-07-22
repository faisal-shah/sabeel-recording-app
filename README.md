# Sabeel Class Recordings

Class recordings for Sabeel Institute — audio-only recordings of Hikam
Foundations classes, in-app listening for adult students, and an accountability
ledger for staff.

One Expo codebase targets **Android and web**, with the architecture kept ready
for a later iOS build. Backend is Firebase: Firestore, Cloud Functions, and Cloud
Storage for the audio.

## Status

**Phase 1 complete.** Staff sign in with Google (restricted to the org domain
and admin-approved); students get staff-created accounts and set their own
password. Cohorts, classes and enrollments exist, with managers scoped class by
class. Recordings arrive in Phase 3. See
[`docs/PHASE_STATUS.md`](docs/PHASE_STATUS.md) for live status and
[`PLAN.md`](PLAN.md) for the nine-phase build order.

## Documentation

| Doc | What it is |
|---|---|
| [Product brief](docs/PRODUCT_BRIEF.md) | Product decisions and the data model — the *what* |
| [Build plan](PLAN.md) | Phase order and locked architecture decisions — the *when* and *why* |
| [Phase status](docs/PHASE_STATUS.md) | Live build status, decision log, verification log |
| [Brand](docs/BRAND.md) | Option 1 palette, accessibility cuts, single light theme |
| [Dev tooling](docs/DEV-TOOLING.md) | What each script guards against; expected output |
| [Deploy](docs/DEPLOY.md) | Deploy order and first-deploy traps |
| [Secrets](docs/SECRETS.md) | What is and is not a secret; key names only |
| [TODO](TODO.md) | Everything needing a human with console access |
| [Stack gotchas](docs/STACK-GOTCHAS.md) | Stub — the real content is a shared skill |

### Research

- [Zoom Server-to-Server OAuth](docs/research/zoom-server-to-server-oauth.md)
- [Firebase recording costs](docs/research/firebase-recording-costs.md)
- [Technical risk register](docs/research/technical-risk-register.md)

## Quick start

```bash
npm ci
npm run lint && npm run typecheck && npm run knip && npm test
npm run test:emulator        # needs JDK 21

# End-to-end (needs the emulators AND the web dev server running — see docs)
npm run test:e2e

# Web
npm run web:export -w @sabeel/app

# Android (AVD tb_emu)
scripts/emulator.sh headless
cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo run:android
```

## Layout

```
app/               Expo app (Android + web via react-native-web)
functions/         Cloud Functions (TS, nodejs22, us-central1)
packages/shared/   Types and constants shared by app, functions and tests
firestore.rules    Scoped reads; every write goes through a callable
storage.rules      Deny-all — and stays that way for reads
scripts/           Emulator, dead-code and text-integrity tooling
```

Clients never read audio through the Storage SDK: playback goes through a
12-hour signed URL minted by a callable that has already checked enrollment.
`storage.rules` denying reads is the intended end state, not a placeholder.
