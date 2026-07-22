# Stack gotchas

**This file is deliberately a stub. Do not fill it in.**

The recurring traps of this stack — Expo, Metro, react-native-web, the Firebase
JS SDK, Cloud Functions, FCM, emulator behaviour, build and export mechanics —
live in the shared **`expo-firebase-stack`** skill:

- Source: `faisal-shah/agent-skills`, `skills/expo-firebase-stack/SKILL.md`
- Installed at `~/.claude/skills/expo-firebase-stack/`
- Resync after every pull: `skills/expo-firebase-stack/install.sh --claude`
  (installation is a **copy**, not a symlink — an edit in the repo reaches
  nothing until the installer runs again, and a stale copy looks current)

Copying that content here would create a second copy that drifts, with a manual
sync nobody performs. A stub cannot drift.

## What belongs where

One question: **would this be true for a different company building on the same
stack?**

- **Yes → the skill.** SDK quirks, emulator mechanics, build behaviour.
- **No → `CLAUDE.md` in this repo.** Product invariants, brand, AVD and port
  conventions, phase process, anything naming this project.

## What this project owes the skill

This is the first Sabeel app to use **Cloud Storage, long-media playback,
background audio, and offline media**. The skill covers none of them yet. When
one of those costs real time to diagnose, write the entry into the skill in the
**same batch** as the fix — the knowledge only compounds if it lands where every
project reads it.

The skill repo is **public**: generalise first, and grep for project ids,
internal domains, email addresses and AVD names before pushing.
