#!/usr/bin/env node
/**
 * End-to-end walkthrough against the web dev server and the emulator suite.
 *
 * Exists because a sign-in screenshot is evidence about nothing else — it is the
 * only screen an unauthenticated script can reach, and it exercises almost none
 * of the app. This drives the real flows and screenshots the authenticated
 * screens, so a phase can be verified without re-deriving the same manual clicks
 * every time.
 *
 * Model: Cohort → Course → Session → Recording. A session owns attendance
 * (present/absent/excused). Being marked EXCUSED is the whole of a student's
 * entitlement: it grants the recording and requires listening to it, once the
 * recording is published AND attendance has been submitted, and it lapses when
 * the session's due date passes. Present and absent grant nothing. There is no
 * "catch-up" concept — a student enrolled after a session's attendance snapshot
 * is simply never in it (enrollment-onward).
 *
 * Prerequisites (see docs/DEV-TOOLING.md):
 *   firebase emulators:start --project demo-sabeel --only firestore,auth,storage,functions
 *   cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --web --port 61111 --clear
 *
 * Then: npm run test:e2e
 *
 * SCOPE: this exercises real user FLOWS end to end. It is not a security suite —
 * most screens only query what the user may see, so a widened rule can leave
 * every screen looking correct. Authorization is asserted in
 * functions/test/integration/rules.*.test.ts, which are mutation-tested.
 *
 * Screenshots land in e2e-shots/ (gitignored). LOOK AT THEM — correct values in
 * palette.ts survive right up until you read the rendered screen.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { EMULATOR_PORTS, WEB_PORTS } from './lib/ports.mjs';

const WEB = process.env.E2E_WEB ?? `http://127.0.0.1:${WEB_PORTS.e2e}/`;
const FN = `http://127.0.0.1:${EMULATOR_PORTS.functions}/demo-sabeel/us-central1`;
const FS = `http://127.0.0.1:${EMULATOR_PORTS.firestore}`;
const FS_READ = `${FS}/v1/projects/demo-sabeel/databases/(default)/documents`;
const FS_WIPE = `${FS}/emulator/v1/projects/demo-sabeel/databases/(default)/documents`;
const AUTH = `http://127.0.0.1:${EMULATOR_PORTS.auth}`;
const SHOTS = 'e2e-shots';
const AUDIO_FIXTURE = process.env.E2E_AUDIO ?? 'e2e-shots/test-lecture.m4a';
/** The fixture's length, shared by the generator below and the metadata check,
 *  so the two cannot drift. A substitute supplied via E2E_AUDIO must match it. */
const AUDIO_SECONDS = 720;

/**
 * A real 12-minute 32 kbps mono M4A — the shape of an actual class recording
 * (a two-hour one lands near 29 MB at this bitrate).
 *
 * GENERATED rather than committed: a 3 MB binary in git is exactly what this
 * repo's "never add a binary" rule exists to prevent, and ffmpeg reproduces it
 * identically in a second.
 */
function ensureAudioFixture() {
  if (existsSync(AUDIO_FIXTURE)) return;
  try {
    execFileSync('ffmpeg', [
      '-f', 'lavfi', '-i', `sine=frequency=220:duration=${AUDIO_SECONDS},volume=0.3`,
      '-c:a', 'aac', '-b:a', '32k', '-ac', '1', AUDIO_FIXTURE, '-y',
    ], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `Could not generate ${AUDIO_FIXTURE}. Install ffmpeg, or point E2E_AUDIO at a ` +
        `${AUDIO_SECONDS}-second audio file (it must live OUTSIDE ${SHOTS}/, which this ` +
        'suite wipes on startup).',
    );
  }
}

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

/**
 * Start from nothing. Leftover emulator state silently SKIPS the paths that
 * matter — a first run left an admin behind, and every later run then jumped
 * straight past the pending screen while still reporting success.
 */
async function reset() {
  for (const [what, url] of [
    ['firestore', FS_WIPE],
    ['auth', `${AUTH}/emulator/v1/projects/demo-sabeel/accounts`],
  ]) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`could not clear ${what}: ${r.status}`);
  }
}

/** Out-of-band read; 'Bearer owner' bypasses rules deliberately. */
async function readCollection(name) {
  const r = await fetch(`${FS_READ}/${name}`, { headers: { Authorization: 'Bearer owner' } });
  const j = await r.json();
  return j.documents ?? [];
}

const activeAssignments = async () =>
  (await readCollection('assignments')).filter((a) => a.fields.active?.booleanValue === true);

/**
 * Set one field on one document, out of band.
 *
 * Used to plant a due date already in the past, which no callable will do — the
 * whole point of the validators is that a deadline can only BECOME past by the
 * passage of time. The trigger still fires, so this exercises the real
 * reconcile rather than faking its output.
 */
