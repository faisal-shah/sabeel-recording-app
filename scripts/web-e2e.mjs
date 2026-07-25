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
 * (present/absent/excused); absent∪excused are assigned the recording once it is
 * published AND attendance has been submitted. There is no "catch-up" concept —
 * accountability is attendance-driven, and a student enrolled after a session's
 * attendance snapshot is simply never assigned it (enrollment-onward).
 *
 * Prerequisites (see docs/DEV-TOOLING.md):
 *   firebase emulators:start --project demo-sabeel --only firestore,auth,storage,functions
 *   cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --web --port 8083 --clear
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
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const WEB = process.env.E2E_WEB ?? 'http://127.0.0.1:8083/';
const FN = 'http://127.0.0.1:5001/demo-sabeel/us-central1';
const FS_READ = 'http://127.0.0.1:8080/v1/projects/demo-sabeel/databases/(default)/documents';
const FS_WIPE = 'http://127.0.0.1:8080/emulator/v1/projects/demo-sabeel/databases/(default)/documents';
const AUTH = 'http://127.0.0.1:9099';
const SHOTS = 'e2e-shots';
const AUDIO_FIXTURE = process.env.E2E_AUDIO ?? 'e2e-shots/test-lecture.m4a';

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
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=720,volume=0.3',
      '-c:a', 'aac', '-b:a', '32k', '-ac', '1', AUDIO_FIXTURE, '-y',
    ], { stdio: 'ignore' });
  } catch {
    throw new Error(
      `Could not generate ${AUDIO_FIXTURE}. Install ffmpeg, or point E2E_AUDIO at an audio file.`,
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

const browser = await chromium.launch();
const consoleErrors = [];

async function newSession() {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  return page;
}

/** Tap by testID. Text locators are unreliable here: react-navigation keeps the
 *  previous screen mounted, so a text match can resolve to a hidden node. */
async function tap(page, testId, timeout = 20000) {
  const el = page.getByTestId(testId);
  await el.waitFor({ timeout });
  await el.click();
}

const sawText = (page, text, timeout = 20000) =>
  page.getByText(text, { exact: false }).first().waitFor({ timeout });

/** Home is a reload, not goBack(): the navigation stack is not browser history. */
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
await outsider.waitForTimeout(6000);
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

// Scope ONE course to the manager.
await tap(admin, 'course-open-Hikam Foundations');
await tap(admin, 'course-manager-manager@oursabeel.com');
await admin.waitForTimeout(2500);
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

// Take attendance: mark the enrolled student ABSENT (so the recording becomes
// required listening for her) and submit. Nobody is assigned yet — there is no
// published recording.
await admin.getByTestId('att-Fatima Ahmed-absent').waitFor({ timeout: 15000 });
await tap(admin, 'att-Fatima Ahmed-absent');
await tap(admin, 'att-submit');
await admin.waitForTimeout(2000);
check(
  'submitting attendance before a recording exists assigns nobody',
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
check(
  'duration and size are recorded from the real file',
  rf.durationSec?.integerValue === '720' && rf.sizeBytes?.integerValue === '3049585',
  `duration=${rf.durationSec?.integerValue} size=${rf.sizeBytes?.integerValue}`,
);
check('the recording is linked to its session', !!rf.sessionId?.stringValue);

// Publish it. The publish fan-out TRIGGER now sees a published recording AND a
// submitted attendance, so it assigns the absent student. This is the one place
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
  'publishing fans out an assignment to the ABSENT student (real trigger)',
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

// To make the late student accountable, staff re-take attendance for the session
// and mark them absent. Re-submitting reconciles via onSessionWritten, assigning
// them the already-published recording — without disturbing Fatima's completion.
await openHikam(admin);
await tap(admin, 'nav-sessions');
await tap(admin, 'session-open-Session 1');
await admin.getByTestId('att-Bilal Khan-absent').waitFor({ timeout: 15000 });
await tap(admin, 'att-Bilal Khan-absent');
await tap(admin, 'att-submit');
let afterResubmit = [];
for (let i = 0; i < 20 && afterResubmit.length < 2; i++) {
  await admin.waitForTimeout(500);
  afterResubmit = await activeAssignments();
}
check(
  're-submitting attendance with the late student absent assigns them (onSessionWritten)',
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
const stuCard = admin.locator('[data-testid^="attendance-student-"]').first();
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
const sesCard = admin.locator('[data-testid^="attendance-session-"]').first();
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

// cohort-archive lives on the Cohorts LIST screen, not inside the cohort.
await goHome(admin);
await tap(admin, 'nav-cohorts');
await tap(admin, 'cohort-archive-Autumn 2026');
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

await tap(admin, 'cohort-archive-Autumn 2026');
await admin.waitForTimeout(3000);
s = await courseState();
check(
  'reactivating restores each course to its OWN state',
  s['Arabic I'].eff === true && s['Hikam Foundations'].eff === false,
  JSON.stringify(s),
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

// ------------------------------------------------------------------ result --
await browser.close();
console.log(`\nconsole errors: ${consoleErrors.length ? consoleErrors.slice(0, 5).join(' | ') : 'none'}`);
console.log(`screenshots in ${SHOTS}/ — look at them`);
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
