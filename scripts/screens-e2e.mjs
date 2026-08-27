#!/usr/bin/env node
/**
 * THE visual/layout regression sweep. Every screen, every width, looked at AND
 * checked.
 *
 *   bash scripts/screens-e2e.sh                       # the CI set
 *   SWEEP_WIDTHS=320 bash scripts/screens-e2e.sh      # one width, tight loop
 *   SWEEP_FULL=1 bash scripts/screens-e2e.sh          # + real device profiles
 *
 * A TOUR THAT CANNOT FAIL IS A SCREENSHOT GENERATOR. This one exits non-zero,
 * and `functions/test/unit/ciCoverage.test.ts` fails if CI ever stops running
 * it. That is the whole difference between this and a folder of pretty pictures
 * nobody diffs.
 *
 * WHAT IT CHECKS, and the failure each check is here for:
 *
 *   - the page never scrolls sideways    the classic responsive failure a
 *                                        top-of-page screenshot never reveals
 *   - nothing is clipped by the right    distinct from the above: a row can
 *     edge                               overflow INSIDE a clipping ancestor, so
 *                                        the page width never moves while a
 *                                        control is sliced in half at the
 *                                        boundary. This app's `rowHeadPinned`
 *                                        rows — a name that may not shrink
 *                                        beside actions that may not shrink —
 *                                        are exactly that shape
 *   - no two same-layer controls         crowding that appears at one width and
 *     overlap                            not another
 *   - every screen has a way out         a pushed screen with no Back is a dead
 *                                        end in a phone browser, where there is
 *                                        no hardware Back either. This app is a
 *                                        pure stack — no tab bar anywhere — so
 *                                        the header Back is the ONLY exit, and
 *                                        a screen that loses it is stranded
 *   - the content column is capped and   the app's one layout rule, read from
 *     centred above the breakpoint,      `app/src/theme/index.ts` rather than
 *     full-bleed below it                restated here
 *   - no interactive content nested      `accessibilityRole="button"` becomes a
 *     inside a <button>                  real <button> ELEMENT on web, and keys
 *                                        pressed in a control inside one
 *                                        activate the button
 *   - no fixed-format control is        the only ABSOLUTE-width check here. A
 *     squashed below its own widget      date/time/number input or a select can
 *                                        sit inside its container, overlap
 *                                        nothing, clip nothing, and still be too
 *                                        narrow to read — and unlike a text
 *                                        field, its content cannot be scrolled to
 *   - the page laid out at the width    everything else measures the DOM against
 *     it was asked for                   the DOM, which is silent about WHICH
 *                                        width it ran at. Without this, a
 *                                        viewport option that failed to apply
 *                                        leaves every check passing and every
 *                                        screenshot mislabelled
 *   - targets under 44px are REPORTED    informational, never a failure
 *
 * Deliberately NOT checked: a generic "is any text truncated". It fires on every
 * intentional `numberOfLines` clamp and would drown the real signal. Scope such
 * a check to the one surface that needs it, if any ever does.
 *
 * TWO POPULATIONS, THREE TOURS. Staff and students are different apps behind one
 * binary — different route tables, different homes, no screen in common but the
 * player and notifications — so a sweep that signed in as an admin would have
 * photographed half the product. A manager gets a third tour because their
 * scoping is class-by-class: they see the same screens with fewer rows and fewer
 * controls, which is a different layout, not the same one with less in it.
 *
 * A SCREEN WITH AN EDITOR OPEN IS A DIFFERENT SCREEN. The session editor adds
 * four fields and a Save/Cancel row; the ledger's override adds a reason field
 * and two buttons; a roster removal replaces a row in place with a confirmation.
 * None of those rows exist in any other state, and 320px is where they run out
 * of room — so they are toured explicitly rather than trusted because the screen
 * underneath them measured fine.
 *
 * That paid for itself on the first honest run: the ledger's override laid its
 * two actions out in a bespoke non-wrapping row, and "Mark not complete" ran
 * 27px off the right edge at 320px and at no other width. Fixed by using the
 * shared `Row`, which wraps.
 *
 * The AUDIO PLAYER's behaviour is not this suite's business — background
 * playback, the foreground service and lock-screen controls have no web
 * equivalent and belong on the AVD. Its LAYOUT is, and it is the one screen
 * whose controls sit in a fixed-width row, so it is toured at every width.
 *
 * Seeding goes through the Admin SDK: deterministic, seconds rather than
 * minutes, and rules will not let a client write most of it anyway. The content
 * is chosen to BREAK layouts — the longest name a real cohort would have, a
 * roster longer than one screen, an empty cohort — not to look tidy.
 */
import { chromium, devices } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:8086/';
const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = resolve(ROOT, 'shots', 'screens');
const PROJECT = 'demo-sabeel';
const BUCKET = `${PROJECT}.appspot.com`;
const FULL = process.env.SWEEP_FULL === '1';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

const results = [];
/**
 * How many fixed-format controls the squash check has actually looked at.
 *
 * GUARD THE GUARD. That check's loop body is the only thing in it that can
 * produce a fault, so if its selector ever matches nothing — react-native-web
 * changing how it renders a date input, the app dropping `DateField` — it
 * reports zero faults and the sweep stays green, silently, for good. The same
 * hole `ciCoverage.test.ts` guards against with its glob, and the same shape as
 * this check's own first version, which could not fail because its signal was
 * blind rather than because its population was empty. Both pass. Both look
 * exactly like working.
 */
let fixedFormatSeen = 0;
/**
 * Totals, printed rather than asserted on.
 *
 * The control population is guarded PER SCREEN, inside `layoutFaults`, because
 * every screen has controls and a starved one should name itself. Fixed-format
 * controls are guarded per RUN instead: a screen with no date field is
 * ordinary, a whole sweep with none is not. That asymmetry is the point — a
 * per-run guard is one line that says only "somewhere", so use it only where a
 * per-screen expectation does not exist.
 *
 * Note `escapes()` asks its question as `controls.some(...)`, and a `some()`
 * over an empty set is FALSE — it fails loudly on the very starvation the `for`
 * loops hide, needing no guard at all. Measured next door: the same sabotage
 * caught by `some` on 23 screens by construct, and by the `for` loops on none.
 * Where a check can be phrased either way, `some` is free insurance.
 */
let controlsSeen = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok });
  // The detail describes the FAILURE, so it prints only when there is one.
  // Appended to a passing line it reads as the opposite of what happened.
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

/**
 * The breakpoint comes from the SOURCE, never from a copy here.
 *
 * This app has exactly one layout rule — a content column that caps and centres
 * — so `CONTENT_MAX_WIDTH` is the whole of its responsive behaviour. A constant
 * restated in the test that checks it drifts from the thing it is testing.
 */
