# Phase status

Live build status. Phases from `PLAN.md`; a commit lands at each phase boundary.

Nine phases, not ten: Phase 2 was absorbed into Phase 1. The later numbers are
deliberately NOT renumbered — they are referenced from `PLAN.md`, code comments
and commit messages, and renaming them would strand every one of those.

| Phase | What | Status |
|---|---|---|
| 0 | Scaffold, theme, CI green | **complete** (2026-07-21: token screen verified on tb_emu AVD + web export, rules suite mutation-tested, full chain green) |
| 1a | Identity: two auth populations, roles, approval | **complete** (2026-07-21) |
| 1b | Academic structure: cohorts, classes, enrollments, manager scoping | **complete** (2026-07-22) |
| 1c | Rules hardening, e2e harness | **complete** (2026-07-22) |
| ~~2~~ | *Academic structure — absorbed into Phase 1, see the decision log* | — |
| 3a | Media spike: background audio, seek, rate | **complete** (2026-07-22) |
| 3b | Ingestion & lifecycle: upload → Storage → draft → publish | **complete** (2026-07-22) |
| 3c | Playback: signed URLs, player, progress | **complete** (2026-07-22) |
| 3d | Offline downloads | deferred to its own phase |
| 4 | Assignments, progress, completion | not started |
| 5 | Staff ledger, reporting, audit | not started |
| 6 | Zoom import *(gated on credentials)* | not started |
| 7 | Notifications | not started |
| 8 | Admin backend stats | not started |
| 9 | Deploy, manual, release | not started |

## Decision log

- 2026-07-22 — **GCS returns 400 on an expired signed URL, not 403.** The body is
  `<Code>ExpiredToken</Code>`. Any refresh logic keyed on 403 would silently
  never fire, so URLs are re-minted PROACTIVELY when under an hour remains
  rather than in response to a failure.

- 2026-07-22 — **The emulator playback URL needs a download token.** A plain
  `?alt=media` URL is rules-governed, and `storage.rules` denies all reads by
  design — production playback bypasses rules by being signed. The emulator
  branch therefore uses the one other mechanism that bypasses them: a download
  token. That is precisely the never-expiring mechanism rejected for production,
  and it is acceptable only because that branch cannot run against a real
  project.

- 2026-07-22 — **`listeningProgress` is the only client-written collection.** A
  callable every 15 seconds per listening student is pure overhead, and listened
  time is audit evidence rather than the gate — completion is student-attested
  and blocked only if they never played. The rule is self-only and field-scoped.
  Note the null guard: `resource` is null when the document does not exist,
  which is the first-time resume path, and dereferencing it is an evaluation
  ERROR rather than a denial — it surfaced as a broken player.

- 2026-07-22 — **The emulator Storage bucket needs an explicit constant.**
  Neither side has a usable default: the client's `firebaseConfig.storageBucket`
  is a placeholder until the real project exists, and the Admin SDK throws
  "Bucket name not specified" without one. Overriding only `projectId` for the
  emulator left the client uploading to one bucket while the server looked in
  another — and the only symptom was finalize reporting "no audio found" for a
  file that had uploaded successfully. `EMULATOR_STORAGE_BUCKET` in
  `@sabeel/shared` is now used by the app, the functions and the tests. The
  integration suite had hidden the mismatch by hardcoding its own bucket name.

- 2026-07-22 — **Recording audio is write-once in Storage.** `resource == null`
  in `storage.rules` means a published recording's audio can never be swapped
  underneath students who already listened. Replacing it goes through
  `clearRecordingAudio`, which refuses unless the recording is a draft. Storage
  rules cannot read Firestore, so class scope is enforced in `createRecording`
  (before the id is handed out) and again at publish; the rule can only ask "is
  this active staff".

- 2026-07-22 — **Uploading is web-only for now** (`filePicker.ts` seam). It needs
  a document-picker native module, and the brief describes upload as the staff
  exception path done from the recording library. Android explains this rather
  than showing a control that cannot work.

- 2026-07-22 — **`expo-audio` config had to be made explicit**, found by the 3a
  spike. Config plugins only run during `prebuild`, and this is the bare workflow
  with a committed `android/`, so adding the plugin to `app.json` silently added
  nothing: no `FOREGROUND_SERVICE`, no media service, no notification permission.
  Background audio still *worked* on the emulator without them, which is exactly
  how this would have shipped broken. `npx expo prebuild --platform android`
  regenerates the manifest; `recordAudioAndroid: false` keeps the plugin from
  requesting a microphone this app never uses; `POST_NOTIFICATIONS` is requested
  explicitly because the plugin only adds it for background *recording*, not
  playback. Generalised into the `expo-firebase-stack` skill (`9bef5a0`).

