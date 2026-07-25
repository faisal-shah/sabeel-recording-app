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
| 4a | Client persistence seam (offline groundwork) | **complete** (2026-07-22) |
| 4b | Assignments model, publish fan-out trigger, rules | **complete** (2026-07-22) |
| 4c | Student experience: home ordering, mark-complete, offline | **complete** (2026-07-22) |
| 4d | Catch-up assignment UI + polish | **complete** (2026-07-22) |
| 5a | Audit spine: auditedCall wrapper + auditLog | **complete** (2026-07-22) |
| 5b | Staff ledger reads + completion override | **complete** (2026-07-22) |
| 5c | Ledger + library + audit UI | **complete** (2026-07-22) |
| 5d | CSV export + polish | **complete** (2026-07-22) |
| 4 | Assignments, progress, completion | not started |
| 5 | Staff ledger, reporting, audit | not started |
| 6 | Zoom import *(gated on credentials)* | not started |
| 7 | Notifications | not started |
| 8 | Admin backend stats | not started |
| 9 | Deploy, manual, release | not started |

## Decision log

- 2026-07-24 — **The recording upload is a state, not a branch** (v0.2.1 fixes,
  from a screen-recording of the live app). A staff upload *spans* the moment the
  recording document starts existing — the server must mint the id before the
  client may write to Storage — so the live listener flips `recording` from null
  to set **mid-upload**. Anything keyed on that branch is destroyed exactly when
  it is needed: the progress bar lived only in the no-recording branch, so a
  healthy upload rendered as `draft · no duration` + *"This recording has no
  audio"* + a delete button for its whole duration. Fixed by owning the upload
  state **above** the branch and making "exists but has no audio" a first-class,
  recoverable state (mid-upload / failed / audio removed) rather than an error.
  Consequences worth keeping:
  - **An audio-less recording must offer a way back.** `clearAudio` was always
    documented "so it can be re-uploaded" and `storage.rules` re-allows the write
    once the object is gone, but no UI path existed — so **Remove audio was a
    one-way door** out of a usable recording, escapable only by deleting it.
  - **Discarding an empty draft is not permanent deletion.** Deletion is
    admin-only *because* it destroys listening history; an empty draft provably
    has none (publish is blocked without audio — `publishBlockers` — and
    assignments only fan out on publish), so course scope suffices. See
    `isEmptyDraft`. This is what lets a manager clean up their own failed upload.
  - **Delete the audio object at its CANONICAL path, not via `audioPath`.** Bytes
    that landed but never finalized leave the field `null`; keying the delete off
    the field orphaned them in Storage forever — the one thing here that costs
    money.
  - **A confirmation that leaves its subject operable is not a confirmation.**
    Both destructive confirms appended below still-live action rows. Now one
    shared `ConfirmDanger` that *replaces* the actions while open.
  - **Testing gotcha:** going offline mid-upload does **not** fail an upload —
    `uploadBytesResumable` resumes when the network returns (this produced a
    false negative). Block the `finalizeRecordingUpload` callable instead: bytes
    land, confirmation never does, which is a real failure mode and fails fast.

