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
| 3 | Media spine (upload → Storage → signed-URL playback → offline downloads) | not started |
| 4 | Assignments, progress, completion | not started |
| 5 | Staff ledger, reporting, audit | not started |
| 6 | Zoom import *(gated on credentials)* | not started |
| 7 | Notifications | not started |
| 8 | Admin backend stats | not started |
| 9 | Deploy, manual, release | not started |

## Decision log

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