- 2026-07-22 — **Offline downloads deferred out of Phase 3** into their own
  phase. The brief calls them optional while streaming is required, and Phase 3
  is the highest-risk phase already.

- 2026-07-22 — **`listeningProgress` moved from Phase 4 into Phase 3.** "Resume
  progress" is a Phase 3 playback requirement and is meaningless without
  persistence; building it locally now and again in Firestore later is waste.
  Phase 4 keeps assignments, completion and the ledger — accountability, not
  playback.

- 2026-07-22 — **`list` rules must reference `resource.data`.** The first draft
  of the enrollments rule was `isAdmin() || isStudent() || isStaff()` with a
  comment saying students would constrain their query — which would have let any
  student list every enrollment in the institute. Referencing `resource.data` is
  what makes Firestore reject an unconstrained query; a comment enforces nothing.

- 2026-07-22 — **A `get()` resolved from document data costs one read per row.**
  Firestore caps document-access calls per query, so such an arm is only
  affordable when every row resolves the same path — true of a roster query
  (`classId ==`), false of anything spanning classes. Each read-requiring arm is
  therefore kept behind a role guard that excludes populations whose queries span
  many parents. `rules.structure.test.ts` sizes both cases at 25 rows, because at
  three they pass either way.

- 2026-07-22 — **Arm ordering is NOT what protects the student query.** An
  earlier comment claimed it was. Reordering the arms and re-running the scale
  tests proved otherwise: `isStaff() &&` short-circuits before the `get()`, so a
  student never triggers a class read whatever the order. Read-free arms are
  still written first as defence in depth, but the guard is what holds.

- 2026-07-22 — **`effectiveActive` is computed inside the callables**, not by a
  Firestore trigger. Clients cannot write these collections at all, so there is
  nothing for a trigger to defend against; inline means no propagation lag and
  one testable path. The cohort cascade never writes a class's own `archived`
  flag, which is what makes reactivation restore each class to its prior state.

- 2026-07-22 — **Unenrolling sets `active: false`; it never deletes.** The brief
  requires listening history to survive across enrollments, and a hard delete
  removes the record that history hangs off. Re-enrolling reuses the same
  composite-id document and preserves the original enrolment date.

- 2026-07-22 — **`managerClassScopes` dropped; `managerUids` lives on the class.**
  Recorded in the plan and implemented here. `setClassManagers` validates every
  uid is an *active* staff member, because the rules read that array directly —
  writing an invented or disabled uid into it is granting access.

- 2026-07-22 — **Class mutation is admin-only.** The brief gives admins
  "manage cohorts/classes globally" and "assign Managers class by class", while
  managers get "create/manage students in assigned classes". So there is no
  manager-write case on a class; managers get scoped read plus the roster.

- 2026-07-22 — **The student directory is readable by all staff** (Faisal). A
  manager can list every student, not only those in their classes — that is what
  makes enrolling an existing student possible. Every student mutation is still
  scoped or admin-only. A deliberate privacy call, noted in `firestore.rules` so
  it is not later read as an oversight and "fixed".

- 2026-07-21 — **Phases 1 and 2 merged.** Manager scopes are class-by-class and
  student quick-create takes an enrolled class, so splitting them would mean
  writing the security rules twice — once in a shape that cannot be enforced,
  then again against real classes. Nine phases, not ten.

- 2026-07-21 — **`managerClassScopes` dropped in favour of `managerUids` on the
  class document.** A rule that depends on a cross-document `get()` forces every
  listing client to carry a matching `where` clause and costs a read per row; a
  denormalised array supports `array-contains` instead. Same reasoning puts
  enrollments at a composite id `{studentUid}_{classId}`, so a student lists
  their own enrollments and never lists classes. The brief's data model states it
  "is not the final schema"; this is a sanctioned consolidation.

- 2026-07-21 — **`role` is one claim** (`admin` | `manager` | `student`), kanban's
  shape rather than the time-tracker's role + separate `admin` boolean. Nobody
  here is a manager *and* separately an admin, so one field cannot get into an
  inconsistent pair.