const themeSrc = await readFile(resolve(ROOT, 'app/src/theme/index.ts'), 'utf8');
const CONTENT_MAX_WIDTH = Number(themeSrc.match(/CONTENT_MAX_WIDTH\s*=\s*(\d+)/)?.[1]);
if (!CONTENT_MAX_WIDTH) throw new Error('CONTENT_MAX_WIDTH is no longer in app/src/theme/index.ts');

/**
 * Widths chosen to STRADDLE the breakpoint, not to look thorough: a bug on one
 * side of it is invisible from the other. One narrow phone, one ordinary phone,
 * one exactly at the cap, one just past it, one desktop.
 */
const WIDTHS = process.env.SWEEP_WIDTHS
  ? process.env.SWEEP_WIDTHS.split(',').map(Number)
  : [320, 390, CONTENT_MAX_WIDTH, 1024, 1440];
/** Real descriptors add DPR, touch and a mobile UA, which plain widths do not. */
const PROFILES = FULL
  ? [
      ['iphone-se', devices['iPhone SE']],
      ['pixel-7', devices['Pixel 7']],
      ['ipad-mini', devices['iPad Mini']],
    ]
  : [];

await mkdir(SHOTS, { recursive: true });
admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
const db = admin.firestore();
const auth = admin.auth();

// ---- the world ------------------------------------------------------------

const DAY = 86_400_000;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * WAITING FOR THE PORT IS NOT WAITING FOR READINESS.
 *
 * `emulators:exec` starts this script once it believes the suite is up, and the
 * functions emulator in particular accepts connections before it has registered
 * anything — the trap docs/DEV-TOOLING.md records. The browser pays for that
 * gap, not this script: the first dev sign-in came back
 * `auth/network-request-failed`, the pending screen never arrived, and the run
 * died 60 seconds later pointing at a locator. So poll the two services this
 * suite actually drives until each answers for real.
 */
async function waitForEmulators() {
  /*
   * READ-ONLY probes, deliberately.
   *
   * The obvious readiness check for the functions emulator — call a known
   * function and wait for it to stop 404ing — cannot be used here: the only
   * unauthenticated one is `bootstrapAdmin`, and calling it PROMOTES THE FIRST
   * ADMIN. A readiness check with a side effect on the thing being tested is
   * not a readiness check. The functions emulator is covered instead by
   * `emulators:exec`, which does not run this script until every emulator has
   * started, and by `free-emulator-ports.sh` at the top of the runner, which is
   * what rules out the half-dead leftover the poll-a-callable rule exists for.
   */
  const probes = [
    ['auth', `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/config`],
    ['firestore', `http://${process.env.FIRESTORE_EMULATOR_HOST}/`],
  ];
  for (const [what, url] of probes) {
    let ok = false;
    for (let i = 0; i < 120 && !ok; i += 1) {
      ok = await fetch(url).then((r) => r.ok, () => false);
      if (!ok) await new Promise((r) => setTimeout(r, 500));
    }
    if (!ok) throw new Error(`the ${what} emulator never became ready at ${url}`);
  }
}
await waitForEmulators();

/**
 * Start from nothing.
 *
 * Leftover emulator state silently SKIPS the paths that matter — a previous run
 * leaves an approved admin behind and the next one sails past the pending gate
 * while still reporting success. Safe to do here because `screens-e2e.sh` owns
 * the emulator for the length of this run; nothing else is looking at it.
 */
for (const [what, url] of [
  ['firestore', `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`],
  ['auth', `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`],
]) {
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error(`could not clear ${what}: ${r.status}`);
}

/**
 * A real, decodable audio object — 8 kHz 8-bit mono PCM, generated here.
 *
 * GENERATED rather than committed (this repo never adds a binary) and WAV rather
 * than the M4A `web-e2e.mjs` makes with ffmpeg, because ffmpeg is not a
 * dependency of this suite and a CI runner that lacks it would fail on the
 * fixture rather than on a layout. It has to actually decode: the transport
 * renders disabled until the media reports a duration, and a sweep of disabled
 * controls is a photograph of a state no student ever sees.
 */
function wav(seconds) {
  const rate = 8000;
  const samples = rate * seconds;
  const buf = Buffer.alloc(44 + samples);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); // PCM header size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(samples, 40);
  for (let i = 0; i < samples; i += 1) {
    // A quiet tone rather than digital silence: some decoders shortcut a
    // constant stream, and then `durationSec` and the media disagree.
    buf[44 + i] = 128 + Math.round(20 * Math.sin((i / rate) * 2 * Math.PI * 220));
  }
  return buf;
}
const AUDIO_SECONDS = 120;
const AUDIO = wav(AUDIO_SECONDS);

const browser = await chromium.launch();

// ---- driving ---------------------------------------------------------------

/**
 * Only ever the VISIBLE match.
 *
 * React Navigation keeps the previous screen MOUNTED but hidden, so a locator
 * that does not say "visible" can resolve to a node on the screen underneath —
 * one that will never become clickable. Playwright then retries for its whole
 * timeout against an element that cannot change, and the run dies at a step with
 * nothing wrong with it, roughly one run in two.
 *
 * Two details make it worse than it sounds. `getByTestId` is a CSS attribute
 * selector, so unlike a ROLE selector it does not skip `display:none` subtrees
 * the way a screen reader does — which is why a testID present on both screens
 * is ambiguous rather than obviously wrong. And `.first()` / `.last()` do not
 * mean "the one on screen"; they mean document order, which is exactly the wrong
 * question. Found in the sibling time-tracker's flow suite, at clean HEAD.
 *
 * So every locator in this file goes through one of these three. There are no
 * bare `page.getBy*` calls, deliberately.
 */
const byId = (page, id) => page.getByTestId(id).filter({ visible: true }).first();
const byName = (page, name) =>
  page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
/** By LABEL, not by role: the header Back is a link on web (see `escapes`). */
const backButton = (page) =>
  page.getByLabel(/(^|,\s*)(go\s+)?back$/i).filter({ visible: true }).first();

async function tap(locator, timeout = 30_000) {
  await locator.waitFor({ timeout });
  await locator.click();
}

/**
 * Mint a staff account THROUGH THE APP, then approve it out of band.
 *
 * Staff are Google identities and the Admin SDK cannot create one, so the dev
 * sign-in row is the only way to produce an account the domain gate would
 * accept. `onUserCreate` writes the pending `staffUsers` document; this waits
 * for it, then does what an admin's approval does — claims first, then the
 * mirror, in that order, because the token is what rules trust.
 */