async function patchField(name, docId, field, value, type = 'stringValue') {
  const url = `${FS_READ}/${name}/${docId}?updateMask.fieldPaths=${field}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { [field]: { [type]: value } } }),
  });
  if (!r.ok) throw new Error(`patch ${name}/${docId} failed: ${r.status} ${await r.text()}`);
}

const browser = await chromium.launch();
const consoleErrors = [];

/**
 * Every live subscription that was ever refused, across every page in the run.
 *
 * `reportListenerError` emits `console.WARN`, so none of this reached
 * `consoleErrors` — three separate denials shipped in v0.3.0 while this suite
 * stayed green, because each one renders as an ordinary empty state and the
 * banner sits above the fold on screens the checks never read. A denial is
 * never correct in a flow the app itself drives, so collect them globally and
 * fail the run on any.
 */
const listenerDenials = [];

async function newSession() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    // Denials the app marks expected (a session ending) are excluded by design.
    if (m.type() === 'warning' && / listener\b/.test(m.text()) && !/expected/.test(m.text())) {
      listenerDenials.push(m.text());
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  return page;
}

/** Tap by testID. Text locators are unreliable here: react-navigation keeps the
 *  previous screen mounted, so a text match can resolve to a hidden node. */
/**
 * Tap by testID — the VISIBLE one.
 *
 * `.filter({ visible: true })` is load-bearing, not decoration. React Navigation
 * keeps the screen you navigated away from MOUNTED, hidden with `display: none`,
 * and its test ids stay queryable — `getByTestId` is a plain attribute selector,
 * so unlike a role selector it matches straight into a hidden subtree. Without
 * the filter a locator can resolve to a control on the screen UNDERNEATH, which
 * will never become clickable; Playwright then retries for the full timeout and
 * the run dies at a step with nothing wrong with it. The sibling time-tracker's
 * equivalent suite was losing roughly one run in two to exactly this before it
 * was named, at clean HEAD.
 *
 * Note this is a stronger claim than the older advice in docs/DEV-TOOLING.md,
 * which said to prefer `getByTestId` over text locators. That does not help: a
 * test id matches hidden nodes just as happily. Only the visible filter excludes
 * the screen below.
 */
async function tap(page, testId, timeout = 20000) {
  const el = page.getByTestId(testId).filter({ visible: true }).first();
  await el.waitFor({ timeout });
  await el.click();
}

/** Same trap, same fix: `.first()` means document order, not "the one on screen". */
const sawText = (page, text, timeout = 20000) =>
  page
    .getByText(text, { exact: false })
    .filter({ visible: true })
    .first()
    .waitFor({ timeout });

/** Home by URL. Since the linking config landed the stack IS browser history,
 *  so goBack() works too — this goes to `/`, which is the Home path. */
async function goHome(page) {
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}

/** Admin: Cohorts → Autumn 2026 → Hikam Foundations, from home. Reused a lot. */
async function openHikam(page) {
  await goHome(page);
  await tap(page, 'nav-cohorts');
  await tap(page, 'cohort-open-Autumn 2026');
  await tap(page, 'course-open-Hikam Foundations');
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
ensureAudioFixture();
await reset();

// ---------------------------------------------------------------- identity --
console.log('\nIdentity');
const admin = await newSession();
await shot(admin, '01-signin');
check('sign-in screen renders', (await admin.locator('body').innerText()).includes('Sign in with Google'));

await tap(admin, 'dev-signin-first-admin');
await sawText(admin, 'Waiting for approval');
check('first staff sign-in lands PENDING — domain membership grants nothing', true);
await shot(admin, '02-pending');

const boot = await fetch(`${FN}/bootstrapAdmin`);
await admin.getByTestId('nav-cohorts').waitFor({ timeout: 30000 });
check('bootstrapAdmin promotes and the gate lifts LIVE, with no sign-out', boot.status === 200);
await shot(admin, '03-home-admin');

const again = await fetch(`${FN}/bootstrapAdmin`);
check('bootstrapAdmin refuses a second call', again.status === 409);

// A second staff member, approved from the admin's session.
const mgr = await newSession();
await tap(mgr, 'dev-signin-manager');
await sawText(mgr, 'Waiting for approval');
await tap(admin, 'nav-staff');
await tap(admin, 'approve-manager@oursabeel.com');
await mgr.getByTestId('nav-myclasses').waitFor({ timeout: 30000 });
check('approving a pending manager un-gates THEIR session live', true);

// An off-domain account must be deleted outright, not marked rejected.
const outsider = await newSession();
await tap(outsider, 'dev-signin-outsider');
/**
 * Wait for the TRANSITION, not for a duration.
 *
 * This used to sleep 6000ms and assert once, which made it load-sensitive: the
 * budget has to cover sign-in, the auth trigger running, the delete, and the
 * client re-rendering. Observed failing and passing on identical bytes, which is
 * how it was found — a check that returns both results from the same code is
 * evidence about the machine, not the app.
 *
 * The obvious repair — poll for 'Emulator sign-in' — does NOT work, and the
 * reason is worth keeping: that text is on the SIGN-IN screen, which is where
 * this starts. It is present before the click, so a wait for it succeeds
 * instantly against the pre-click state and asserts nothing at all. It is not a
 * landmark; its RETURN is.
 *
 * So: wait for the dev row to go (we left sign-in and are provisioning), then
 * for it to come back (the trigger deleted the account and dropped us out).
 * Both waits are tolerant, so a timeout surfaces as the assertion below failing
 * with the page's actual text rather than as an exception with none.
 */
const outsiderDevRow = outsider.getByText('Emulator sign-in', { exact: false }).first();
await outsiderDevRow.waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
await outsiderDevRow.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
check(
  'an off-domain sign-in is deleted and lands back at sign-in',
  (await outsider.locator('body').innerText()).includes('Emulator sign-in'),
);

// A stranger self-registering with email/password must also be deleted.
//
// This is driven through the REST API rather than the UI because the app offers
// no sign-up control at all — which is exactly why it has to be tested this way:
// the absence of a button is not a control, and anyone can post to this
// endpoint with the public API key.
//
// It matters because the console setting that would block it
// (`disabledUserSignup`) cannot be used — it also blocks a staff member's first
// Google sign-in with `auth/admin-restricted-operation`. The trigger is the only
// thing standing here.
const strangerEmail = `stranger-${Date.now()}@example.com`;
const signUp = await fetch(
  `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: strangerEmail, password: 'hunter2hunter2', returnSecureToken: true }),
  },
);
check('a self-signup is not blocked at the door (so the trigger must catch it)', signUp.ok);

