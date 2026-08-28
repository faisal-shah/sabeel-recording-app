/**
 * Capture user-manual screenshots from the WEB app — every screen at phone
 * (390) and desktop (1280) width. Against the emulator with the guide dataset
 * (scripts/seed-guide.mjs). Home is a goto of `/`, which is the Home path — the
 * stack is browser history now, so goBack() would work too.
 *
 * Model: Cohort → Course → Session → Recording. Recordings and attendance live
 * on a session; being marked EXCUSED is what opens a recording to a student and
 * requires them to listen, until the session's Listen by date.
 */
import { chromium } from 'playwright';
import { EMULATOR_PORTS, WEB_PORTS } from './lib/ports.mjs';

const WEB = `http://127.0.0.1:${WEB_PORTS.e2e}/`;
const FN = `http://127.0.0.1:${EMULATOR_PORTS.functions}/demo-sabeel/us-central1`;
const DIR = 'docs/manual/img';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const browser = await chromium.launch();

async function newPage(vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(WEB, { waitUntil: 'networkidle' });
  return p;
}
const tap = (p, id) => p.getByTestId(id).click();
const sawText = (p, t, to = 20000) => p.getByText(t, { exact: false }).first().waitFor({ timeout: to });
const home = async (p) => { await p.goto(WEB, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500); };

async function pair(p, name, { viewportOnly = false } = {}) {
  await p.setViewportSize(PHONE); await p.waitForTimeout(500);
  await p.screenshot({ path: `${DIR}/${name}-phone.png`, fullPage: !viewportOnly });
  await p.setViewportSize(DESKTOP); await p.waitForTimeout(700);
  await p.screenshot({ path: `${DIR}/${name}-desktop.png`, fullPage: !viewportOnly });
  await p.setViewportSize(PHONE); await p.waitForTimeout(300);
  console.log('  ✓', name);
}

// Admin: Cohorts → Autumn 2026 → Hikam Foundations, from home.
async function openHikam(p) {
  await home(p);
  await tap(p, 'nav-cohorts'); await p.waitForTimeout(2000);
  await tap(p, 'cohort-open-Autumn 2026'); await p.waitForTimeout(2000);
  await tap(p, 'course-open-Hikam Foundations');
  await p.getByTestId('nav-sessions').waitFor({ timeout: 15000 });
}

console.log('Student');
const stu = await newPage(PHONE);
await stu.getByTestId('signin-email').waitFor({ timeout: 30000 });
await pair(stu, '01-signin', { viewportOnly: true });
await stu.getByTestId('signin-email').fill('fatima.ahmed@example.com');
await stu.getByTestId('signin-password').fill('HikamStudent1');
await tap(stu, 'signin-student');
await sawText(stu, 'Your listening', 25000);
await pair(stu, '02-student-home');
await tap(stu, 'task-Session 3 — Patience in Hardship');
await stu.getByTestId('player-play').waitFor({ timeout: 25000 });
await tap(stu, 'player-play');
await stu.waitForTimeout(2500);
await pair(stu, '03-player');
await home(stu);
await sawText(stu, 'Your listening', 15000);
await tap(stu, 'student-classes');
await stu.getByTestId('myclass-Hikam Foundations').waitFor({ timeout: 20000 });
await tap(stu, 'myclass-Hikam Foundations');
await stu.waitForTimeout(3000);
await pair(stu, '04-attendance-record');
await stu.context().close();

console.log('Admin / staff');
const adm = await newPage(PHONE);
await tap(adm, 'dev-signin-first-admin');
await fetch(`${FN}/bootstrapAdmin`).catch(() => {});
await adm.getByTestId('nav-cohorts').waitFor({ timeout: 30000 });
await pair(adm, '10-staff-home');

await tap(adm, 'nav-students'); await adm.waitForTimeout(3000);
// Open the Disabled section so the list is photographed showing both parts —
// a closed collapsible documents nothing about what is inside it.
await tap(adm, 'students-disabled'); await adm.waitForTimeout(800);
await pair(adm, '11-students');

// One student's page: access, and the courses they are in.
await tap(adm, 'student-open-fatima.ahmed@example.com'); await adm.waitForTimeout(3000);
await pair(adm, '11b-student-page');

await home(adm);
await tap(adm, 'nav-staff'); await adm.waitForTimeout(1200);
await pair(adm, '12-staff-approvals');

await home(adm);
await tap(adm, 'nav-cohorts'); await adm.waitForTimeout(3000);
await tap(adm, 'cohorts-archived'); await adm.waitForTimeout(800);
await pair(adm, '13-cohorts');
// The cohort's own page — its settings (archiving lives here now) and courses.
await tap(adm, 'cohort-open-Autumn 2026'); await adm.waitForTimeout(3000);
await pair(adm, '14-courses');
await tap(adm, 'course-open-Hikam Foundations');
await adm.getByTestId('nav-sessions').waitFor({ timeout: 15000 });
await pair(adm, '15-course-detail');

await tap(adm, 'nav-sessions'); await adm.waitForTimeout(2500);
await pair(adm, '16-sessions');

// Session 3 — attendance taken (roster shown) + a published recording.
await tap(adm, 'session-open-Session 3 — Patience in Hardship');
await adm.getByTestId('recording-ledger').waitFor({ timeout: 15000 });
await adm.waitForTimeout(800);
await pair(adm, '17-session-detail');

// Its ledger — the accountable/attendees split.
await tap(adm, 'recording-ledger');
await adm.getByTestId('ledger-filter-all').waitFor({ timeout: 15000 });
await tap(adm, 'ledger-filter-all'); await adm.waitForTimeout(800);
await pair(adm, '18-recording-ledger');

// Override form on the first not-complete accountable student.
await tap(adm, 'ledger-filter-notComplete'); await adm.waitForTimeout(600);
const ovBtn = adm.locator('[data-testid^="override-open-"]').first();
if (await ovBtn.count()) { await ovBtn.click(); await adm.waitForTimeout(700); await pair(adm, '19-override-form'); }

// Attendance report (toggle: by session / by student).
await openHikam(adm);
await tap(adm, 'nav-attendance'); await adm.waitForTimeout(2000);
await pair(adm, '20-attendance-report');

await home(adm);
await tap(adm, 'nav-library'); await adm.waitForTimeout(3000);
await pair(adm, '21-library');

await home(adm);
await tap(adm, 'nav-audit-global'); await adm.waitForTimeout(1500);
await pair(adm, '22-audit');
await adm.context().close();

await browser.close();
console.log('done — screenshots in', DIR);