async function provisionStaff(testId, email, role) {
  const staffDoc = async () => {
    const snap = await db.collection('staffUsers').where('email', '==', email).get();
    return snap.empty ? '' : snap.docs[0].id;
  };

  /*
   * Waits for the DOCUMENT, not for the pending screen, and tries twice.
   *
   * The document is what this function is for, and it is the only unambiguous
   * evidence: the app shows "Setting up your account" and "Waiting for
   * approval" at different moments of the same successful path, so a wait on
   * one text is a race against which one is up. Twice because the first
   * sign-in of a run meets a backend that has only just come up — that came
   * back `auth/network-request-failed`, which the app REPORTS to the user
   * rather than throwing at the caller, so there is nothing to catch here,
   * only a screen that never changes.
   */
  let uid = '';
  for (let attempt = 1; attempt <= 2 && !uid; attempt += 1) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await tap(byId(page, testId), 60_000);
    for (let i = 0; i < 60 && !uid; i += 1) {
      uid = await staffDoc();
      if (!uid) await new Promise((r) => setTimeout(r, 500));
    }
    await ctx.close();
    if (!uid) console.log(`  ..  ${email} never provisioned; signing in again`);
  }
  if (!uid) throw new Error(`${email} was never provisioned by onUserCreate`);
  await auth.setCustomUserClaims(uid, { role, status: 'active' });
  await db.collection('staffUsers').doc(uid).update({ role, status: 'active', approvedAt: now });
  return uid;
}

const adminUid = await provisionStaff('dev-signin-first-admin', 'faisal.shah@oursabeel.com', 'admin');
const managerUid = await provisionStaff('dev-signin-manager', 'manager@oursabeel.com', 'manager');

/**
 * A roster LONGER THAN ONE SCREEN, because the bug being looked for is what
 * happens at the bottom of a list, and eight rows all fit at every width.
 *
 * The first name is the longest one a real roster would carry — a full Arabic
 * name with a nisba — and its address is the longest with it. Rows in this app
 * pin the name beside its actions and forbid both from shrinking (`rowItem`,
 * `rowHeadPinned`), which is correct and is also precisely the shape that
 * carries a control off the right edge when the name is long enough.
 */
const NAMES = [
  'Abd al-Rahman ibn Muhammad al-Shinqiti',
  'Fatima Ahmed',
  'Bilal Khan',
  'Omar Siddiqui',
  'Ayesha Rahman',
  'Yusuf Ali',
  'Maryam Iqbal',
  'Zainab Hassan',
  'Ibrahim Malik',
  'Khadija Noor',
  'Sumayya Patel',
  'Hamza Chaudhry',
  'Aminah Bello',
  'Idris Abubakar',
];
const STUDENT_PASSWORD = 'HikamStudent1';
const students = [];
for (const [i, name] of NAMES.entries()) {
  const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
  // The last one is DISABLED so the Students screen's collapsed "Disabled"
  // section has something in it — an empty collapsible documents nothing.
  const status = i === NAMES.length - 1 ? 'disabled' : 'active';
  /*
   * Created WITHOUT a password, then given one.
   *
   * Not a detail: `onUserCreate` reads the provider list to tell the two
   * populations apart, and a `password` provider AT CREATION means a
   * client-side sign-up, which it deletes. `createStudent` makes a
   * password-less account precisely so the student can set their own from the
   * emailed link — and a password-less Admin-SDK user has EMPTY provider data,
   * which is the shape the trigger ignores. Passing the password to
   * `createUser` had every student deleted moments after it was made, exactly
   * as it once did in production.
   */
  const u = await auth.createUser({ email, displayName: name });
  await new Promise((r) => setTimeout(r, 250));
  await auth.updateUser(u.uid, { password: STUDENT_PASSWORD, emailVerified: true });
  await auth.setCustomUserClaims(u.uid, { role: 'student', status });
  await db.collection('students').doc(u.uid).set({
    displayName: name,
    email,
    role: 'student',
    status,
    createdAt: now - 40 * DAY,
    createdBy: adminUid,
  });
  students.push({ uid: u.uid, name, email, status });
}
/** The student the student tour signs in as: on the long-named row, so their own
 *  screens carry the longest strings too. */
const STUDENT = students[0];

const COHORT = 'sw-autumn';
const COURSE = 'sw-hikam';
/** The longest course name the institute would really write, and it is not a
 *  stress test for its own sake: it is what a section-and-day title looks like. */
const LONG_COURSE = 'sw-arabic';
const LONG_COURSE_NAME = 'Arabic I & Qur’anic Morphology — Tuesday Evening Section';

await db.collection('cohorts').doc(COHORT).set({
  name: 'Autumn 2026', archived: false, createdAt: now - 45 * DAY, createdBy: adminUid,
});
/** An EMPTY cohort. Reachable in ordinary use — a term is created before its
 *  courses are — and the only way to photograph the Courses screen's empty
 *  state, which no amount of seeded content will show. */
await db.collection('cohorts').doc('sw-empty').set({
  name: 'Spring 2027 — Evening Intensive', archived: false, createdAt: now - 2 * DAY, createdBy: adminUid,
});
/** An ARCHIVED cohort, so the Cohorts screen's collapsed archive section has a
 *  row in it. */
await db.collection('cohorts').doc('sw-past').set({
  name: 'Spring 2026', archived: true, createdAt: now - 220 * DAY, createdBy: adminUid,
});

const course = (id, cohortId, name, extra = {}) =>
  db.collection('courses').doc(id).set({
    cohortId,
    name,
    archived: false,
    effectiveActive: true,
    archivedAccess: false,
    managerUids: [],
    createdAt: now - 45 * DAY,
    createdBy: adminUid,
    ...extra,
  });
// The manager is scoped to ONE course, which is the whole of their access —
// cohort membership grants nothing. Their tour is the read of that.
await course(COURSE, COHORT, 'Hikam Foundations', { managerUids: [managerUid] });
await course(LONG_COURSE, COHORT, LONG_COURSE_NAME);
await course('sw-past-course', 'sw-past', 'Seerah Survey', { effectiveActive: false });

for (const s of students) {
  await db.collection('enrollments').doc(`${s.uid}_${COURSE}`).set({
    studentUid: s.uid, courseId: COURSE, cohortId: COHORT,
    active: true, enrolledAt: now - 40 * DAY, enrolledBy: adminUid,
  });
}
for (const s of students.slice(0, 4)) {
  await db.collection('enrollments').doc(`${s.uid}_${LONG_COURSE}`).set({
    studentUid: s.uid, courseId: LONG_COURSE, cohortId: COHORT,
    active: true, enrolledAt: now - 40 * DAY, enrolledBy: adminUid,
  });
}

/**
 * One session, its recording, its attendance snapshot and the grants that fall
 * out of it — the same order the app builds them in.
 *
 * Being EXCUSED is the whole of a student's entitlement, so a seed that marked
 * everyone present would photograph every student screen empty. `present` and
 * `absent` are here because the ledger has a section for each.
 */