- 2026-07-21 — **Students arrive active, with no pending state.** Staff creating
  them is the approval. No separate email verification either: completing the
  set-password link proves mailbox control, and the address was asserted by
  staff.

- 2026-07-21 — **App identity**: `com.sabeelinstitute.classrecordings`, slug
  `sabeel-class-recordings`, launcher label "Class Recordings". The brief's
  product name (*Hikam Foundations Class Recordings*) is too long for a launcher
  and bakes one course into the identifier.

- 2026-07-21 — **Phase 0 runs entirely on emulators.** `firebase-config.ts` ships
  placeholders and `.firebaserc` is unset, so nothing before Phase 6 blocks on
  Faisal. The real project is created when Phase 1 first needs a real sign-in.

- 2026-07-21 — **Playback is a 12-hour V4 signed URL** minted by a callable that
  has already checked enrollment, with App Check enforced on it. Faisal's threat
  model: a leaked link must *expire*, but a determined user extracting audio from
  their own device is acceptable. That rules out `getDownloadURL()`, whose
  download token never expires. It does **not** require download-then-play, so
  progressive streaming, instant start and free seeking all stay. Audio is never
  proxied through a Function — the 60-minute timeout would kill a 2-hour session.

- 2026-07-21 — **Zoom import deferred to Phase 6**, against the risk register's
  "prove Zoom first". Zoom credentials are a pending external input, and manual
  upload exercises the whole media pipeline anyway.

- 2026-07-21 — **Infrastructure arrives with its first consumer.** `liveQuery.ts`,
  Firestore/Storage/Auth initialisation and navigation were all deferred out of
  Phase 0 because nothing consumed them, and `knip` correctly called them dead.
  Scaffolding ahead of need makes the dead-code audit lie, and an audit that
  reports nothing is worse than none.

## Verification log

- 2026-07-22 — **Self-signup is deleted by the trigger, proven in both
  directions.** The first version of this e2e check was VACUOUS: it polled the
  Auth emulator's `/emulator/v1/projects/*/accounts` endpoint, which is
  DELETE-only, so the GET returned `Method GET not allowed`, `userInfo` was
  undefined and the check passed unconditionally. It survived a deliberate
  mutation of the very rule it protects, which is the only reason it was caught.
  Rewritten to assert on *using* the credential — mutation in place: FAIL
  ("sign-in still succeeded"); mutation removed: ok (`EMAIL_NOT_FOUND`).
- 2026-07-22 — **`disabledUserSignup` is unusable, discovered on the first real
  sign-in.** Google sign-in returned `auth/admin-restricted-operation`; the live
  project showed **0 users** and `onUserCreate` had **0 log entries**, so the
  block happens before the trigger. Creating a staff member's account IS a
  sign-up, so that console setting and staff self-onboarding are mutually
  exclusive. The guard moved into `provision.ts`, which can distinguish the two
  populations: a real student has NO provider at creation (created without a
  password), so a `password` provider at creation can only be a client sign-up.

- 2026-07-22 — **First production deploy: rules, indexes, 18 functions, Hosting.**
  The Firestore database did not exist and was created by the rules deploy.
  `npm run smoke:prod` (new, committed) then verified the *deployed* artefact
  rather than the local one, which is the only place these can be checked:
  Hosting serves `/__/auth/handler` (200), the bundle contacts **no** emulator
  host, the dev sign-in row does not render, and the console is clean. Auth
  config read back from the live Identity Toolkit API:
  `disabledUserSignup: true`, email/password on, email-link off, anonymous off,
  `authorizedDomains` covering both hosting domains. `authDomain` flipped to
  `…web.app` and `WEB_CLIENT_ID` filled in from the created OAuth client.
  **`onUserCreate` domain enforcement is now live** — before this deploy it
  existed only in the repo, so a stray Google sign-in would have persisted.
- 2026-07-22 — **Signing proven against the real project**, which no emulator
  test can do. A V4 URL signed by the compute service account streamed the exact
  3,049,585 bytes, answered a range request with 206, and a deliberately
  10-second URL was then refused with `ExpiredToken`. The probe function and its
  object were deleted immediately after.
