# Faisal's TODO

Everything that needs a human with console access, a credit card, or a phone.
The agent cannot do any of these. Keep this current — it is the list Faisal
works from.

Nothing here blocks development: `devSignIn` mints a Google-provider identity in
the Auth emulator, and the Auth emulator handles password resets, so every phase
before 6 is buildable and testable before the real Firebase project exists.

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