async function seedSession(id, recId, title, opts) {
  const { courseId = COURSE, daysAgo, dueOffset, status = 'published', notes = '',
    roster = students, present = 0, absent = [], attention = null } = opts;
  const date = iso(now - daysAgo * DAY);
  // Never null: the due date is the day access closes, so a session cannot be
  // without one. A past one is planted directly, which no callable will do —
  // a deadline may only BECOME past by the passage of time.
  const dueDate = iso(now + dueOffset * DAY);
  /*
   * The demo student is ALWAYS excused, whoever else is present.
   *
   * Being excused is the whole of a student's entitlement, so the person the
   * student tour signs in as has to be excused everywhere or their home, their
   * class record and every ledger row about them are empty — and the sweep
   * would photograph a set of empty states and call it coverage. The first
   * version of this seed marked by position and put them present in all five
   * sessions, which is exactly what happened.
   */
  const attendance = opts.attendance === null ? null : Object.fromEntries(
    roster.map((s, i) => [
      s.uid,
      absent.includes(s.uid) ? 'absent'
        : s.uid === STUDENT.uid ? 'excused'
        : i <= present ? 'present'
        : 'excused',
    ]),
  );
  const submittedAt = attendance ? now - daysAgo * DAY : null;
  const hasAudio = status !== 'draft' && status !== 'needsAttention';
  const audioPath = `recordings/${recId}/audio.wav`;
  if (hasAudio) {
    await admin.storage().bucket().file(audioPath).save(AUDIO, { contentType: 'audio/wav' });
  }

  await db.collection('sessions').doc(id).set({
    courseId, cohortId: COHORT, date, title, dueDate, notes,
    recordingId: recId, attendance: attendance ?? {}, attendanceSubmittedAt: submittedAt,
    archived: false, createdAt: now - daysAgo * DAY, createdBy: adminUid, updatedAt: now - daysAgo * DAY,
  });
  if (recId) {
    await db.collection('recordings').doc(recId).set({
      sessionId: id, courseId, cohortId: COHORT, title, notes, date, status, source: 'manual',
      audioPath: hasAudio ? audioPath : null,
      durationSec: hasAudio ? AUDIO_SECONDS : null,
      sizeBytes: hasAudio ? AUDIO.length : null,
      createdAt: now - daysAgo * DAY, createdBy: adminUid, updatedAt: now - daysAgo * DAY,
      ...(status === 'published' ? { publishedAt: now - daysAgo * DAY } : {}),
      ...(attention ? { attentionReason: attention } : {}),
    });
  }
  if (attendance) {
    for (const [uid, mark] of Object.entries(attendance)) {
      // A student cannot read a session, so their own mark is projected onto a
      // document of their own. Written here because the sweep's world is seeded
      // rather than submitted through the callable that normally does it.
      await db.collection('attendanceRecords').doc(`${uid}_${id}`).set({
        studentUid: uid, sessionId: id, courseId, cohortId: COHORT,
        date, title, status: mark, submittedAt,
      });
      if (mark === 'excused' && status === 'published') {
        await db.collection('assignments').doc(`${uid}_${recId}`).set({
          studentUid: uid, recordingId: recId, sessionId: id, courseId, cohortId: COHORT,
          dueDate, active: true, assignedAt: submittedAt, assignedBy: 'system',
        });
      }
    }
  }
  return { id, recId, dueDate, title };
}

/**
 * Five sessions covering every bucket the student home groups by — missed, due
 * soon, upcoming, completed — because the home's layout is those four group
 * headings and a sweep that saw one of them saw a quarter of the screen.
 */
const missed = await seedSession('sw-s1', 'sw-s1r',
  'Session 1 — Introduction to the Hikam of Ibn ʿAtaʾillah, and the Method of the Commentary',
  { daysAgo: 28, dueOffset: -9, present: 6, absent: [students[6].uid],
    notes: 'Read the first ten hikam before next week. The commentary we are using is the ' +
      'one by al-Shurnubi; a scan is in the shared folder, and the pages for this session ' +
      'are 1 through 24. Bring your questions about the second hikma in particular.' });
const dueSoon = await seedSession('sw-s2', 'sw-s2r', 'Session 2 — Knowledge and Certainty',
  { daysAgo: 5, dueOffset: 3, present: 5 });
// Not bound to anything: nothing navigates to it by name. It is here so the
// student home has an "Upcoming" group at all — the four bucket headings ARE
// that screen's layout, and a home missing one is a quarter untested.
await seedSession('sw-s3', 'sw-s3r', 'Session 3 — Patience in Hardship',
  { daysAgo: 2, dueOffset: 20, present: 4 });
const done = await seedSession('sw-s4', 'sw-s4r', 'Session 4 — Sincerity of Intention',
  { daysAgo: 12, dueOffset: 14, present: 3 });
/** Published, attendance NOT taken: nobody is granted anything. The state the
 *  `attendanceMissing` notification exists for, and a real staff screen. */
await seedSession('sw-s5', 'sw-s5r', 'Session 5 — Reliance and Trust',
  { daysAgo: 1, dueOffset: 7, attendance: null });
/** A session with NO RECORDING — the only route to the Zoom import screen. */
await db.collection('sessions').doc('sw-s6').set({
  courseId: COURSE, cohortId: COHORT, date: iso(now), title: 'Session 6 — Today (recording pending)',
  dueDate: iso(now + 7 * DAY), notes: '', recordingId: null, attendance: {},
  attendanceSubmittedAt: null, archived: false, createdAt: now, createdBy: adminUid, updatedAt: now,
});
await seedSession('sw-a1', 'sw-a1r', 'Lesson 1 — The Arabic Alphabet',
  { courseId: LONG_COURSE, daysAgo: 9, dueOffset: 5, roster: students.slice(0, 4), present: 2 });

/** The demo student completed one and part-listened another, so both the ledger
 *  and their own home have every row type on them. */
await db.collection('completions').doc(`${STUDENT.uid}_${done.recId}`).set({
  studentUid: STUDENT.uid, recordingId: done.recId, courseId: COURSE,
  completed: true, completedAt: now - 3 * DAY, updatedAt: now - 3 * DAY,
});
for (const [rid, frac] of [[done.recId, 1], [dueSoon.recId, 0.6], [missed.recId, 0.2]]) {
  await db.collection('listeningProgress').doc(`${STUDENT.uid}_${rid}`).set({
    studentUid: STUDENT.uid, recordingId: rid, courseId: COURSE,
    positionMs: AUDIO_SECONDS * 1000 * frac, listenedMs: AUDIO_SECONDS * 1000 * frac,
    updatedAt: now - 2 * DAY,
  });
}
/** Two more students complete, so the ledger's filters are not all one row. */
for (const s of students.slice(1, 5)) {
  await db.collection('completions').doc(`${s.uid}_${dueSoon.recId}`).set({
    studentUid: s.uid, recordingId: dueSoon.recId, courseId: COURSE,
    completed: true, completedAt: now - DAY, updatedAt: now - DAY,
  });
}
/** An override already in place, so the ledger row that carries one — an extra
 *  line of raspberry text above the actions — is toured, not just the plain row. */