// Asserted by trying to USE the credential, not by listing accounts.
//
// The first version of this check polled the emulator's
// /emulator/v1/projects/*/accounts endpoint — which is DELETE-only, so the GET
// returned `{"message":"Method GET not allowed"}`, `userInfo` was undefined, and
// the check passed unconditionally. It survived a deliberate mutation of the
// rule it was written to protect, which is the only reason it was caught.
// Signing in cannot be vacuous: either the credential works or it does not.
let strangerDenied = '';
for (let i = 0; i < 20 && !strangerDenied; i++) {
  await outsider.waitForTimeout(1000);
  const r = await fetch(
    `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: strangerEmail, password: 'hunter2hunter2', returnSecureToken: true }),
    },
  );
  const body = await r.json();
  if (body.error) strangerDenied = body.error.message;
}
check(
  'a self-registered account is deleted — its credential stops working',
  strangerDenied === 'EMAIL_NOT_FOUND',
  strangerDenied || 'sign-in still succeeded',
);

// ------------------------------------------------------- academic structure --
console.log('\nAcademic structure');
await goHome(admin);
await tap(admin, 'nav-cohorts');
await admin.getByTestId('cohort-name').fill('Autumn 2026');
await tap(admin, 'cohort-create');
await tap(admin, 'cohort-open-Autumn 2026');
for (const name of ['Hikam Foundations', 'Arabic I']) {
  await admin.getByTestId('course-name').fill(name);
  await tap(admin, 'course-create');
  await admin.getByTestId(`course-open-${name}`).waitFor({ timeout: 20000 });
}
check('a cohort and two courses are created', true);
await shot(admin, '04-courses');

// ------------------------------------------------------- browser history --
// Back used to leave the site: with no `linking` config React Navigation never
// touches history, so the whole app sat in one entry. Every screen now has a
// path, which also means the params must stay ids — a document param serialises
// to "[object Object]" in the URL and comes back as that string.
const path = () => new URL(admin.url()).pathname;
await goHome(admin);
await tap(admin, 'nav-cohorts');
check('navigating pushes a real URL', path() === '/cohorts', path());
await tap(admin, 'cohort-open-Autumn 2026');
await admin.waitForTimeout(1200);
const cohortUrl = admin.url();
check('a cohort is addressable', /^\/cohorts\/.+/.test(path()), path());
await tap(admin, 'course-open-Hikam Foundations');
await admin.waitForTimeout(1200);
const courseUrl = admin.url();
check('a course is addressable', /^\/courses\/.+/.test(path()), path());

await admin.goBack();
await admin.waitForTimeout(1500);
check('Back returns to the cohort rather than leaving the site', admin.url() === cohortUrl, path());
await admin.goForward();
await admin.waitForTimeout(1500);
check('Forward returns to the course', admin.url() === courseUrl, path());

// Cold-loading a deep URL must land on that screen, which only works because the
// screen resolves its documents from the id rather than a passed-in snapshot.
await admin.goto(courseUrl, { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(5000);
check(
  'a course URL opened cold renders that course',
  (await admin.locator('body').innerText()).toLowerCase().includes('hikam foundations'),
  path(),
);
// A URL whose subject is gone must SAY so. The screens resolve their subject
// from the id, and a live document read is empty both while it is in flight and
// when there is nothing there — so without the resolved flag this spins for
// ever, which is what a student would see when a recording they had open is
// unpublished out from under them.
await admin.goto(`${WEB}courses/no-such-course-id`, { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(6000);
check(
  'a URL pointing at something deleted says so instead of loading for ever',
  (await admin.locator('body').innerText()).toLowerCase().includes('not available'),
);

// Leave the browser back on the cohort, where the next section starts from.
await admin.goto(cohortUrl, { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(3000);

// Scope ONE course to the manager.
//
// The toggle is asserted from the ADMIN's own screen, three times, because the
// screen used to render a CourseRow frozen at navigation time: the tick never
// moved (so the write looked like it had failed), and every toggle recomputed
// the manager list from that same pre-change array, so each one silently undid
// the last. Checking only that the manager ends up scoped would pass on the
// broken build — the first write does land. The third tap is what proves the
// list is live: computed from a stale array, "remove" sends the array that adds
// them, and they stay a manager forever.
await tap(admin, 'course-open-Hikam Foundations');
const mgrTick = admin.getByTestId('course-manager-manager@oursabeel.com');
const tickState = async () => {
  await admin.waitForTimeout(2500);
  return mgrTick.getAttribute('aria-checked');
};
await tap(admin, 'course-manager-manager@oursabeel.com');
check('assigning a manager ticks the row live, without leaving the screen', (await tickState()) === 'true');
await tap(admin, 'course-manager-manager@oursabeel.com');
check('un-assigning clears it — the next write reads the LIVE list', (await tickState()) === 'false');
await tap(admin, 'course-manager-manager@oursabeel.com');
check('re-assigning ticks it again', (await tickState()) === 'true');
await shot(admin, '05-course-detail');

await tap(mgr, 'nav-myclasses');
await mgr.getByTestId('course-open-Hikam Foundations').waitFor({ timeout: 20000 });
await mgr.waitForTimeout(1500);
// innerText returns only VISIBLE text, so retained nodes from the previous
// screen cannot make this pass spuriously.
const mgrSees = await mgr.locator('body').innerText();
// These two are UI checks, NOT security checks, and the distinction matters.
// useMyCourses() filters with array-contains in the QUERY, so this list would
// look correct even if the rule let any staff member read any course — verified
// by widening the rule and watching these still pass.
//
// The security boundary is asserted in functions/test/integration/
// rules.structure.test.ts, which IS mutation-tested against exactly that change.
check('the manager\'s course list shows the course they are scoped to', mgrSees.includes('Hikam Foundations'));
check('the manager\'s course list omits courses they are not scoped to', !mgrSees.includes('Arabic I'));
await shot(mgr, '06-my-courses');

// --------------------------------------------------------------- enrolment --
console.log('\nEnrolment');
await goHome(admin);
await tap(admin, 'nav-students');
await admin.getByTestId('student-name').fill('Fatima Ahmed');
await admin.getByTestId('student-email').fill('fatima@example.com');
await tap(admin, 'student-course-Hikam Foundations');
await tap(admin, 'student-create');
await sawText(admin, 'Account created');
check('a student is created and enrolled in one step', true);
await shot(admin, '07-students');

await openHikam(admin);
await sawText(admin, 'Fatima Ahmed');
await admin.waitForTimeout(1200);
check('the roster shows the enrolled student', true);
await shot(admin, '08-roster');

// The student sets a password from the emailed link and signs in. Redeemed
// through the same endpoint the SDK's confirmPasswordReset() calls, so this
// tests the real link rather than the emulator's own reset page markup.
const oob = await (await fetch(`${AUTH}/emulator/v1/projects/demo-sabeel/oobCodes`)).json();
const reset0 = (oob.oobCodes ?? []).filter((c) => c.email === 'fatima@example.com').pop();
const redeem = await fetch(
  `${AUTH}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=fake-api-key`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode: reset0?.oobCode, newPassword: 'StudentPass123!' }),
  },
);
check('a set-password link is issued and redeemable', redeem.status === 200);

const student = await newSession();
await student.getByTestId('signin-email').fill('fatima@example.com');
await student.getByTestId('signin-password').fill('StudentPass123!');
await tap(student, 'signin-student');
// The student lands on their task home ("Your listening"), not a staff greeting.
await sawText(student, 'Your listening', 25000);
check('the student signs in with their own password', true);
await shot(student, '09-home-student');

// ------------------------------------------------ session, attendance, publish --
console.log('\nSession, attendance, and the publish fan-out');
await openHikam(admin);
await tap(admin, 'nav-sessions');
await admin.getByTestId('session-title').fill('Session 1');
await tap(admin, 'session-create');
await tap(admin, 'session-open-Session 1');

// Take attendance: mark the enrolled student EXCUSED — the only mark that opens
// a recording to a student — and submit. Nobody is granted anything yet: there
// is no published recording.
await admin.getByTestId('att-Fatima Ahmed-excused').waitFor({ timeout: 15000 });
await tap(admin, 'att-Fatima Ahmed-excused');
await tap(admin, 'att-submit');
await admin.waitForTimeout(2000);
check(
  'submitting attendance before a recording exists grants nobody',
  (await activeAssignments()).length === 0,
);
await shot(admin, '10-attendance');

// Upload the recording to the session.
const chooser = admin.waitForEvent('filechooser');
await tap(admin, 'recording-upload');
await (await chooser).setFiles(AUDIO_FIXTURE);
await sawText(admin, 'published', 90000).catch(() => {}); // status chip appears after finalize
await admin.waitForTimeout(1500);
const recs = await readCollection('recordings');
const rf = recs[0]?.fields ?? {};
/*
 * Sized against the file that was actually uploaded, not a literal.
 *
 * This asserted `sizeBytes === '3049585'` — the exact byte count of one ffmpeg
 * build's output. That made the whole suite unrunnable anywhere ffmpeg is
 * missing: E2E_AUDIO is offered as the escape hatch two hundred lines up, and
 * any fixture you point it at fails here. Reading the fixture's own size keeps
 * the check strict — it still proves the app recorded the REAL file rather than
 * a default — while letting the documented escape hatch work.
 */
const fixtureBytes = statSync(AUDIO_FIXTURE).size;
check(
  'duration and size are recorded from the real file',
  rf.durationSec?.integerValue === String(AUDIO_SECONDS) &&
    rf.sizeBytes?.integerValue === String(fixtureBytes),
  `duration=${rf.durationSec?.integerValue} (want ${AUDIO_SECONDS}) ` +
    `size=${rf.sizeBytes?.integerValue} (fixture is ${fixtureBytes})`,
);
check('the recording is linked to its session', !!rf.sessionId?.stringValue);

// Publish it. The publish fan-out TRIGGER now sees a published recording AND a
// submitted attendance, so it grants the excused student. This is the one place
// the real onRecordingWritten runs (the integration tests exercise the logic).
await tap(admin, 'recording-published');
await admin.waitForTimeout(2500);
check(
  'publishing sets the status',
  (await readCollection('recordings'))[0].fields.status.stringValue === 'published',
);
let assignments = [];
for (let i = 0; i < 20 && assignments.length === 0; i++) {
  await admin.waitForTimeout(500);
  assignments = await activeAssignments();
}
check(
  'publishing fans out a grant to the EXCUSED student (real trigger)',
  assignments.length === 1,
  `${assignments.length} active assignment(s)`,
);
await shot(admin, '11-session-published');

// The student plays it. Same session that set its own password above.
await goHome(student);
await student.getByTestId('task-Session 1').waitFor({ timeout: 10000 });
await tap(student, 'task-Session 1');
await student.getByTestId('player-play').waitFor({ timeout: 25000 });
await student.waitForTimeout(1500);
check('a student reaches the player for their required recording', true);
await shot(student, '12-player');

/** Elapsed time as seconds, read from the player's own readout. */
const elapsedSeconds = async (page) => {
  const raw = (await page.getByTestId('player-elapsed').innerText()).trim();
  const [m, s] = raw.split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};

await tap(student, 'player-play');
await student.waitForTimeout(6000);
const advanced = await elapsedSeconds(student);
check(
  'audio actually advances (a signed URL streamed)',
  advanced >= 3,
  `elapsed ${advanced}s after 6s of playback`,
);

// Skip forward, then confirm progress is persisted.
await tap(student, 'player-forward');
await student.waitForTimeout(2500);
const progressDocs = await readCollection('listeningProgress');
check('progress is persisted for the student', progressDocs.length === 1,
  `${progressDocs.length} progress docs`);

// Seek by pressing the scrubber near 75%. On web this is a hand-rolled
// PanResponder bar (the native @react-native-community/slider has no web build,
// so Scrubber.web.tsx is the seam); pressing commits a seek to that position
// through the same grant→onSeek path a drag uses. A synthetic playwright drag
// can't feed react-native-web's gesture delta, so the press is what is reliably
// driveable here — the seek itself is what we are asserting.
const midY = (b) => b.y + b.height / 2;
const bar = await student.getByTestId('player-scrubber').boundingBox();
await student.mouse.move(bar.x + bar.width * 0.75, midY(bar));
await student.mouse.down();
await student.waitForTimeout(250);
await student.mouse.up();
await student.waitForTimeout(2500);
const seekedTo = await elapsedSeconds(student);
check(
  'pressing the scrubber seeks to that position',
  seekedTo > 470 && seekedTo < 610,
  `landed at ${seekedTo}s (~75% of 720s)`,
);
await tap(student, 'player-play'); // pause, so the saved position settles

const savedMs = Number(
  (await readCollection('listeningProgress'))[0].fields.positionMs.integerValue,
);

await goHome(student);
await tap(student, 'task-Session 1');
await student.getByTestId('player-play').waitFor({ timeout: 25000 });
await student.waitForTimeout(2500);
const resumedAt = await elapsedSeconds(student);
check(
  'playback RESUMES where it left off after a reload',
  resumedAt > 0 && Math.abs(resumedAt - savedMs / 1000) <= 5,
  `resumed at ${resumedAt}s, saved ${Math.round(savedMs / 1000)}s`,
);
await shot(student, '13-resumed');

// ------------------------------------------------- completion on the home --
console.log('\nCompletion');
// Mark it complete from the player — the never-played gate is already satisfied.
await tap(student, 'mark-complete');
await student.waitForTimeout(1500);
const completions = await readCollection('completions');
check(
  'marking complete writes a completion doc',
  completions.length === 1 && completions[0].fields.completed.booleanValue === true,
  `${completions.length} completion(s)`,
);
check(
  'a completion event is appended (append-only audit)',
  (await readCollection('completionEvents')).some((e) => e.fields.action?.stringValue === 'complete'),
);
await student.getByTestId('mark-incomplete').waitFor({ timeout: 8000 });
check('the player reflects completion and offers unmark', true);

await goHome(student);
await student.getByTestId('task-Session 1').waitFor({ timeout: 8000 });
const homeText = await student.locator('body').innerText();
check('the student home moves the recording to Completed', /Completed/.test(homeText));
await shot(student, '14-home-completed');

// ---------------------------------------- the student's own attendance record --
// The class list holds each course in a DOCUMENT listener, because a student is
// granted `get` on their course and never `list` — the list-shaped subscription
// used on staff screens is denied here, and denial looks like an empty screen
// plus a console warning, not a crash. So the course NAME rendering is the
// assertion: it can only come from a document listener the rules allowed.
await tap(student, 'student-classes');
await student.getByTestId('myclass-Hikam Foundations').waitFor({ timeout: 20000 });
// innerText returns RENDERED text, and SectionTitle uppercases via CSS — so this
// compares case-insensitively rather than against the source string.
const classesText = (await student.locator('body').innerText()).toLowerCase();
check(
  'a student sees their own classes — the course doc listener is permitted',
  classesText.includes('hikam foundations'),
);

await tap(student, 'myclass-Hikam Foundations');
await student.getByTestId('attendance-Session 1').waitFor({ timeout: 20000 });
const recordText = await student.locator('body').innerText();
// Their own mark, out of a session document they can never read: this can only
// have come from the attendanceRecords projection the trigger wrote.
check(
  "the student sees their own attendance mark for the session",
  /Excused/.test(recordText) && /Session 1/.test(recordText),
);
check(
  'an excused row says a recording was required and that it is done',
  /Recording required/.test(recordText) && /completed/i.test(recordText),
);
check(
  'the tally counts the mark',
  /1[\s\S]{0,40}EXCUSED/i.test(recordText),
  recordText.replace(/\n+/g, ' | ').slice(0, 200),
);
await shot(student, '14b-attendance-record');

// ---------------------------------------- enrollment-onward accountability --
console.log('\nEnrollment-onward (no retroactive assignment)');
// A genuinely late student: enrolled AFTER Session 1's attendance was submitted,
// so they are not in its snapshot and get no obligation for it. This is the
// replacement for the old "catch-up" path — accountability is attendance-driven.
await goHome(admin);
await tap(admin, 'nav-students');
await admin.getByTestId('student-name').fill('Bilal Khan');
await admin.getByTestId('student-email').fill('bilal@example.com');
await tap(admin, 'student-course-Hikam Foundations');
await tap(admin, 'student-create');
await admin.waitForTimeout(2500);
check(
  'a student enrolled after the snapshot is NOT assigned the past session',
  (await activeAssignments()).length === 1,
  `${(await activeAssignments()).length} active assignment(s)`,
);

await openHikam(admin);
await tap(admin, 'nav-sessions');
await tap(admin, 'session-open-Session 1');

// First mark him ABSENT — an unexcused miss. Under the excused-only policy that
// grants nothing at all, which is the whole change in one assertion: the same
// action that used to create an obligation now creates none.
await admin.getByTestId('att-Bilal Khan-absent').waitFor({ timeout: 15000 });
await tap(admin, 'att-Bilal Khan-absent');
await tap(admin, 'att-submit');
await admin.waitForTimeout(3000);
check(
  'marking the late student ABSENT grants them nothing',
  (await activeAssignments()).length === 1,
  `${(await activeAssignments()).length} active assignment(s)`,
);

// Now excuse him. Re-submitting reconciles via onSessionWritten, granting him
// the already-published recording — without disturbing Fatima's completion.
await tap(admin, 'att-Bilal Khan-excused');
await tap(admin, 'att-submit');
let afterResubmit = [];
for (let i = 0; i < 20 && afterResubmit.length < 2; i++) {
  await admin.waitForTimeout(500);
  afterResubmit = await activeAssignments();
}
check(
  're-submitting attendance with the late student EXCUSED grants them (onSessionWritten)',
  afterResubmit.length === 2,
  `${afterResubmit.length} active assignment(s)`,
);
check(
  'Fatima\'s completion survived the reconcile',
  (await readCollection('completions')).length === 1,
);
await shot(admin, '15-resubmit');

// ------------------------------------------------ recording ledger + override --
console.log('\nRecording ledger, override, CSV');
await tap(admin, 'recording-ledger');
await admin.getByTestId('ledger-filter-all').waitFor({ timeout: 10000 });
await tap(admin, 'ledger-filter-all');
await admin.waitForTimeout(1000);
let ledgerText = await admin.locator('body').innerText();
check(
  'the recording ledger lists the accountable roster (Fatima + Bilal, both absent)',
  /Fatima Ahmed/.test(ledgerText) && /Bilal Khan/.test(ledgerText),
);

// Override Bilal → complete, with a required reason.
await tap(admin, 'ledger-filter-notComplete');
await admin.getByTestId('override-open-Bilal Khan').waitFor({ timeout: 8000 });
await tap(admin, 'override-open-Bilal Khan');
await admin.getByTestId('override-reason-Bilal Khan').fill('Attended the class live');
await tap(admin, 'override-complete-Bilal Khan');
await admin.waitForTimeout(1800);
const overrides = await readCollection('completionOverrides');
check(
  'staff override writes a completionOverrides doc with the reason',
  overrides.length === 1 &&
    overrides[0].fields.completed.booleanValue === true &&
    overrides[0].fields.reason.stringValue === 'Attended the class live',
  `${overrides.length} override(s)`,
);

await tap(admin, 'ledger-filter-all');
await admin.waitForTimeout(1000);
ledgerText = await admin.locator('body').innerText();
check(
  'the overridden student now shows Complete (override) on the ledger',
  /Complete \(override\)/.test(ledgerText),
);
await shot(admin, '16-recording-ledger');

// CSV equals the screen: header + one row per accountable student (Fatima, Bilal).
const [download] = await Promise.all([admin.waitForEvent('download'), tap(admin, 'ledger-export')]);
const csv = readFileSync(await download.path(), 'utf8');
const csvLines = csv.trim().split('\r\n');
check(
  'CSV mirrors the ledger row-for-row (header + 2 accountable students)',
  csvLines[0].startsWith('Student,Attendance,Status,Listened %') && csvLines.length === 3,
  `${csvLines.length} lines`,
);
check('CSV reflects the override', /Complete \(override\)/.test(csv));

// ------------------------------------------------------- attendance report --
console.log('\nAttendance report');
await openHikam(admin);
await tap(admin, 'nav-attendance');
// Defaults to the "By session" view; the two cuts are a toggle, not stacked.
await admin.getByTestId('attendance-tab-sessions').waitFor({ timeout: 10000 });
await admin.waitForTimeout(1000);
const sessionsView = await admin.locator('body').innerText();
check(
  'the by-session view shows the session and the taken state',
  /Session 1/.test(sessionsView) && /1 of 1 sessions taken/.test(sessionsView),
);
await shot(admin, '17-attendance-by-session');

// Toggle to the by-student cut; the screen updates in place.
await tap(admin, 'attendance-tab-students');
await admin.getByTestId('attendance-export-students').waitFor({ timeout: 10000 });
await admin.waitForTimeout(800);
const studentsView = await admin.locator('body').innerText();
check(
  'toggling to by-student shows catch-up state (Bilal caught up via override)',
  /Bilal Khan/.test(studentsView) && /Catch-up/.test(studentsView),
);
check(
  'the toggle swaps the view: the by-session export is gone, the by-student export is present',
  (await admin.getByTestId('attendance-export-sessions').count()) === 0 &&
    (await admin.getByTestId('attendance-export-students').count()) === 1,
);
await shot(admin, '17-attendance-by-student');

const [dl2] = await Promise.all([
  admin.waitForEvent('download'),
  tap(admin, 'attendance-export-students'),
]);
const studentCsv = readFileSync(await dl2.path(), 'utf8').trim().split('\r\n');
check(
  'the by-student attendance CSV has a header + one row per enrolled student',
  studentCsv[0].startsWith('Student,Present,Absent,Excused') && studentCsv.length === 3,
  `${studentCsv.length} lines`,
);

// Both cuts of the report drill down, and land on the row that was tapped —
// a report you cannot click through from is a dead end.
const stuCard = admin
  .locator('[data-testid^="attendance-student-"]')
  .filter({ visible: true })
  .first();
const stuName = (await stuCard.innerText()).split('\n')[0].trim();
await stuCard.click();
await admin.waitForTimeout(2500);
let drill = await admin.locator('body').innerText();
check(
  'a by-student card opens THAT student’s listening progress',
  /required listening/i.test(drill) && drill.includes(stuName),
  stuName,
);

await openHikam(admin);
await tap(admin, 'nav-attendance');
await admin.getByTestId('attendance-tab-sessions').waitFor({ timeout: 10000 });
const sesCard = admin
  .locator('[data-testid^="attendance-session-"]')
  .filter({ visible: true })
  .first();
const sesName = (await sesCard.innerText()).split('\n')[0].trim();
await sesCard.click();
await admin.waitForTimeout(2500);
drill = await admin.locator('body').innerText();
check(
  'a by-session card opens THAT session',
  /ATTENDANCE/i.test(drill) && drill.includes(sesName),
  sesName,
);

// The override is in the audit trail with its reason.
await openHikam(admin);
await tap(admin, 'nav-audit');
await admin.waitForTimeout(1500);
const auditText = await admin.locator('body').innerText();
check(
  'the course audit view shows the override with its reason',
  /Overrode completion/.test(auditText) && /Attended the class live/.test(auditText),
);
await shot(admin, '18-audit');

// ---------------------------------------------------------- archive cascade --
console.log('\nArchive cascade');
const courseState = async () =>
  Object.fromEntries(
    (await readCollection('courses')).map((d) => [
      d.fields.name.stringValue,
      {
        eff: d.fields.effectiveActive.booleanValue ?? false,
        arch: d.fields.archived.booleanValue ?? false,
      },
    ]),
  );

await openHikam(admin);
await tap(admin, 'course-archive');
await admin.waitForTimeout(2500);
let s = await courseState();
check(
  'archiving one course leaves the other alone',
  s['Hikam Foundations'].eff === false && s['Arabic I'].eff === true,
  JSON.stringify(s),
);

// cohort-archive lives INSIDE the cohort now, mirroring a course: the list is a
// list, and the settings are on the thing they belong to.
await goHome(admin);
await tap(admin, 'nav-cohorts');
await tap(admin, 'cohort-open-Autumn 2026');
await tap(admin, 'cohort-archive');
await admin.waitForTimeout(3000);
s = await courseState();
check(
  'archiving the cohort deactivates every course',
  s['Hikam Foundations'].eff === false && s['Arabic I'].eff === false,
  JSON.stringify(s),
);
check(
  'the cascade does NOT write a course\'s own archived flag',
  s['Arabic I'].arch === false,
  JSON.stringify(s),
);
await shot(admin, '19-cohort-archived');

// Still on the cohort's own screen, which now reads the cohort LIVE — so the
// button has already flipped to Reactivate without a reload. Tapping the same
// testID twice is the assertion that it did.
await tap(admin, 'cohort-archive');
await admin.waitForTimeout(3000);
s = await courseState();
check(
  'reactivating restores each course to its OWN state',
  s['Arabic I'].eff === true && s['Hikam Foundations'].eff === false,
  JSON.stringify(s),
);

// ------------------------------------------------------- the student's page --
// Everything about one student in one place. The courses list is the part worth
// asserting: it is a single studentUid query for an ADMIN, which only the
// zero-read admin arm of the enrollments rule permits (a manager walks their own
// courses instead — rules.structure.test.ts owns that boundary).
console.log('\nStudent page');
await goHome(admin);
await tap(admin, 'nav-students');
await tap(admin, 'student-open-bilal@example.com');
await admin.getByTestId('student-course-open-Hikam Foundations').waitFor({ timeout: 20000 });
const stuPage = (await admin.locator('body').innerText()).toLowerCase();
check('the student page names the student and their address', stuPage.includes('bilal khan') && stuPage.includes('bilal@example.com'));
check('it lists the courses they are enrolled in', stuPage.includes('hikam foundations'));
await shot(admin, '20-student-page');

await tap(admin, 'student-course-open-Hikam Foundations');
await admin.waitForTimeout(2500);
const stuLedger = (await admin.locator('body').innerText()).toLowerCase();
check(
  'tapping a course opens THAT student\'s progress for it',
  stuLedger.includes('bilal khan') && stuLedger.includes('hikam foundations'),
);

// Disabling moves them into a section that is CLOSED, and closed means
// unmounted: the row must be unreachable until the section is expanded.
await goHome(admin);
await tap(admin, 'nav-students');
await tap(admin, 'student-open-bilal@example.com');
await tap(admin, 'student-access');
await admin.waitForTimeout(2500);
await goHome(admin);
await tap(admin, 'nav-students');
await admin.waitForTimeout(2000);
check(
  'a disabled student leaves the main list',
  (await admin.getByTestId('student-open-bilal@example.com').count()) === 0,
);
await tap(admin, 'students-disabled');
await admin.getByTestId('student-open-bilal@example.com').waitFor({ timeout: 10000 });
check('…and is found by expanding Disabled', true);
await shot(admin, '20b-students-disabled');

// Put them back, so the audit assertions below read a tidy end state.
await tap(admin, 'student-open-bilal@example.com');
await tap(admin, 'student-access');
await admin.waitForTimeout(2500);

// The MANAGER's view of the same page is a DIFFERENT query shape, and the one
// that can fail closed: they may not query a student's enrollments across
// courses, so the screen walks the courses they manage and asks about one course
// at a time. A denial here is an empty section, not an error — so assert the
// course actually appears.
await goHome(mgr);
await tap(mgr, 'nav-students');
await tap(mgr, 'student-open-fatima@example.com');
await mgr.waitForTimeout(3500);
const mgrStudent = (await mgr.locator('body').innerText()).toLowerCase();
check('a manager can open a student page', mgrStudent.includes('fatima ahmed'));
check(
  'it is scoped to the courses they manage, and says so',
  mgrStudent.includes('courses you manage') && mgrStudent.includes('hikam foundations'),
);
check(
  'the admin-only disable control is absent for them',
  (await mgr.getByTestId('student-access').count()) === 0,
);
check(
  'resending a password link is still theirs to do',
  (await mgr.getByTestId('student-resend').count()) === 1,
);
await shot(mgr, '20c-student-page-manager');

// A student in NONE of the manager's courses. Each row owns its own enrollment
// read and renders nothing when it does not match, so without an explicit empty
// state the heading stood over a blank space. Needs a student with no enrolment
// at all — one merely REMOVED from a course keeps an inactive enrolment row.
//
// This is also the ONLY place the app asks about an enrollment that does not
// exist, and the outcome check below is not enough on its own: a refused read
// and a genuine "not enrolled" both leave the row unrendered, so the empty state
// appeared either way while every non-matching course fired a permission denial
// into the banner and into Sentry. Assert the absence of the banner too.
await goHome(admin);
await tap(admin, 'nav-students');
await admin.getByTestId('student-name').fill('Zayd Noor');
await admin.getByTestId('student-email').fill('zayd@example.com');
await tap(admin, 'student-create');
await admin.getByTestId('student-open-zayd@example.com').waitFor({ timeout: 20000 });

await goHome(mgr);
await tap(mgr, 'nav-students');
await tap(mgr, 'student-open-zayd@example.com');
await mgr.waitForTimeout(3500);
const mgrNoMatch = (await mgr.locator('body').innerText()).toLowerCase();
check(
  'a student in none of their courses says so, rather than showing a bare heading',
  mgrNoMatch.includes('is not in any of the courses you manage'),
);
check(
  'and answers it without a permission denial — an absent enrollment is asked as a query, never a get',
  !mgrNoMatch.includes('live data error'),
);

// ------------------------------------------------- roster removal confirms --
// The row opens the student's progress, so the × beside it must not remove
// anyone on a single tap.
await openHikam(admin);
await tap(admin, 'roster-remove-bilal@example.com');
await admin.getByTestId('roster-remove-confirm-bilal@example.com').waitFor({ timeout: 10000 });
check('the roster × asks before removing', true);
await admin.getByText('Cancel', { exact: false }).filter({ visible: true }).first().click();
await admin.waitForTimeout(1500);
const stillEnrolled = (await readCollection('enrollments')).filter(
  (e) => e.fields.active?.booleanValue === true,
).length;
await tap(admin, 'roster-remove-bilal@example.com');
await tap(admin, 'roster-remove-confirm-bilal@example.com');
await admin.waitForTimeout(2500);
const afterRemove = (await readCollection('enrollments')).filter(
  (e) => e.fields.active?.booleanValue === true,
).length;
check(
  'cancelling keeps the enrolment, confirming ends it',
  afterRemove === stillEnrolled - 1,
  `${stillEnrolled} → ${afterRemove}`,
);

console.log('\nUp to the course');
// The header's Back arrow returns where you CAME FROM, which two screens into a
// course is the list you came through. The course name in the subtitle is the
// way to the course itself — and from a screen opened by URL there is nothing
// below it in the stack to go back to at all, so this is the only way out.
await openHikam(admin);
await tap(admin, 'nav-sessions');
await tap(admin, 'session-open-Session 1');
const sessionUrl = admin.url();
// Named per screen, not one shared id: react-navigation keeps the screen below
// mounted, so a bare `up-to-course` matches the one on Sessions as well.
await tap(admin, 'up-to-course-from-session');
await admin.waitForTimeout(2500);
const onCourse = (page) => {
  const p = new URL(page.url()).pathname;
  return /^\/courses\/[^/]+$/.test(p) ? p : `NOT the course page: ${p}`;
};
check(
  'the course name on a session leads to the course',
  onCourse(admin).startsWith('/courses/'),
  onCourse(admin),
);

// The case that has no Back at all: a session opened straight from its URL has
// nothing beneath it in the stack, so the header draws no back arrow. That is
// the whole reason this link exists rather than leaning on Back.
await admin.goto(sessionUrl, { waitUntil: 'domcontentloaded' });
await admin.waitForTimeout(3500);
await tap(admin, 'up-to-course-from-session');
await admin.waitForTimeout(2500);
check(
  '…including from a session opened cold by URL, which has no Back',
  onCourse(admin).startsWith('/courses/'),
  onCourse(admin),
);

await openHikam(admin);
await tap(admin, 'nav-attendance');
await tap(admin, 'up-to-course-from-attendance');
await admin.waitForTimeout(2500);
check('and the same from the attendance report', onCourse(admin).startsWith('/courses/'), onCourse(admin));

console.log('\nRole boundaries');
// A URL is an ADDRESS, so a signed-in student can ask for a staff screen and a
// manager for a student one. Nobody types these — a browser tab outlives the
// person signed into it, so a shared device restores the last URL under the next
// account. While one navigator held every screen, both populations got the
// other's screen fully rendered, every query beneath it denied.
//
// The rules held, so the check is not about a leak: it is that the WRONG SCREEN
// rendered at all, and that the denials underneath it are what reached Sentry.
const staffSession = (await readCollection('sessions'))[0];
const staffPath =
  `${WEB}courses/${staffSession.fields.courseId.stringValue}` +
  `/sessions/${staffSession.name.split('/').pop()}`;

await student.goto(staffPath, { waitUntil: 'domcontentloaded' });
await student.waitForTimeout(3500);
const stuOnStaffUrl = (await student.locator('body').innerText()).toLowerCase();
check(
  'a student asking for a staff URL gets their OWN home, not the staff screen',
  // The negative has to name something ONLY SessionDetailScreen renders. It was
  // "listen by" for a while, which the student's own home also prints on every
  // open task — so the check passed on the accident that this student's one
  // grant was already complete, and any open assignment added above here would
  // have failed it for a reason unrelated to routing.
  stuOnStaffUrl.includes('your listening') && !stuOnStaffUrl.includes('excused students listen by'),
);
check('…so nothing on it is denied', !stuOnStaffUrl.includes('live data error'));

await mgr.goto(`${WEB}my-classes`, { waitUntil: 'domcontentloaded' });
await mgr.waitForTimeout(3500);
const mgrOnStudentUrl = (await mgr.locator('body').innerText()).toLowerCase();
check(
  'a manager asking for a student URL gets their own home too',
  mgrOnStudentUrl.includes('recording library') && !mgrOnStudentUrl.includes('your attendance'),
);
check('…so nothing on it is denied', !mgrOnStudentUrl.includes('live data error'));

// --------------------------------------------------- the deadline closes access --
console.log('\nThe deadline');
// Reactivate Hikam first (the archive-cascade block left it off). An archived
// course refuses playback for its own reason, which would mask the one under
// test — with it active, the DUE DATE is the only thing left standing between
// the student and the audio.
await openHikam(admin);
await tap(admin, 'course-archive');
await admin.waitForTimeout(2500);

// Push Session 1's due date into the past, OUT OF BAND: no callable will write
// one, because a deadline may only become past by the passage of time. The real
// onSessionWritten trigger still fires, so the date flows down to the grants
// exactly as it would on the morning after.
const sessDoc = (await readCollection('sessions'))[0];
await patchField('sessions', sessDoc.name.split('/').pop(), 'dueDate', '2020-01-01');
await new Promise((r) => setTimeout(r, 5000));
check(
  'the past due date reaches every grant on the session',
  (await activeAssignments()).every((a) => a.fields.dueDate?.stringValue === '2020-01-01'),
);

// Fatima completed hers in time, so it must NOT be recast as missed. Completion
// is checked before the deadline — telling someone who did the work that they
// missed it would be both wrong and the tone the brief rules out.
await goHome(student);
await student.getByTestId('task-Session 1').waitFor({ timeout: 20000 });
const doneHome = await student.locator('body').innerText();
// Case-insensitive: innerText returns RENDERED text, and the group label is
// uppercased by CSS — so /Missed/ would silently never match and this would pass
// for the wrong reason.
check(
  'a completed recording is never recast as missed, however far past due',
  /completed/i.test(doneHome) && !/missed/i.test(doneHome),
  doneHome.replace(/\n+/g, ' | ').slice(0, 200),
);

// THE BOUNDARY IS THE SERVER, not a hidden button — asserted against the real
// callable rather than through the UI, because the screen now refuses first and
// would hide a server that had quietly stopped checking.
const recId = (await readCollection('recordings'))[0].name.split('/').pop();
const stuToken = await (
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'fatima@example.com',
      password: 'StudentPass123!',
      returnSecureToken: true,
    }),
  })
).json();
const mint = await fetch(`${FN}/getPlaybackUrl`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${stuToken.idToken}` },
  body: JSON.stringify({ data: { recordingId: recId } }),
});
const mintBody = await mint.text();
check(
  'getPlaybackUrl REFUSES a recording whose due date has passed',
  mint.status >= 400 && /due date/i.test(mintBody),
  `${mint.status} ${mintBody.slice(0, 160)}`,
);

