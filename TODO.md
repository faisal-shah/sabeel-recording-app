# Faisal's TODO

Everything that needs a human with console access, a credit card, or a phone.
The agent cannot do any of these. Keep this current — it is the list Faisal
works from.

Phases 0 and 1 needed nothing from this list — `devSignIn` mints a
Google-provider identity in the Auth emulator, and the emulator handles password
resets. **Phase 3 is the first that genuinely blocks**, because signed URLs
cannot be minted against the emulator at all.

---

## ✅ Phase 3 setup — DONE (2026-07-22)

Kept for the record, because the ordering trap in step 3 is easy to hit again.
Signing was proven against the real project on 2026-07-22: a V4 URL streamed the
file and a short-TTL one was refused with `ExpiredToken`.

### 1. Create the Firebase project  ✅ done

1. <https://console.firebase.google.com> → **Add project**.
2. Project id: **`sabeel-class-recordings`** (or tell me what you chose and I
   will update `.firebaserc`). Disable Google Analytics — nothing uses it.
3. **Upgrade to the Blaze plan.** Cloud Functions require it. Expected spend is
   $0/month at this scale — see `docs/research/firebase-recording-costs.md` —
   but set a **budget alert at $5** anyway (Google Cloud console → Billing →
   Budgets & alerts) so a mistake surfaces as an email, not a bill.
4. Project settings → **Your apps** → add a **Web app**. Copy the config object
   and paste it over the placeholders in `app/src/firebase-config.ts`. It is not
   a secret — it ships in every client bundle.

### 2. Create the Storage bucket — region matters  ✅ done

Build → **Storage** → Get started → **location `us-central1`** (or `us-west1` /
`us-east1`; **only those three** carry the no-cost quotas). Take the modern
`*.firebasestorage.app` bucket, not a legacy `*.appspot.com` one — the legacy
rows cap downloads at 1 GB/day instead of 100 GB/month.

**This choice is permanent.** A bucket's location cannot be changed afterwards.

### 3. Enable the APIs FIRST — this creates the account you grant to  ✅ done

The service account that runs gen-2 functions,
`977423479850-compute@developer.gserviceaccount.com`, **does not exist on a
fresh Firebase project.** It is created when the Compute Engine API is enabled.
Granting before that fails with `NOT_FOUND: Unknown service account`, which
reads like an authentication problem and is not one. (Learned the hard way,
2026-07-22 — an earlier version of this file had these two steps the wrong way
round.)

```bash
gcloud services enable \
  compute.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  eventarc.googleapis.com \
  iamcredentials.googleapis.com \
  --project=sabeel-class-recordings
```

Takes a minute or two. Confirm the account now exists before moving on:

```bash
gcloud iam service-accounts list --project=sabeel-class-recordings
```

### 4. Grant the signing permission  ✅ done

To sign a URL without a downloaded key file, the runtime service account has to
be allowed to **impersonate itself** through the IAM Credentials API
(`signBlob`). Gen-2 functions run as the **Compute Engine default** account, not
the App Engine `…@appspot.gserviceaccount.com` one most older tutorials name.

```bash
gcloud iam service-accounts add-iam-policy-binding \
  977423479850-compute@developer.gserviceaccount.com \
  --member="serviceAccount:977423479850-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=sabeel-class-recordings

# Confirm it took:
gcloud iam service-accounts get-iam-policy \
  977423479850-compute@developer.gserviceaccount.com \
  --project=sabeel-class-recordings
```

**This is the failure that looks like working code.** Without it, signing throws
only in production; every local test passes. It is why the plan front-loads a
real deploy instead of trusting the emulator.

### 5. Wire it up  ✅ done

`firebase-config.ts` and `.firebaserc` point at the project.

---

## ✅ Auth setup — DONE (2026-07-22)

The ordering trap is kept for the record, because it is the thing that made this
confusing: the Google Cloud OAuth page showed only "Get started" because
**Firebase Authentication had never been initialized**, and enabling Google
sign-in *in Firebase* is what creates the OAuth client and the consent-screen
entry. Nothing on the GCP side was configurable before that, and
`disabledUserSignup` did not exist yet either, because it is a field of the same
config that did not exist.

Verified against the live Identity Toolkit config after Faisal's console work:

| Setting | Value |
|---|---|
| `client.permissions.disabledUserSignup` | **must be `false`** — see below |
| Email/Password | enabled |
| Email link (passwordless) | disabled |
| Anonymous | disabled |
| `authorizedDomains` | `localhost`, `…firebaseapp.com`, `…web.app` |
| OAuth consent screen | External, **published** (not Testing) |

Redirect URIs and JavaScript origins registered for **both** `…web.app` and
`…firebaseapp.com`, so `authDomain` can be switched either way without further
console work. It now points at **`sabeel-class-recordings.web.app`**: Hosting
serves `/__/auth/*` itself, which keeps the sign-in redirect same-origin —
otherwise staff opening a link inside WhatsApp or Slack hit
`auth/missing-initial-state`, because those in-app webviews partition storage.

`WEB_CLIENT_ID` in `firebase-config.ts` is filled in from the created OAuth
client. It is not a secret; it ships in every client bundle.

### "Disable client-side sign-up" was WRONG advice — undo it

This file used to call that setting load-bearing. It is not usable at all, and
finding out cost a failed sign-in.

**`disabledUserSignup` blocks ALL client-side account creation — including a
staff member's first Google sign-in**, because creating their account *is* a
sign-up. It fails with `auth/admin-restricted-operation` before `onUserCreate`
ever runs; verified 2026-07-22, no user was created and the trigger logged
nothing. Staff self-onboarding and disabled sign-up are mutually exclusive, and
this app requires staff self-onboarding.

