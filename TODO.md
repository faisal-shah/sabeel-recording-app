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

## Before real sign-in — Firebase Auth, IN THIS ORDER

Verified 2026-07-22: the Identity Platform config returns
`CONFIGURATION_NOT_FOUND`, i.e. **Firebase Authentication has never been
initialized on this project.** That is why the Google Cloud OAuth page shows
only "Get started" — enabling Google sign-in *in Firebase* is what creates the
OAuth client and the consent-screen entry. Nothing on the GCP side is
configurable before that, and the sign-up toggle below does not exist yet
either, because it is a field of the same config.

Everything here is Firebase console work, so it can be done from a browser.

### 1. Initialize Authentication

Firebase console → **Build → Authentication → Get started**.

### 2. Enable the two providers this app uses

Authentication → **Sign-in method**:

- **Email/Password** — enable. Students use it. Leave "Email link (passwordless)"
  off; we do not use it.
- **Google** — enable. Staff use it. Set the support email when prompted. **This
  is the step that creates the OAuth client**, after which the Google Cloud
  "APIs & Services → Credentials" and consent screen pages become meaningful.

### 3. Disable client-side sign-up  ← the load-bearing one

Authentication → **Settings** tab → **User actions** → uncheck
**"Enable create (sign-up)"**.

This blocks the client SDK from creating accounts while the Admin SDK still can,
which is what `createStudent` uses. It matters because `provision.ts`
deliberately leaves password accounts alone — only the Admin SDK is supposed to
make them. Without this a stranger could self-register; they would get no claims
and could read nothing, but the accounts would pile up.

*(The underlying field is `client.permissions.disabledUserSignup`. Once auth is
initialized I can set and verify it through the Identity Toolkit API — just say
so and I will, rather than you hunting for the checkbox.)*

### 4. OAuth consent screen

Google Cloud console → **APIs & Services → OAuth consent screen**. If **"Make
internal" is greyed out**, the project is not in a Cloud organisation — either
move it into the Workspace org, or accept **External and PUBLISH it**, because
while it is in `Testing` only explicitly listed test users can sign in at all.

### 5. Authorized redirect URI, then the authDomain change

Add `https://sabeel-class-recordings.web.app/__/auth/handler` to the Web OAuth
client's authorized redirect URIs. **Then** tell me and I will change
`authDomain` in `app/src/firebase-config.ts` from the default
`…firebaseapp.com` to `sabeel-class-recordings.web.app`.

Order matters: Hosting serves `/__/auth/*` itself, which keeps the sign-in
redirect same-origin — without it, staff opening a link inside WhatsApp or Slack
hit `auth/missing-initial-state`, because those in-app webviews partition
storage. Flipping `authDomain` before the URI is registered breaks sign-in for
everyone in between. Harmless to do now while nobody signs in to production.

### 6. Reword the password-reset email

Authentication → **Templates → Password reset**. Students receive it for an
account they have never had a password on, so the default "reset your password"
wording reads as though something has gone wrong. "Set your password for Sabeel
Class Recordings" or similar.

### 7. Android Google sign-in (only when you want it on a device)

Register the **debug SHA-1**, then **RE-DOWNLOAD `google-services.json`** —
adding the SHA-1 in the console does not update a file you already have. Missing
this is `DEVELOPER_ERROR` on Android while web works fine.

```bash
keytool -list -v -keystore app/android/app/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android
```

### 8. Not blocking anything

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
