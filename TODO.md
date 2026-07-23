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

### Optional — a ~10-minute production student-flow walkthrough (Phase 4)

Not blocking; the whole flow is proven on the emulator and the AVD, and Phase 3's
staff flow was driven against the real project. But two emulator-green flows have
failed in production this project (the empty index file, the null `classId`), so
a real pass is cheap insurance now that accountability is live. From
<https://sabeel-class-recordings.web.app>, as yourself (admin): create a cohort →
class → student (enrolled) → upload a recording → publish it. Then sign in as
that student (set their password from the emailed link) and confirm the recording
appears under "Your listening", plays, and can be marked complete. Tell me any
step that misbehaves.

### ✅ 0–1 done (2026-07-22)

Sign-up re-enabled, you signed in, `onUserCreate` provisioned you as
`manager/pending`, `bootstrapAdmin` promoted you to `admin/active` and was then
**deleted** (URL 404s, and it can no longer be redeployed by accident — it is
exported only against the demo project).

You are the admin on <https://sabeel-class-recordings.web.app>.

### 1. Reword the password-reset email

Authentication → **Templates → Password reset**. Students receive it for an
account they have never had a password on, so the default "reset your password"
wording reads as though something has gone wrong. "Set your password for Sabeel
Class Recordings" or similar.

### 2. Android Google sign-in — **only when you want it on a device**

Not a prerequisite for anything else. The SHA-1 affects **only** Google sign-in
inside the Android app; it has no bearing on deploys, on web sign-in, or on the
functions. Deferring it costs nothing.

Register the **debug SHA-1**, then **RE-DOWNLOAD `google-services.json`** —
adding the SHA-1 in the console does not update a file you already have. Missing
this is `DEVELOPER_ERROR` on Android while web works fine.

```bash
keytool -list -v -keystore app/android/app/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android
```

### 3. Not blocking anything

- **Institute timezone** for date-only due-date rollover (one constant, not
  per-student). Phase 4 needs it.
- **App Check**: Play Integrity (Android) + reCAPTCHA Enterprise (web), plus
  **debug tokens** for the `tb_emu` AVD and local web — without those it locks
  out our own dev builds. Wired but not enforced until then.

## Before Phase 6 (Zoom)

- [ ] **Create a Zoom Server-to-Server OAuth app** (internal/private, no
      Marketplace publication) with cloud-recording read scopes. Supply account
      id, client id, client secret — via `firebase functions:secrets:set`, never
      pasted into chat or a file.
- [ ] **Confirm audio-only M4A files exist** on the account's cloud recordings.
      If they do not, prefer switching the Zoom account to audio-only recording
      going forward over building server-side ffmpeg extraction.

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