await db.collection('completionOverrides').doc(`${students[5].uid}_${dueSoon.recId}`).set({
  studentUid: students[5].uid, recordingId: dueSoon.recId, courseId: COURSE, completed: true,
  reason: 'Listened on a borrowed phone; confirmed in person after class on the 14th.',
  overriddenBy: adminUid, at: now - DAY,
});

for (const [i, action] of ['createCourse', 'submitAttendance', 'createRecording',
  'setRecordingStatus', 'overrideCompletion', 'createStudent'].entries()) {
  await db.collection('auditLog').add({
    at: now - i * 3600_000, actorUid: adminUid, actorRole: 'admin', action,
    courseId: i % 2 ? COURSE : null,
    targets: { courseId: COURSE, recordingId: dueSoon.recId },
    detail: { note: 'Seeded so the audit list has rows at every width.' },
  });
}

// ---- assertions ------------------------------------------------------------

/**
 * Every measurement below is against the LAYOUT viewport, not the window.
 *
 * This is a choice of PROPERTY, not a guard — `clientWidth` and
 * `getBoundingClientRect().width` are the same amount of code, and the layout
 * box is simply the thing a layout question is about. So it stays even though
 * the two agree here: measured on this headless Chromium, the scrollbar is an
 * overlay and the inset is zero, in both scrollbar modes, so the naive form
 * would pass identically. Nothing below is defending against anything.
 *
 * Where a classic scrollbar IS in effect — another OS, a headed run — the two
 * checks here would fail in opposite directions: the centring check gets a false
 * positive, and the sideways-bleed check a false NEGATIVE hiding up to ~15px of
 * real overflow. Reading the right box makes both questions well-posed on any
 * runner, which is a better reason to do it than the failure it avoids.
 */
const layoutFaults = (page) =>
  page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const faults = [];

    // The PAGE must never widen. Inner horizontal scrollers, where this app has
    // any, are their own elements — this is the classic responsive failure a
    // top-of-page screenshot never reveals.
    const bleed = document.documentElement.scrollWidth - vw;
    if (bleed > 1) faults.push(`page scrolls sideways by ${bleed}px`);

    /**
     * The part of an element you can actually SEE.
     *
     * `getBoundingClientRect` reports where an element would be, not what is
     * visible: a roster row scrolled out of its list still returns its full
     * height, so it geometrically "overlaps" whatever sits below the list.
     * Clipping an ancestor does not shrink the rect, so it is clipped here.
     */
    const visibleRect = (el) => {
      let r = el.getBoundingClientRect();
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (!/hidden|auto|scroll/.test(cs.overflow + cs.overflowX + cs.overflowY)) continue;
        const c = n.getBoundingClientRect();
        r = {
          left: Math.max(r.left, c.left),
          right: Math.min(r.right, c.right),
          top: Math.max(r.top, c.top),
          bottom: Math.min(r.bottom, c.bottom),
        };
      }
      return {
        left: Math.max(r.left, 0),
        right: Math.min(r.right, vw),
        top: Math.max(r.top, 0),
        bottom: Math.min(r.bottom, window.innerHeight),
      };
    };
    const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

    /** The nearest positioned ancestor — the header, a confirmation that has
     *  taken over its card, or the page. */
    const layerOf = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return n;
      }
      return document.body;
    };

    const SELECTOR = '[role="button"], [role="switch"], [role="radio"], [role="link"], button';
    const els = [...document.querySelectorAll(SELECTOR)].filter((e) => area(visibleRect(e)) > 4);
    /*
     * STARVATION IS A FAULT, PER SCREEN.
     *
     * Overlap and right-edge below are `for` loops over `els`, and a `for` over
     * an empty set is silence — they would return a clean bill of health having
     * looked at nothing, on every screen, for good. Measured in the sibling
     * harness: starving this selector left 23 screens reporting zero layout
     * faults while examining zero elements.
     *
     * Per screen rather than per run, and reported as a fault rather than as its
     * own check, so it names WHERE and costs no extra line. Every screen in this
     * app has controls; one with none is an anomaly, not a quiet day.
     */
    if (els.length === 0) {
      faults.push(
        'examined NO controls — the overlap and right-edge checks are inert here, not passing',
      );
    }
    const name = (e) => (e.getAttribute('aria-label') || e.textContent || '?').trim().slice(0, 24);

    for (let i = 0; i < els.length; i += 1) {
      for (let j = i + 1; j < els.length; j += 1) {
        const a = els[i];
        const b = els[j];
        // Nesting is legitimate (a control inside a pressable row); two
        // INDEPENDENT controls sharing pixels is not.
        if (a.contains(b) || b.contains(a)) continue;
        // Neither is overlap ACROSS LAYERS: the header is its own layer and
        // content scrolls under it by design. Only controls laid out against
        // each other are worth comparing.
        if (layerOf(a) !== layerOf(b)) continue;
        const ra = visibleRect(a);
        const rb = visibleRect(b);
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 1 && oy > 1) {
          faults.push(`"${name(a)}" overlaps "${name(b)}" by ${Math.round(ox)}x${Math.round(oy)}px`);
        }
      }
    }

    /*
     * NOTHING MAY BE CLIPPED BY THE RIGHT EDGE.
     *
     * Distinct from "the page scrolls sideways": a row can overflow inside a
     * clipping ancestor, so the page width never changes and the sideways check
     * stays green while a control is sliced in half at the boundary. Rows here
     * pin a name that may not shrink beside actions that may not shrink
     * (`rowItem`, `rowHeadPinned` in ui.tsx), which is exactly that shape.
     */
    for (const e of els) {
      const raw = e.getBoundingClientRect();
      if (raw.right > vw + 1 && area(visibleRect(e)) > 4) {
        faults.push(`"${name(e)}" is clipped by the right edge (${Math.round(raw.right - vw)}px past)`);
      }
    }

    /*
     * A FIXED-FORMAT CONTROL SQUASHED NARROWER THAN ITS OWN WIDGET.
     *
     * The only check here sensitive to ABSOLUTE width, and it exists because
     * every other one is relative and therefore blind to this: a control can sit
     * inside its container, overlap nothing, clip nothing, and still be too
     * narrow to use.
     *
     * Scoped deliberately to controls whose content CANNOT be scrolled to. A
     * text field holding more than fits is ordinary — it scrolls, and it scrolls
     * itself as you type — so flagging that would fire on every long email
     * address in the app and the check would be deleted inside a week. A date,
     * time or number input renders a fixed widget and a `select` renders its
     * longest option; when the box is narrower than that, part of the control is
     * simply unreachable. That is always a bug and never a clamp.
     *
     * The sibling app shipped a date field squashed to "08" at 320px and correct
     * at every width above it. No relative check noticed, in either harness.
     */
    const FIXED_FORMAT =
      'input[type="date"], input[type="time"], input[type="datetime-local"], ' +
      'input[type="month"], input[type="week"], input[type="number"], select';
    let fixedFormatSeen = 0;
    for (const el of document.querySelectorAll(FIXED_FORMAT)) {
      if (area(visibleRect(el)) < 4) continue;
      fixedFormatSeen += 1;
      /*
       * Measured against the control's OWN min-content width, by cloning it,
       * letting the clone size to its content, and reading that back.
       *
       * The obvious signal — `scrollWidth > clientWidth` — does not work, and
       * failing to check that shipped an inert check for one run. Chromium draws
       * a date input's widget in a UA shadow root with `overflow: hidden`, so a
       * date field squashed from 166px to 38px reports scrollWidth === clientWidth
       * and looks perfectly healthy. (It does work for `select`, which is what
       * made the idea plausible.) Min-content discriminates for both: 0px short
       * when healthy, 128px short for that same squashed date field.
       *
       * The clone is appended and removed inside one synchronous evaluate, so
       * React never observes it and the page is unchanged by the time the
       * screenshot is taken.
       */
      const probe = el.cloneNode(true);
      probe.style.maxWidth = 'none';
      probe.style.width = 'min-content';
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      el.parentElement.appendChild(probe);
      const needs = probe.getBoundingClientRect().width;
      probe.remove();

      const shortfall = needs - el.getBoundingClientRect().width;
      if (shortfall > 2) {
        const label =
          el.getAttribute('aria-label') ||
          el.labels?.[0]?.textContent ||
          el.previousElementSibling?.textContent ||
          `${el.tagName.toLowerCase()}[${el.type}]`;
        faults.push(
          `"${label.trim().slice(0, 24)}" is ${Math.round(shortfall)}px narrower than ` +
            'its content needs — a fixed-format control cannot be scrolled to',
        );
      }
    }

    /*
     * NO INTERACTIVE CONTENT NESTED INSIDE A <button>.
     *
     * `accessibilityRole="button"` adds no ARIA attribute on web —
     * react-native-web maps it to a real <button> ELEMENT. Put that on a
     * Pressable wrapping other things and the result is invalid HTML, which the
     * browser resolves by treating keys pressed in the nested control as
     * activating the button. Checked structurally, because the shape is what is
     * wrong and it can be reintroduced anywhere a Pressable gains a role and a
     * child — this app has switch rows, confirmation wrappers and roster rows
     * that all wrap other controls.
     */
    for (const b of document.querySelectorAll('button')) {
      const nested = b.querySelector('input, textarea, select, button, a[href], [contenteditable="true"]');
      if (nested) {
        faults.push(
          `<button> "${name(b)}" contains a nested <${nested.tagName.toLowerCase()}> — ` +
            'invalid HTML; keys pressed inside it can activate the button',
        );
      }
    }

    return { faults: [...new Set(faults)], fixedFormat: fixedFormatSeen, controls: els.length };
  });

