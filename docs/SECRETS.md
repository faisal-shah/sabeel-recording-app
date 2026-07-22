# Secrets

**Key names only. No values, ever — not here, not in chat, not in a commit.**

## What is and is not a secret

| Thing | Secret? | Where it lives |
|---|---|---|
| Firebase web config (apiKey, appId, …) | **No** | Committed in `app/src/firebase-config.ts` — it ships in every client bundle |
| `google-services.json` | No, but not committed | Regenerated from the console; gitignored because it is per-project and carries OAuth client ids |
| Sentry client DSN | No, but not committed | Gitignored `app/.env.local` as `EXPO_PUBLIC_SENTRY_DSN` |
| Zoom account id / client id / client secret | **Yes** | Secret Manager, via `firebase functions:secrets:set` |
| Service account keys | **Yes** | Should not exist — see below |

The Firebase "apiKey" is not a credential. It identifies the project; access is
controlled by security rules and App Check. Treating it as a secret leads people
to hide it and then commit something that genuinely matters.

## Setting a server secret

The agent never handles values. It outputs the command; Faisal runs it:

```bash
firebase functions:secrets:set ZOOM_ACCOUNT_ID
firebase functions:secrets:set ZOOM_CLIENT_ID
firebase functions:secrets:set ZOOM_CLIENT_SECRET
```

Then bind them in the function definition, and redeploy — a secret that is set
but not bound is not available at runtime.

## No service account key files

URL signing uses the Functions runtime service account through the IAM
Credentials API, which needs `roles/iam.serviceAccountTokenCreator` granted to
that account — **not** a downloaded JSON key. A key file in a repo or a CI
variable is a permanent credential with no rotation story.

This grant is a first-deploy blocker that the emulator cannot reproduce: signing
appears to work locally and 403s in production. It is tracked in `TODO.md`.

## Zoom credentials

Never reach the mobile or web bundle. The backend fetches from Zoom and copies
only the audio file into Storage; students never see a Zoom token, a Zoom
download URL, or a `play_url`.

## If a secret leaks

Rotate first, investigate second. For Zoom, regenerate the client secret in the
Marketplace developer portal and re-set it. For signed URLs, note that individual
URLs cannot be revoked — rotating the signing key invalidates **all** outstanding
URLs at once, which is the blunt instrument available.
