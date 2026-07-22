# Faisal's TODO

Everything that needs a human with console access, a credit card, or a phone.
The agent cannot do any of these. Keep this current — it is the list Faisal
works from.

Phases 0 and 1 needed nothing from this list — `devSignIn` mints a
Google-provider identity in the Auth emulator, and the emulator handles password
resets. **Phase 3 is the first that genuinely blocks**, because signed URLs
cannot be minted against the emulator at all.

---

## ⛔ BLOCKING NOW — Phase 3 cannot be finished without these

Signing a URL needs a service account. The Storage emulator has no signing
service, so the central mechanism of Phase 3 is the one thing that can only be
proven against a real project. Everything else in Phase 3 proceeds meanwhile.

### 1. Create the Firebase project

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

### 2. Create the Storage bucket — region matters

Build → **Storage** → Get started → **location `us-central1`** (or `us-west1` /
`us-east1`; **only those three** carry the no-cost quotas). Take the modern
`*.firebasestorage.app` bucket, not a legacy `*.appspot.com` one — the legacy
rows cap downloads at 1 GB/day instead of 100 GB/month.

**This choice is permanent.** A bucket's location cannot be changed afterwards.

### 3. Grant the signing permission

To sign a URL without a downloaded key file, the function's runtime service
account has to be allowed to **impersonate itself** through the IAM Credentials
API (`signBlob`).

Our functions are **gen 2** (`firebase-functions/v2`), so they run as the
**Compute Engine default** service account —
`PROJECT_NUMBER-compute@developer.gserviceaccount.com` — *not* the App Engine
`…@appspot.gserviceaccount.com` one that most older tutorials name. Granting the
wrong account leaves signing broken with an identical-looking error, so this
derives the id rather than hardcoding it:

```bash
PROJECT_ID=sabeel-class-recordings   # change if you chose a different id
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="$PROJECT_NUMBER-compute@developer.gserviceaccount.com"

gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT_ID"

# Confirm it took:
gcloud iam service-accounts get-iam-policy "$SA" --project="$PROJECT_ID"
```

Run it yourself — type `! gcloud …` in the prompt if you want the output here.
If `gcloud` is not authenticated yet: `gcloud auth login`.

**This is the failure that looks like working code.** Without it, signing throws
only in production; every local test passes. It is why the plan front-loads a
real deploy instead of trusting the emulator.

### 4. Tell me when these are done

Then paste me the web-app config object (it is not a secret) and the project id,
and I will wire `firebase-config.ts`, `.firebaserc`, and deploy the minting
callable to verify a real signed URL end to end.

---

## Before Phase 1 (auth)

- [ ] **Disable client-side email/password sign-up** — Firebase console →
      Authentication → Settings → User actions → uncheck "Enable create
      (sign-up)". **Load-bearing.** The auth-create trigger deliberately leaves
      password accounts alone, because only the Admin SDK is supposed to make
      them. Without this a stranger could self-register — they would get no
      claims and could read nothing, but the accounts would accumulate.
- [ ] **Reword the password-reset email template** (Authentication → Templates)
      from "reset your password" to "set your password". Students receive it for
      an account they have never had a password on, so the default wording reads
      as though something has gone wrong.
- [ ] **Change `FIRST_ADMIN_EMAIL`** in `functions/src/bootstrap.ts` if the first
      admin is not `faisal@oursabeel.com`, then deploy → call once → **delete the
      function**.
- [ ] **Create the Firebase project.** Decide the project id (suggested
      `sabeel-class-recordings`) and who owns billing. Then paste the web app
      config into `app/src/firebase-config.ts` — it replaces the placeholders,
      and it is not a secret.
- [ ] **Create the Storage bucket in `us-central1`** (or us-west1/us-east1).
      It must be a modern `*.firebasestorage.app` bucket: only those get the
      5 GB-month storage / 100 GB-month download no-cost quotas, and only in
      those three regions. A legacy `*.appspot.com` bucket is capped at 1 GB/day
      of downloads. See `docs/research/firebase-recording-costs.md`.
- [ ] **OAuth consent screen** for Google sign-in. If "Make internal" is greyed
      out, the project is not in a Cloud organisation — either move it into the
      Workspace org or accept External **and publish it**, because in `Testing`
      only listed test users can sign in at all.
- [ ] **Android debug SHA-1** registered, then **re-download
      `google-services.json`** — adding the SHA-1 in the console does not update
      a file you already have. Missing this is `DEVELOPER_ERROR` on Android with
      web working fine.
- [ ] **An `oursabeel.com` test account** so the domain restriction can be
      exercised against a real Google identity.
- [ ] **Institute timezone** for date-only due-date rollover (one constant, not
      per-student).

## Before Phase 3 (media)

- [ ] **Grant `roles/iam.serviceAccountTokenCreator`** to the Functions runtime
      service account, so it can sign URLs through the IAM Credentials API
      without a key file. This is a **first-deploy 403 that the emulator cannot
      reproduce** — it will look like working code until it is deployed.
- [ ] **Register App Check**: Play Integrity (Android) + reCAPTCHA Enterprise
      (web), and register **debug tokens** for the `tb_emu` AVD and local web.
      Without the debug tokens, App Check locks out your own dev builds.

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