/**
 * Can you LEAVE this screen without the browser's Back?
 *
 * This app is a pure native stack with NO TAB BAR anywhere, so a pushed screen
 * has exactly one exit: the header's Back. On a phone browser there is no
 * hardware Back either, so a screen that loses it is a dead end. Home is the
 * root and needs none — it is where every Back leads — so it answers with its
 * own way out of the app instead.
 */
const escapes = (page) =>
  page.evaluate(() => {
    const shown = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const label = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
    /*
     * The header Back is an <a>, NOT a <button>.
     *
     * `PlatformPressable` renders `role="link"` whenever it has an `href`, and
     * the navigator hands it one because this app has a linking config — which
     * is also what makes the browser's own Back work. Looking only at buttons
     * reported every pushed screen in the app as a dead end, which is a check
     * failing on its own query rather than on the thing it is checking.
     */
    const controls = [
      ...document.querySelectorAll('[role="button"], [role="link"], button, a[href]'),
    ].filter(shown);
    return {
      // "Go back" when there is no previous title, "<Title>, back" when there
      // is — both from @react-navigation/elements.
      back: controls.some((e) => /(^|,\s*)(go\s+)?back$/i.test(label(e))),
      signOut: controls.some((e) => /^sign out$/i.test(label(e))),
    };
  });

/**
 * The one layout rule this app has, MEASURED rather than assumed.
 *
 * Every screen is a scroll view whose content container caps at
 * `CONTENT_MAX_WIDTH` and centres. Below that width the column must be
 * full-bleed — losing that is how a phone gets margins it cannot afford — and at
 * or above it the column must actually cap AND actually centre, because
 * `maxWidth` without `alignSelf` leaves a desktop page hugging the left and
 * looks deliberate enough that nobody files it.
 *
 * The container is found structurally, as the scroll view's only child:
 * `contentContainerStyle` lands on a node React Native gives no way to label,
 * so there is no testID to ask for.
 */
const contentColumn = (page) =>
  page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((el) => {
      const cs = getComputedStyle(el);
      return /auto|scroll/.test(cs.overflowY) && el.firstElementChild && el.clientHeight > 80;
    });
    if (!scrollers.length) return null;
    scrollers.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    const el = scrollers[0];
    const box = el.getBoundingClientRect();
    const inner = el.firstElementChild.getBoundingClientRect();
    // clientWidth/clientLeft, not the bounding rect: a classic scrollbar is
    // inside the border box and is not space the column could have used.
    return {
      outerLeft: box.left + el.clientLeft,
      outerWidth: el.clientWidth,
      left: inner.left,
      width: inner.width,
    };
  });

function columnFault(col, cap) {
  if (!col) return 'no scrolling content column found';
  const { outerLeft, outerWidth, left, width } = col;
  if (outerWidth < cap) {
    return width < outerWidth - 2
      ? `column is ${Math.round(width)}px inside a ${Math.round(outerWidth)}px viewport — should be full-bleed`
      : '';
  }
  if (width > cap + 1) return `column is ${Math.round(width)}px, past the ${cap}px cap`;
  const offset = left - outerLeft;
  const centred = (outerWidth - width) / 2;
  return Math.abs(offset - centred) > 2
    ? `column sits ${Math.round(offset)}px from the left, not the ${Math.round(centred)}px that centres it`
    : '';
}

/**
 * THE PAGE LAID OUT AT THE WIDTH IT WAS ASKED FOR.
 *
 * Everything else in this file measures the DOM against the DOM, which makes the
 * checks internally consistent and says nothing about *which width* they ran at.
 * The width came from a Playwright viewport option and was believed. If one ever
 * failed to apply, every geometric check would still pass, every screenshot
 * would be mislabelled, and "608 checks across five widths" would be a sentence
 * about nothing — the file's own headline rule, one level up, at the tour's
 * premise rather than at its steps.
 *
 * So the requested width is ASSERTED rather than threaded through as an
 * assumption. Once per context and before the tour, not per screen: a wrong
 * viewport should fail in one honest line ahead of the geometry, rather than
 * after a whole tour has been measured against the wrong reference.
 *
 * `documentElement.clientWidth` rather than `innerWidth` for the same reason as
 * everywhere else — it is the layout box, so on a runner whose scrollbars are
 * classic rather than overlay this reports the real divergence instead of hiding
 * it.
 */