- 2026-07-22 — **Phase 3c end to end.** The committed e2e now covers upload →
  publish → a student playing: audio advances (0:06 after six seconds), progress
  is persisted, and playback **resumes at 0:36 after a reload**. 119 emulator
  tests. Three mutations on the progress rules; the third initially caught
  nothing, which exposed a missing list-coverage test — now added and verified
  to fail under the same mutation.

- 2026-07-22 — **Phase 3b end to end on the web dev server.** A real 12-minute
  32 kbps M4A uploaded through the UI: duration 720 s read client-side, size
  3,049,585 bytes read server-side from Storage (matching the file), then
  published with `publishedAt` stamped. 111 emulator tests. Five rule mutations
  each caught by the right tests: recordings' student `published` check, its
  enrolment check, its staff `managerUids` check, Storage write-once, and
  Storage staff-only upload.

- 2026-07-22 — **Phase 3a spike, on the AVD.** `expo-audio` background playback
  survives backgrounding and 60 s of screen-off (position advanced 0:00 → 1:57,
  matching wall-clock); a media3 `MediaSession` registers and media transport
  controls appear in the shade; seek to 10:00 into a 12-minute file works over
  HTTP range requests (6 GETs observed); 2x playback rate applies with no
  buffering stall; duration is read correctly from a remote URL. Signed-URL
  streaming is the one spike item still unproven — it needs the real project.
  Spike code deleted; the `app.json` and manifest fixes it produced are kept.

- 2026-07-22 — **Phase 1b/1c verified end to end.** `npm run test:e2e` (new,
  committed) drives 17 checks on the web dev server: pending on first sign-in,
  live un-gating via bootstrap and via admin approval, off-domain deletion,
  cohort and class creation, manager scoping, student created-and-enrolled in one
  step, roster, set-password link redeemed and used to sign in, and the full
  archive cascade round-trip read back from Firestore. Android parity confirmed
  on the `tb_emu` AVD (`versionName=0.1.0` confirmed installed).
- 2026-07-22 — **Six rule mutations, each caught by the right tests.** Class
  manager-scoping removed; enrollment student arm widened; enrollment staff arm
  widened; the student class-read enrolment check dropped; cohorts opened to any
  signed-in user; enrollments made client-writable. Restored and green after each.
- 2026-07-22 — **The e2e harness was itself mutation-tested, and a gap found.**
  Widening the manager-scope rule did NOT fail the e2e, because `useMyClasses`
  filters via `array-contains` in the query — the check was testing the query,
  not the boundary. The check names were corrected to say what they actually
  prove, and the harness header now states it is a flow suite, not a security
  suite. A check whose name overstates its coverage makes a suite look stronger
  than it is.

- 2026-07-21 — **Phase 1a, end to end on both surfaces.** First staff sign-in
  lands pending; `bootstrapAdmin` promotes and the gate lifts **live with no
  sign-out**; a second call to it 409s; an admin approves a pending manager and
  *their* gate lifts live; an off-domain sign-in has its auth user deleted and
  lands back at sign-in; a student is created, sets a password from the emulator's
  emailed link, and signs in. Verified on the web dev server and on the `tb_emu`
  AVD (`versionName=0.1.0` confirmed installed).
- 2026-07-21 — **Identity rules mutation-tested, three ways.** `isActive()`
  ignoring status → the pending and disabled tests went red. `isStaff()` widened
  to any active user → the student-isolation tests went red. `staffUsers` given a
  self-write → the no-write test went red. Restored and green each time.
- 2026-07-21 — **Dev sign-in row confirmed absent from a production render.**
  Note that grepping the exported bundle is NOT a valid check: the strings
  survive minification because the component is still referenced from a branch
  the minifier cannot prove dead. See `docs/DEV-TOOLING.md`.

- 2026-07-21 — **Rules suite mutation-tested.** `assertFails` passes when an
  operation fails for *any* reason, so a deny-all suite can pass while testing
  nothing. Flipped both `firestore.rules` and `storage.rules` to
  `allow read, write: if true`; all 6 tests went red; restored and they went
  green. The suite genuinely exercises both rule files.
- 2026-07-21 — **knip proven to fail.** Added a throwaway unused export, knip
  exited 1; removed it, knip exited 0. The CI step is not decorative.
- 2026-07-21 — **esbuild bundling verified.** `@sabeel/shared` is inlined into
  `functions/lib/index.js` (zero `require("@sabeel/shared")`) while
  `firebase-functions` stays external — the shape Cloud Build needs.