The protection it was meant to provide now lives in `provision.ts`, where it can
tell the two populations apart:

- A real student is created by `createStudent` **without a password**, so it has
  **no provider at all** when the trigger fires → left alone.
- Therefore anything that already has a `password` provider at creation came
  from the client SDK → **deleted**.

Proven both ways in `npm run test:e2e`: a self-signup's credential stops working
(`EMAIL_NOT_FOUND`), and reverting the rule makes that check fail.

---

## Still to do

### ✅ Phase 4 production walkthrough — DONE by the agent (2026-07-22)

Verified against the real project with temporary accounts (deleted after):
publish drove the **deployed `onRecordingWritten` trigger** to fan out an
assignment, a student marked complete (client write accepted, `completed=true`),
and a non-enrolled student's forge attempt was refused 403 — the self-only rule
holding in production. Nothing left for you here.

### ✅ 0–1 done (2026-07-22)

Sign-up re-enabled, you signed in, `onUserCreate` provisioned you as
`manager/pending`, `bootstrapAdmin` promoted you to `admin/active` and was then
**deleted** (URL 404s, and it can no longer be redeployed by accident — it is
exported only against the demo project).

You are the admin on <https://sabeel-class-recordings.web.app>.

### ✅ Sentry — DONE (2026-07-22)

Wired and live on all three surfaces. Web + native use the client DSNs in
gitignored `app/.env.local`; the **functions DSN was set as a Secret Manager
secret** (`SENTRY_DSN`) and the functions redeployed, so server reporting is now
active (secret bound to all 19 functions, verified by name). Reporting is off in
dev/debug bundles by design — events come only from deployed surfaces.

One small deferral, not blocking: **source-map upload** (needs a Sentry auth
token + a `prebuild`), so release stack traces are minified until then; the
errors still report.

### 1. Reword the password-reset email

Authentication → **Templates → Password reset**. Students receive it for an
account they have never had a password on, so the default "reset your password"
wording reads as though something has gone wrong. "Set your password for Sabeel
Class Recordings" or similar.

### ✅ 2. Android app registered — DONE (2026-07-23)

Faisal registered the Android app (`com.sabeelinstitute.classrecordings`) with the
debug SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` and
downloaded `google-services.json`. It is wired in: the Google Services Gradle
plugin is applied, and the file lives at `app/android/app/google-services.json`
(and `app/google-services.json`), **gitignored** — regenerate it from the console
on a fresh clone or the Android build fails. A signed release APK was built,
verified against production (student sign-in + streaming) and shipped as a GitHub
Release. Staff Google sign-in on-device should now work; students already did.

Still for a PUBLIC release (Phase 9): a dedicated **release keystore** (the APK is
currently debug-signed) and **its** SHA-1 registered.

### 3. Not blocking anything

- ✅ **Institute timezone** — set to `America/Chicago` (Houston) in Phase 4.
- **App Check**: Play Integrity (Android) + reCAPTCHA Enterprise (web), plus
  **debug tokens** for the `tb_emu` AVD and local web — without those it locks
  out our own dev builds. Wired but not enforced until then.

## Before Phase 6 (Zoom)

Design decisions (locked 2026-07-24): **one central Zoom user** hosts the class
recordings (not multiple hosts); **manual class mapping** (staff pick the target
class at import time — no auto-map by topic).

- [ ] **Create a Zoom Server-to-Server OAuth app** (internal/private, no
      Marketplace publication). Supply account id, client id, client secret — via
      `firebase functions:secrets:set ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` /
      `ZOOM_CLIENT_SECRET`, never pasted into chat or a file.
- [ ] **Grant exactly these granular scopes** (`:admin`, NOT `:master` — this is
      a single-account S2S app; `:master` is only for master/sub-account ISVs):
      - `cloud_recording:read:list_user_recordings:admin` — list the central
        user's cloud recordings (the import picker; response already carries each
        file's download_url, type, duration, start time).
      - `cloud_recording:read:list_recording_files:admin` — read one meeting's
        recording files (per-recording import + retry via
        `GET /meetings/{meetingId}/recordings`).
      - `user:read:user:admin` — *recommended*, resolve/validate the central user
        by email at runtime instead of hardcoding an id.
      (Not needed unless we later add more hosts:
      `cloud_recording:read:list_account_recordings:admin`. No write scopes — we
      never modify anything in Zoom. Source: developers.zoom.us granular scopes.)
- [ ] **Enable audio-only recording** on that user (Settings → Recording →
      "Record an audio-only file" ON) so recordings produce an **M4A**
      (`recording_type: audio_only`). If existing recordings are video-only with
      no M4A, switch to audio-only going forward rather than building server-side
      ffmpeg extraction.
- [ ] **One real cloud recording with an M4A** on the account — needed only for
      the final "one real import" check; the whole job is built + emulator-tested
      against a fake Zoom first.

## Before Phase 9 (release)

- [ ] **Brand assets**: logo, app icon, splash. Phase 0 ships without them.
- [ ] **Android release keystore + its SHA-1** registered — the release key
      differs from the debug key and Google sign-in breaks without it.
- [ ] **Retention policy** decision. The brief says recordings are kept
      indefinitely; a GCS lifecycle rule is cheap to add but the policy is
      yours. Audio is affordable at any plausible bitrate — five years at
      128 kbps is roughly 96 GiB, about $2/month.

## Optional / whenever

- [ ] **Sentry project + DSN** if you want off-device error visibility.
      `app/src/sentry.ts` is a working no-op seam until then.