const laidOutAt = (page) =>
  page.evaluate(() => ({
    layout: document.documentElement.clientWidth,
    window: window.innerWidth,
  }));

const smallTargets = (page) =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('[role="button"], [role="switch"], [role="radio"], button')]
        .map((e) => ({
          n: (e.getAttribute('aria-label') || e.textContent || '?').trim().slice(0, 18),
          r: e.getBoundingClientRect(),
        }))
        .filter((x) => x.r.width > 0 && x.r.height > 0 && x.r.height < 44)
        .map((x) => `${x.n} ${Math.round(x.r.height)}px`),
    ),
  ]);

/** Drive the screen's scroll view to the bottom, and say whether it moved. */
const scrollToBottom = (page) =>
  page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((el) => {
      const cs = getComputedStyle(el);
      return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 8;
    });
    if (!scrollers.length) return false;
    scrollers.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    scrollers[0].scrollTop = scrollers[0].scrollHeight;
    return true;
  });

// ---- the tour --------------------------------------------------------------

/**
 * Back to the root, by WALKING BACK — which also means the tour cannot pass
 * while the exits it depends on are broken.
 *
 * Falls back to a reload only when there is no Back to press and the root is not
 * on screen, which is the state a genuinely stranded screen is in; the
 * `has a way out` check has already reported it by then.
 */
async function goHome(page, homeMarker) {
  for (let i = 0; i < 16; i += 1) {
    if (await byId(page, homeMarker).isVisible().catch(() => false)) return;
    const back = backButton(page);
    if (!(await back.isVisible().catch(() => false))) break;
    await back.click();
    await page.waitForTimeout(350);
  }
  if (await byId(page, homeMarker).isVisible().catch(() => false)) return;
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await byId(page, homeMarker).waitFor({ timeout: 60_000 });
}

/**
 * One screen: reach it, measure it, photograph it, then measure it again at the
 * BOTTOM.
 *
 * The second pass is not thoroughness for its own sake. Overlap is judged on
 * what is visible, so a check that only ever looks at the top of a screen cannot
 * see the end of a fourteen-row roster or the controls below the player's fold —
 * which on a 320px phone is most of the app. The screenshot is taken between the
 * two, so a failure always has a picture of what was measured beside it.
 */