- 2026-07-24 — **Attendance-driven assignment: Class → Course, and a new Session
  entity (major model rework).** The app exists for students who *missed* the
  in-person class; a recording is required listening only for the absentees. So
  obligations are now driven by attendance, not by a blanket publish fan-out.
  Model is now **Cohort → Course → Session → Recording**: `class` → `course`
  throughout, and a new `sessions/{id}` owns `attendance`
  (`present`/`absent`/`excused` per student, an explicit-submit SNAPSHOT),
  `date`, `title`, `dueDate`, `notes`, and its 0..1 `recordingId`. A recording is
  pure media + lifecycle, linked by `recording.sessionId`; the student-facing
  `title`/`notes`/`date` are **denormalised** onto it (students cannot read
  sessions). Assignment target = `absent ∪ excused`, reconciled by
  `reconcileSessionAssignments` once the recording is published AND attendance
  submitted; two triggers converge on it (`onRecordingWritten` +
  `onSessionWritten`). Greenfield, so this was a rewrite, not a migration:
  **deleted** the `catchup` concept + its screen, `assignment.source`, the
  retroactive late-enroll fan-out (accountability is now enrollment-onward — a
  student not in a session's snapshot is never assigned it), and the recording's
  own `title`/`dueDate`/`notes`/`recordedAt`. Phases: **A** model/engine/rules/
  re-seed, **B** staff UI (Sessions + SessionDetail with 3-state attendance,
  recording-in-session, Zoom→session), **C** recording-ledger split (accountable
  = absent+excused with the excused flagged; attendees = present, listening shown
  but never overdue), **D** course attendance report (by-session / by-student
  toggle + catch-up status, CSV per cut). All green: unit + emulator suites and
  the rewritten `web-e2e.mjs` drive the full attendance→publish→assign→ledger
  flow. Supersedes the recording-centric class screen shipped 2026-07-22/24.

- 2026-07-24 — **Cohort shown with class name in cross-cohort STAFF views;
  deferred for STUDENT views.** A class name alone is ambiguous when the same
  name recurs across cohorts (two "Arabic 1"s). Fixed in the recording library,
  the listening-progress ledger and the staff player via `useCohortName()`
  (v0.1.7). **Student-facing screens ("Your listening", a student's recordings)
  are deliberately left as-is:** the rules make `cohorts` staff-only
  (`allow get, list: if isStaff()`), so students cannot read cohort names —
  showing them there would need the cohort name **denormalised** onto the class
  (or recording) docs students already read, written by a Cloud Function.
  Deferred as a potential improvement: low impact (a student's classes are
  usually one cohort); revisit if students end up enrolled across cohorts with
  colliding class names.

- 2026-07-22 — **Phase 5 locked in planning.** (1) Audit via a wrapper
  (`auditedCall`) — comprehensiveness by construction, not per-callable
  discipline. (2) Staff completion override is a SEPARATE server-only doc
  (`completionOverrides`) the student cannot clobber; effective status = override
  ?? student. (3) Ledger aggregation is a client-side live join (no server
  aggregation); manager queries stay class-scoped. (4) Scope = ledger/reporting/
  audit only — the cross-cohort recording library + CSV are in; admin backend
  stats stays Phase 8; permanent deletion is out (no delete callables exist).

- 2026-07-22 — **Phase 4 accountability model, locked in planning.** (1) Offline
  completion uses Firestore's native persistent cache + `hasPendingWrites`, not a
  hand-rolled queue. (2) Publish fan-out is a Firestore trigger
  (`onRecordingWritten`), not inline in the publish callable, so publish / class
  move / due-date edit / unpublish all funnel through one idempotent path. (3)
  Normal (`publish`) assignments track the recording's due date; `catchup`
  assignments keep their staff-chosen date. (4) The "never played" completion
  gate is client-side only — a rule requiring the progress doc would false-reject
  offline completions on replay. (5) Overdue = the day AFTER the due date in
  `America/Chicago`; computed client-side, no cron. (6) A queryable `completions`
  state doc AND an append-only `completionEvents` log, both client-written and
  self-only. Completion is keyed by student+recording so it can exist for an
  accessible-but-unassigned recording.

- 2026-07-22 — **Institute timezone is `America/Chicago`** (Houston, TX). Due
  dates are date-only, so "overdue" is decided entirely by where the day rolls
  over; this is ONE institute-wide constant, not per-student. Recorded here
  rather than added to `@sabeel/shared` today, because this repo adds
  infrastructure with its first consumer and knip fails on anything unused — it
  lands in Phase 4 alongside the code that reads it.

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

- 2026-07-22 — **Phase 5 proven in PRODUCTION (multi-role).** Temp admin + two
  managers (each scoped to one class) + two students, deleted after: publish
  fanned out the assignment; the deployed `overrideCompletion` wrote the override
  doc with its reason and recorded it in the audit log; and the scoped reads held
  against the real rules — the class's manager reads the override, ANOTHER class's
  manager gets 403, a student reads their own but not another's, and no client
  (even a manager) can write an override directly. All temp data cleaned up.

- 2026-07-22 — **Phase 5c + 5d: ledger UI, library, audit, CSV.** Contextual
  staff views, all client-side live joins over the 5b reads, computing with the
  pure `ledger.ts`: a **recording ledger** (accountable roster, action-first
  Not-complete/Overdue chips, per-row effective status + listened% + override
  form) opened from `RecordingsScreen`; a **student ledger** from the ClassDetail
  roster; **class-level incomplete/overdue counts** on ClassDetail; the
  cross-cohort **recording library** with status counts (Phase-3-deferred) from
  Home; and a scoped **audit view** (per-class + admin-global). CSV export is a
  pure `toCsv` (7 unit tests) behind a web/native seam (Blob download / share
  sheet, `expo-sharing`+`expo-file-system`). e2e drove it end to end: the ledger
  renders the roster, a staff override (with reason) writes the override doc and
  shows Complete (override), the **CSV mirrors the ledger row-for-row** (the
  brief's exit criterion), and the audit view shows the override with its reason.
  Screens looked at — on-brand. No new indexes (recordingId reads are
  pure-equality). 76 shared + 42 functions unit.

- 2026-07-22 — **Phase 5b: staff ledger reads + completion override.** Opened
  staff-scoped reads (via a new `staffManagesClass(classId)` rules helper) on
  `completions`, `completionEvents`, `listeningProgress`, plus the new
  server-only `completionOverrides` (student reads their own; staff scoped). The
  `overrideCompletion` callable writes a SEPARATE override doc a student cannot
  clobber, with a REQUIRED reason (empty rejected) that lands in the audit
  detail; `clearCompletionOverride` removes it. Pure `ledger.ts`
  (`effectiveCompletion` = override ?? student, `rollup`, `ledgerBucket`) — 8
  unit tests at the day boundary. 172 emulator tests (was 151). Mutation:
  widening `staffManagesClass` reddened exactly the 8 cross-class ledger tests.
  `check:queries` needed exactly ONE new composite — `auditLog (classId, at
  desc)` for the ordered manager audit view — now built and servable in prod;
  every ledger read is pure-equality.

- 2026-07-22 — **Phase 5a: audit spine.** `auditedCall(action, handler)` extends
  `reportedCall` so all 16 mutating callables write one `auditLog` entry per
  successful call automatically (reads like `getPlaybackUrl` stay `reportedCall`);
  the auth trigger audits its provision/reject decisions. Class-scoped handlers
  set `audit.classId` so a manager can read their-class entries; class-less
  actions (cohort/staff/student-directory) are admin-only. The audit write is
  best-effort — a failed audit never undoes or fails a completed mutation. New
  `auditLog` rule mutation-tested (widening manager scope reddened exactly the
  three scope tests; opening writes reddened the write test). e2e proved it end
  to end: after a full run the log held all 13 distinct staff actions, class
  entries carrying classId, cohort entries null. 151 emulator tests (was 144).

- 2026-07-22 — **Phase 4 proven in PRODUCTION, end to end.** Driven through the
  real callables with temporary accounts (deleted after): the deployed
  `onRecordingWritten` trigger fanned out an assignment (`source:publish`,
  active) — the first time the real trigger has been exercised in prod, and it
  survived the Eventarc first-deploy retry; a student's completion write was
  accepted by the self-only rule (`completed=true`); and a non-enrolled student's
  forge attempt was refused 403. Doubles as a happy-path check that the
  Sentry-instrumented functions still work after redeploy.

- 2026-07-22 — **Sentry live on all three surfaces.** Web reporting deployed;
  the functions `SENTRY_DSN` secret set in Secret Manager and the functions
  redeployed, so server reporting is active — the secret is bound to all 19
  functions (verified by name: callables via `reportedCall`, the fan-out trigger,
  and the gen-1 auth trigger). `@sentry/react-native` proven to autolink into the
  committed `android/` build and run on the AVD. Reporting is gated OFF in
  dev/debug bundles, so events come only from deployed surfaces. Source-map
  upload deferred (needs a Sentry auth token + prebuild). No DSN value is in git.

- 2026-07-22 — **Phase 4d: catch-up staff UI, end to end.** A published
  recording's card now offers "Assign as catch-up", listing enrolled students who
  are NOT already accountable (normal publishing covered the rest) with an
  optional due date. e2e proves the whole scenario: a recording driven past-due,
  a genuinely late student enrolled (and confirmed NOT auto-assigned it), then
  staff assigning it as catch-up with its own due date — one `source:'catchup'`
  assignment created, and the candidate list correctly emptied afterward
  (screenshot looked at, on-brand). The callable itself was already integration-
  tested in 4b (scope, enrolment, published-only, due-date protection).

- 2026-07-22 — **Phase 4c native durability spike, PROVEN on the tb_emu AVD.**
  The deferred 4a question is resolved with a real force-kill test, not an
  assumption. On native the JS SDK has only a memory cache, so a completion
  marked offline is lost across an app kill — confirmed: after marking complete
  with wifi off and force-stopping the app, Firestore held **0 completions**. A
  native-only AsyncStorage outbox (`completionOutbox.ts`, a no-op on web where the
  persistent cache suffices) closes the gap: on relaunch with the network back,
  `drainCompletionOutbox` replayed the queued write and it synced
  (`completed=true`), with the home showing Completed and the session still
  signed in (AsyncStorage auth survived the kill too — the same durability
  substrate the outbox relies on). Every player control rendered correctly on
  native (screenshots looked at). The web e2e re-run green through the seam.

- 2026-07-22 — **Phase 4c (part): student home, completion, unassigned labels.**
  A student's landing is now a task-ordered home (Overdue → Due soon → Upcoming →
  No due date → Completed), built from their own live `assignments` + `completions`
  joined to recording/class details. Completion is a direct client Firestore
  write (`completions` state doc + append-only `completionEvents`), offline-capable
  via the persistent cache, with the never-played gate enforced in the player.
  `useLiveQuery` gained an opt-in `includeMetadataChanges` so the Pending-sync
  badge clears when a queued write lands. The class archive labels
  accessible-but-unassigned recordings "Not required". e2e extended and green:
  publish → the item appears as required on the home → mark complete writes the
  doc + event → the player shows Completed/Unmark → the home moves it to
  Completed (screenshots looked at: on-brand, correct grouping). **Still pending
  in 4c:** the native app-kill durability spike on the AVD (deferred from 4a) and
  its AsyncStorage backstop if the queued write is lost across a force-kill.

- 2026-07-22 — **Phase 4b: assignment model, fan-out, rules.** Pure due-date
  maths in `@sabeel/shared` (`todayInZone`/`isOverdue`/`dueBucket`) — 16 unit
  tests incl. the Houston day boundary (due-today is *due*, next day *overdue*)
  and a DST case. Fan-out logic (`applyRecordingFanout` + helpers) integration-
  tested against the emulator: publish creates one active assignment per active
  enrollment and is **idempotent** (re-publish stays at 2, not 4); unpublish
  deactivates but keeps rows; a due-date edit moves `publish` assignments while a
  `catchup` keeps its own date; a class move reassigns to the new roster; late
  enrollment assigns only not-yet-due published recordings; unenroll deactivates.
  New rules (`assignments` read-scoped like `/enrollments`; `completions`
  self-only; `completionEvents` append-only) mutation-tested — flipping the
  completionEvents immutability guard and the completions self-only guard each
  reddened exactly one assertion, restored clean. 144 emulator tests (was 119).
  **check:queries confirmed zero new composite indexes are needed** — every
  Phase 4 query is pure equality, served by single-field zigzag joins. The e2e
  now proves the REAL `onRecordingWritten` trigger fires: after publishing, the
  enrolled student's assignment appears.

- 2026-07-22 — **Phase 4a: Firestore persistence seam.** `app/src/firestoreInit.ts`
  / `.web.ts` mirror the existing auth seam: web gets `persistentLocalCache`
  (IndexedDB) so offline writes survive a page close and surface as
  `hasPendingWrites`; native keeps the memory cache, because the JS SDK has no
  IndexedDB on React Native (the same reason auth is wired to AsyncStorage). Full
  e2e re-run green with persistence on, including the Phase 3 resume-across-reload
  test. **Deliberately split from the plan's 4a:** the native app-kill durability
  check needs the completion write path to exist, so it moves to 4c on the AVD,
  where the memory-cache gap is closed by an AsyncStorage backstop over the same
  direct-write path if the test confirms it is lost across a kill.

- 2026-07-22 — **Phase 3 proven end to end against the REAL project.** Driven
  through the actual callables with real ID tokens: createCohort → createClass →
  createStudent+enrollment → createRecording → upload through the Storage REST
  API with a staff token (so `storage.rules` was genuinely exercised, not
  bypassed by the Admin SDK) → finalize read back the exact 509,121 bytes →
  publish → a student signed in, `getPlaybackUrl` returned a **real V4 signed
  URL** (`X-Goog-Signature` present, ~12 h), it streamed the exact file, range
  requests answered 206, a second upload was refused 403 (write-once), and a
  NON-enrolled student was refused playback. All temporary data and accounts
  deleted afterwards; the walkthrough script is deliberately NOT committed,
  because it mints an account with admin claims and a known password.
- 2026-07-22 — **`createStudent` rejected the very first student**, before any
  class existed, with "classId must be a class id." The callable client
  serializes an explicitly-`undefined` property as **null**, so the UI's
  `classId: classId ?? undefined` arrived as `classId: null` and a guard testing
  only `!== undefined` treated it as a bad value. Fixed on both sides (server
  treats null as absent; client omits the key) and verified in production with
  the exact failing payload. The walkthrough above had missed it by always
  passing a classId — a reminder that a happy-path script is not coverage.

- 2026-07-22 — **`firestore.indexes.json` was EMPTY, and no test could have told
  us.** The Staff and Students screens both showed
  `Live data error (decidedStaff): failed-precondition` on the first real use.
  The Firestore **emulator builds indexes on demand and never returns
  FAILED_PRECONDITION**, so all 119 emulator tests and every e2e check passed
  against an index file containing nothing at all. Four composite indexes were
  needed (staffUsers status+createdAt, staffUsers status+displayName, classes
  cohortId+createdAt, recordings classId+createdAt) and are now deployed.
  `npm run check:queries` (new, committed) runs all twelve query shapes the app
  issues against the REAL project and fails on any that needs a missing index —
  the only check that can catch this, since shape rather than data determines it.
  Note the two staffUsers indexes reported "currently building" for ~2 minutes
  AFTER `gcloud` reported them READY.

- 2026-07-22 — **First admin bootstrapped in production, and the endpoint
  removed.** `onUserCreate` provisioned the real Google sign-in as
  `role: manager, status: pending` — domain membership granting nothing, as
  designed. `bootstrapAdmin` then promoted it to `admin/active`, refused a replay
  with 409, and was deleted (URL 404s).
  It is now exported ONLY against the demo project: it cannot be deleted from the
  repo because the e2e uses it for the same bootstrap problem in miniature, and
  leaving it in the export list would silently recreate an unauthenticated
  admin-granting endpoint on the next deploy. Verified by loading the built
  bundle under each project id — 17 functions and ABSENT for the real project,
  18 and PRESENT for demo — and then by a full `deploy --only functions` that
  left the URL 404ing.
- 2026-07-22 — **The first-admin address was duplicated and drifted.** The
  callable hardcoded a guessed local part while the dev sign-in row hardcoded
  another; correcting the callable to the real address made the e2e bootstrap a
  user the callable would not promote, and it failed at the first authenticated
  screen. Now one `FIRST_ADMIN_EMAIL` in `@sabeel/shared`, consumed by both.

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