// And the screen says so too, without drawing a transport nobody can use.
await tap(student, 'task-Session 1');
await sawText(student, 'This recording closed on 2020-01-01', 30000);
check(
  'the player states the closure and offers no transport',
  (await student.getByTestId('player-play').count()) === 0,
);
await shot(student, '24-past-due-player');

// Unmark it out of band, so the same grant is now incomplete AND past its
// deadline — the completion control is behind the closed gate, deliberately.
await patchField('completions', `${stuToken.localId}_${recId}`, 'completed', false, 'booleanValue');
await goHome(student);
await student.getByTestId('task-Session 1').waitFor({ timeout: 20000 });
const missedHome = await student.locator('body').innerText();
check(
  'a grant past its due date reads as Missed, with the date it closed',
  /missed/i.test(missedHome) && /Closed 2020-01-01/.test(missedHome),
  missedHome.replace(/\n+/g, ' | ').slice(0, 220),
);
// Not a button: the server would refuse anyway, and a card that looks tappable
// and then errors reads as a fault in the app rather than a deadline missed.
check(
  'a missed card is not offered as something to play',
  (await student.getByRole('button', { name: 'Listen to Session 1' }).count()) === 0,
);
await shot(student, '25-missed');

// ------------------------------------------------------------ notifications --
console.log('\nNotifications');
// The FIRST document either population may write. `students` and `staffUsers`
// refuse self-writes because role and status ARE the security model there, so
// this is the one place the rules have to let a client through — worth driving
// end to end rather than trusting the rules test alone.
await goHome(student);
await tap(student, 'nav-notifications');
await student.getByTestId('notify-lastDay').waitFor({ timeout: 20000 });
const notifyText = await student.locator('body').innerText();
check(
  'a student sees their own two switches and not the staff one',
  /A recording is ready for me/.test(notifyText) &&
    /Last day to listen/.test(notifyText) &&
    !/Attendance still not taken/.test(notifyText),
);
check(
  'every switch starts ON — an absent document means nothing is turned off',
  (await student.getByTestId('notify-lastDay').getAttribute('aria-checked')) === 'true',
);