function visitor(page, tag, homeMarker, counter) {
  return async function visit(name, go) {
    await goHome(page, homeMarker);
    await go();
    await page.waitForTimeout(450);

    const top = await layoutFaults(page);
    fixedFormatSeen += top.fixedFormat;
    controlsSeen += top.controls;
    check(`${tag} / ${name}`, top.faults.length === 0, top.faults.join('; ').slice(0, 200));

    const out = await escapes(page);
    check(
      `${tag} / ${name} has a way out`,
      name === 'home' ? out.signOut : out.back,
      name === 'home' ? 'the root screen offers no sign out' : 'no Back in the header',
    );

    const fault = columnFault(await contentColumn(page), CONTENT_MAX_WIDTH);
    check(`${tag} / ${name} content column`, fault === '', fault);

    const small = await smallTargets(page);
    if (small.length) console.log(`         under 44px: ${small.join(', ').slice(0, 110)}`);

    await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`), fullPage: true });

    if (await scrollToBottom(page)) {
      await page.waitForTimeout(250);
      const below = await layoutFaults(page);
      fixedFormatSeen += below.fixedFormat;
      controlsSeen += below.controls;
      check(
        `${tag} / ${name} scrolled to the end`,
        below.faults.length === 0,
        below.faults.join('; ').slice(0, 200),
      );
    }
    counter.seen += 1;
  };
}

// ---- the tours -------------------------------------------------------------

const STAFF_SCREENS = 24;

async function tourStaff(page, tag) {
  const counter = { seen: 0 };
  const visit = visitor(page, tag, 'nav-cohorts', counter);
  const openCourse = async () => {
    await tap(byId(page, 'nav-cohorts'));
    await tap(byId(page, 'cohort-open-Autumn 2026'));
    await tap(byId(page, 'course-open-Hikam Foundations'));
  };
  const openSession = async () => {
    await openCourse();
    await tap(byId(page, 'nav-sessions'));
    await tap(byId(page, `session-open-${missed.title}`));
  };

  await visit('home', async () => {});
  await visit('staff', () => tap(byId(page, 'nav-staff')));
  await visit('students', () => tap(byId(page, 'nav-students')));
  // The disabled section EXPANDED: rows that exist in no other state, and the
  // collapsible's own header row moves when they arrive.
  await visit('students-disabled', async () => {
    await tap(byId(page, 'nav-students'));
    await tap(byId(page, 'students-disabled'));
  });
  await visit('student', async () => {
    await tap(byId(page, 'nav-students'));
    await tap(byId(page, `student-open-${STUDENT.email}`));
  });
  await visit('cohorts', () => tap(byId(page, 'nav-cohorts')));
  await visit('cohort', async () => {
    await tap(byId(page, 'nav-cohorts'));
    await tap(byId(page, 'cohort-open-Autumn 2026'));
  });
  // The empty state. No amount of seeding shows it, and it is the screen a term
  // spends its first week in.
  await visit('cohort-empty', async () => {
    await tap(byId(page, 'nav-cohorts'));
    await tap(byId(page, 'cohort-open-Spring 2027 — Evening Intensive'));
  });
  await visit('course', openCourse);
  // A roster removal CONFIRMS IN PLACE — the row is replaced by a warning and
  // two buttons, which is more than fits where the row was.
  await visit('course-remove-confirm', async () => {
    await openCourse();
    await tap(byId(page, `roster-remove-${STUDENT.email}`));
  });
  await visit('course-attendance', async () => {
    await openCourse();
    await tap(byId(page, 'nav-attendance'));
  });
  // The per-student tab: the widest grid in the app, and the other half of the
  // screen above.
  await visit('course-attendance-students', async () => {
    await openCourse();
    await tap(byId(page, 'nav-attendance'));
    await tap(byId(page, 'attendance-tab-students'));
  });
  await visit('sessions', async () => {
    await openCourse();
    await tap(byId(page, 'nav-sessions'));
  });
  await visit('session', openSession);
  // The session editor: four fields and a Save/Cancel row that exist nowhere
  // else, and 320px is where they run out of room.
  await visit('session-editing', async () => {
    await openSession();
    await tap(byName(page, 'Edit session'));
  });
  await visit('recording-ledger', async () => {
    await openSession();
    await tap(byId(page, 'recording-ledger'));
  });
  // The override editor, open: a reason field and two more buttons inside a row
  // that already carries a name and a status.
  await visit('ledger-override', async () => {
    await openSession();
    await tap(byId(page, 'recording-ledger'));
    await tap(byId(page, `override-open-${STUDENT.name}`));
  });
  await visit('student-ledger', async () => {
    await openCourse();
    await tap(byId(page, `student-ledger-${STUDENT.email}`));
  });
  await visit('zoom-import', async () => {
    await openCourse();
    await tap(byId(page, 'nav-sessions'));
    await tap(byId(page, 'session-open-Session 6 — Today (recording pending)'));
    await tap(byId(page, 'recording-import-zoom'));
  });
  await visit('library', () => tap(byId(page, 'nav-library')));
  await visit('player', async () => {
    await tap(byId(page, 'nav-library'));
    await tap(byId(page, `library-listen-${missed.title}`));
  });
  await visit('audit', () => tap(byId(page, 'nav-audit-global')));
  await visit('notifications', () => tap(byId(page, 'nav-notifications')));
  await visit('tokens', () => tap(byName(page, 'Design tokens')));

  check(`${tag} reached every staff screen`, counter.seen === STAFF_SCREENS,
    `${counter.seen}/${STAFF_SCREENS}`);
}

const MANAGER_SCREENS = 5;

/**
 * A manager sees the same screens with fewer rows AND fewer controls, which is a
 * different layout rather than the same one with less in it: no Cohorts, no
 * Staff, a home with a different set of buttons, a course whose admin-only
 * actions are simply absent, an audit scoped to their own class.
 *
 * Toured separately because an admin's run is not evidence about it. A row that
 * fits once its Disable button is gone proves nothing about the row that still
 * has one, and the reverse — a manager's narrower row breaking where the
 * admin's wraps — is the case nobody would ever see, because the person who
 * owns the app never renders it.
 */
async function tourManager(page, tag) {
  const counter = { seen: 0 };
  const visit = visitor(page, tag, 'nav-myclasses', counter);
  const openCourse = async () => {
    await tap(byId(page, 'nav-myclasses'));
    await tap(byId(page, 'course-open-Hikam Foundations'));
  };

  await visit('home', async () => {});
  await visit('my-courses', () => tap(byId(page, 'nav-myclasses')));
  await visit('course', openCourse);
  await visit('audit-scoped', async () => {
    await openCourse();
    await tap(byId(page, 'nav-audit'));
  });
  await visit('library', () => tap(byId(page, 'nav-library')));

  check(`${tag} reached every manager screen`, counter.seen === MANAGER_SCREENS,
    `${counter.seen}/${MANAGER_SCREENS}`);
}

const STUDENT_SCREENS = 5;

async function tourStudent(page, tag) {
  const counter = { seen: 0 };
  const visit = visitor(page, tag, 'student-classes', counter);

  // The task list, with all four buckets on it — Missed, Due soon, Upcoming,
  // Completed. Those group headings ARE the layout.
  await visit('home', async () => {});
  await visit('my-classes', () => tap(byId(page, 'student-classes')));
  await visit('class-record', async () => {
    await tap(byId(page, 'student-classes'));
    await tap(byId(page, 'myclass-Hikam Foundations'));
  });
  // An open recording: the transport, the scrubber and the speed chips, which
  // are the only fixed-width row in the app.
  await visit('player', () => tap(byId(page, `task-${dueSoon.title}`)));
  await visit('notifications', () => tap(byId(page, 'nav-notifications')));

  /*
   * NOT toured: the player with access closed. A missed card is deliberately
   * not a button — the server would refuse to mint a URL, and a card that looks
   * tappable and then refuses reads as a broken app rather than a deadline that
   * passed — so no route a student has reaches that layout. The missed CARD is
   * on `home` and the closed line is on `class-record`, which is the whole of
   * what a student is actually shown about it. Give a student a way to open a
   * closed recording and this is where its width sweep belongs.
   */

  check(`${tag} reached every student screen`, counter.seen === STUDENT_SCREENS,
    `${counter.seen}/${STUDENT_SCREENS}`);
}

// ---- the sweep -------------------------------------------------------------

async function signInStaff(page, testId, homeMarker) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await tap(byId(page, testId), 60_000);
  await byId(page, homeMarker).waitFor({ timeout: 60_000 });
}

async function signInStudent(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await byId(page, 'signin-email').fill(STUDENT.email);
  await byId(page, 'signin-password').fill(STUDENT_PASSWORD);
  await tap(byId(page, 'signin-student'));
  await byId(page, 'student-classes').waitFor({ timeout: 60_000 });
}

const TOURS = [
  ['staff', (page) => signInStaff(page, 'dev-signin-first-admin', 'nav-cohorts'), tourStaff],
  ['manager', (page) => signInStaff(page, 'dev-signin-manager', 'nav-myclasses'), tourManager],
  ['student', signInStudent, tourStudent],
];

try {
  const runs = [
    ...WIDTHS.map((w) => [`${w}px`, { viewport: { width: w, height: 900 } }, w]),
    ...PROFILES.map(([label, d]) => [label, d, d.viewport.width]),
  ];
  for (const [tag, contextOptions, width] of runs) {
    for (const [who, signIn, tour] of TOURS) {
      // A fresh context per population: sessions do not share, and a stale one
      // restores the OTHER population's route — the shared-device case the route
      // tables were split for.
      const ctx = await browser.newContext(contextOptions);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => check(`${tag}/${who} page error`, false, String(e).slice(0, 110)));
      await signIn(page);
      // Before the tour, so a viewport that did not apply fails here rather than
      // a whole tour later, having quietly measured the wrong width.
      const at = await laidOutAt(page);
      check(
        `${tag}/${who} laid out at ${width}px`,
        at.layout === width,
        `documentElement.clientWidth = ${at.layout}, window.innerWidth = ${at.window}`,
      );
      await tour(page, `${tag}-${who}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

// The app puts a `DateField` on three toured screens (SessionDetail, Sessions,
// ZoomImport), so this is a real expectation rather than a formality.
/*
 * `> 0`, not a threshold. The honest claim without a run is "it looked at
 * something"; anything larger would be a number reasoned to rather than
 * measured, which is the thing this file exists to distrust — and it would be a
 * fabricated figure inside the fix for a fabricated-safety bug. The real counts
 * are printed instead, so a fall from many to few is visible to a reader
 * without a threshold pretending to be data.
 */
check(
  'the squash check examined some fixed-format controls',
  fixedFormatSeen > 0,
  'its selector matched nothing all sweep — the check is inert, not passing',
);
console.log(`examined: ${controlsSeen} controls, ${fixedFormatSeen} fixed-format`);

const failed = results.filter((r) => !r.ok);
const viewports = WIDTHS.length + PROFILES.length;
const screens = STAFF_SCREENS + MANAGER_SCREENS + STUDENT_SCREENS;
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`shots/screens/ — ${viewports} viewports x ${screens} screens`);
if (!FULL) console.log('SWEEP_FULL=1 adds real device profiles (DPR, touch, UA).');
if (failed.length) {
  console.error(`FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