await tap(student, 'notify-lastDay');
await student.waitForTimeout(1500);
const prefs = await readCollection('notifications');
check(
  'turning one off writes it, and leaves the other alone',
  prefs.length === 1 &&
    prefs[0].fields.lastDay?.booleanValue === false &&
    prefs[0].fields.recordingReady === undefined,
  JSON.stringify(prefs[0]?.fields ?? {}),
);
check(
  'the switch reflects it without a reload',
  (await student.getByTestId('notify-lastDay').getAttribute('aria-checked')) === 'false',
);
await shot(student, '26-notifications');

await goHome(mgr);
await tap(mgr, 'nav-notifications');
await mgr.getByTestId('notify-attendanceMissing').waitFor({ timeout: 20000 });
const mgrNotify = await mgr.locator('body').innerText();
check(
  'staff see the attendance reminder and not the student switches',
  /Attendance still not taken/.test(mgrNotify) && !/Last day to listen/.test(mgrNotify),
);

// -------------------------------------------------------------------- audit --
// The auditedCall wrapper writes one entry per staff mutation — this whole run
// has performed many, through the real functions emulator. Assert the log is
// populated and correctly attributed (comprehensiveness by construction).
console.log('\nAudit log');
const audit = await readCollection('auditLog');
const actions = new Set(audit.map((e) => e.fields.action?.stringValue));
check(
  'the audit log captured the staff mutations that happened',
  ['createCohort', 'createCourse', 'createStudent', 'createSession', 'submitAttendance', 'setRecordingStatus'].every(
    (a) => actions.has(a),
  ),
  [...actions].sort().join(', '),
);
const publish = audit.find(
  (e) =>
    e.fields.action?.stringValue === 'setRecordingStatus' &&
    e.fields.detail?.mapValue?.fields?.status?.stringValue === 'published',
);
check(
  'a course-scoped entry (publish) carries its courseId + actor + detail',
  !!publish &&
    !!publish.fields.courseId?.stringValue &&
    !!publish.fields.actorUid?.stringValue &&
    publish.fields.actorRole?.stringValue === 'admin',
);
const cohortEntry = audit.find((e) => e.fields.action?.stringValue === 'createCohort');
check(
  'a cohort-level entry is course-less (null courseId → admin-only)',
  !!cohortEntry && cohortEntry.fields.courseId?.nullValue !== undefined,
);

console.log('\nLive data');
check(
  'not one live subscription was refused in the entire walkthrough',
  listenerDenials.length === 0,
  [...new Set(listenerDenials)].join(' | '),
);

// ------------------------------------------------------------------ result --
await browser.close();
console.log(`\nconsole errors: ${consoleErrors.length ? consoleErrors.slice(0, 5).join(' | ') : 'none'}`);
console.log(`screenshots in ${SHOTS}/ — look at them`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
