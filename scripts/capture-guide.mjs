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
import { EMULATOR_PROJECT_ID } from './lib/project.mjs';

const WEB = `http://127.0.0.1:${WEB_PORTS.e2e}/`;
const FN = `http://127.0.0.1:${EMULATOR_PORTS.functions}/${EMULATOR_PROJECT_ID}/us-central1`;
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

/**
 * How far down to cut a capture, when something below that point must not ship.
 *
 * The sign-in screen carries the emulator dev-sign-in panel ("as faisal.shah
 * (first admin)", "as manager", "as outsider (gets deleted)"), because these
 * shots are taken against a DEV server — that panel is what every suite here
 * uses to reach an authenticated screen at all. It is also the first figure in
 * a manual written for institute staff, so it cannot appear in it. Cutting
 * above the panel is honest: everything the reader is shown is real, there is
 * simply less of it.
 */
async function heightAbove(p, testId) {
  const box = await p.getByTestId(testId).boundingBox().catch(() => null);
  if (!box) return null;
  // Back up past the panel's own dashed border and the gap above it.
  return Math.max(200, Math.round(box.y - 40));
}

/**
 * How tall the viewport must be to show the whole screen.
 *
 * `fullPage: true` IS A NO-OP HERE, and that is not obvious. It grows the
 * capture to the DOCUMENT height, and react-native-web pins its root to the
 * viewport — the page never scrolls, an inner ScrollView does. So every figure
 * was silently the top 900px of its screen, which sliced "Submit attendance" in
 * half in the session figure. Measuring the scroller and growing the viewport to
 * it is what actually captures the screen.
 */
async function contentHeight(p, fallback) {
  const h = await p.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((el) => {
      const cs = getComputedStyle(el);
      return /auto|scroll/.test(cs.overflowY) && el.scrollHeight > el.clientHeight;
    });
    if (!scrollers.length) return 0;
    scrollers.sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
    const el = scrollers[0];
    // The chrome outside the scroller — header, tab bar, now-playing strip.
    return Math.ceil(el.scrollHeight + (window.innerHeight - el.clientHeight));
  });
  // Capped: a fourteen-student roster at full length is a figure nobody reads,
  // and a 6000px PNG in a PDF is worse than a scrolled one.
  return Math.min(Math.max(h || fallback, fallback), 2400);
}

/**
 * `prepare` runs again at EACH size. Anything transient — an open editor, an
 * expanded section — closes when the viewport changes, so a figure of one has to
 * be re-opened rather than captured once and resized around.
 */
async function pair(p, name, { cutAbove = null, prepare = null } = {}) {
  for (const [size, suffix] of [[PHONE, 'phone'], [DESKTOP, 'desktop']]) {
    await p.setViewportSize(size);
    await p.waitForTimeout(size === PHONE ? 500 : 700);
    if (prepare) {
      await prepare(p);
      await p.waitForTimeout(600);
    }
    const cut = cutAbove ? await heightAbove(p, cutAbove) : null;
    const height = cut ?? (await contentHeight(p, size.height));
    await p.setViewportSize({ width: size.width, height });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${DIR}/${name}-${suffix}.png` });
  }
  await p.setViewportSize(PHONE); await p.waitForTimeout(300);
  console.log('  ✓', name);
}

/** Open one of the rows behind "More" — the audit history lives there. */
async function more(p, option) {
  await tap(p, 'tab-more'); await p.waitForTimeout(600);
  await tap(p, option);
}

// Admin: Courses → Autumn 2026 → Hikam Foundations, from home.
async function openHikam(p) {
  await home(p);
  await tap(p, 'tab-courses'); await p.waitForTimeout(2000);
  await tap(p, 'cohort-open-Autumn 2026'); await p.waitForTimeout(2000);
  await tap(p, 'course-open-Hikam Foundations');
  await p.getByTestId('nav-sessions').waitFor({ timeout: 15000 });
}

console.log('Student');
const stu = await newPage(PHONE);
await stu.getByTestId('signin-email').waitFor({ timeout: 30000 });
await pair(stu, '01-signin', { cutAbove: 'dev-signin-first-admin' });
await stu.getByTestId('signin-email').fill('fatima.ahmed@example.com');
await stu.getByTestId('signin-password').fill('HikamStudent1');
await tap(stu, 'signin-student');
await sawText(stu, 'Your listening', 25000);
await pair(stu, '02-student-home');
// The hero card: the home screen promotes the most urgent recording still open
// and drops it from the grouped list, so this is the handle it has.
await tap(stu, 'next-up-Session 3 — Patience in Hardship');
await stu.getByTestId('player-play').waitFor({ timeout: 25000 });
await tap(stu, 'player-play');
await stu.waitForTimeout(2500);
await pair(stu, '03-player');
await home(stu);
await sawText(stu, 'Your listening', 15000);
await tap(stu, 'tab-classes');
await stu.getByTestId('myclass-Hikam Foundations').waitFor({ timeout: 20000 });
await tap(stu, 'myclass-Hikam Foundations');
await stu.waitForTimeout(3000);
await pair(stu, '04-attendance-record');
await stu.context().close();

console.log('Admin / staff');
const adm = await newPage(PHONE);
await tap(adm, 'dev-signin-first-admin');
await fetch(`${FN}/bootstrapAdmin`).catch(() => {});
await adm.getByTestId('tab-today').waitFor({ timeout: 30000 });
await adm.waitForTimeout(2500);
await pair(adm, '10-staff-home');

await tap(adm, 'tab-people'); await adm.waitForTimeout(3000);
// Open the Disabled section so the list is photographed showing both parts —
// a closed collapsible documents nothing about what is inside it.
await tap(adm, 'students-disabled'); await adm.waitForTimeout(800);
await pair(adm, '11-students');

// One student's page: access, and the courses they are in.
await tap(adm, 'student-open-fatima.ahmed@example.com'); await adm.waitForTimeout(3000);
await pair(adm, '11b-student-page');

await home(adm);
await tap(adm, 'tab-people'); await adm.waitForTimeout(1500);
await tap(adm, 'segment-staff'); await adm.waitForTimeout(1200);
await pair(adm, '12-staff-approvals');

await home(adm);
await tap(adm, 'tab-courses'); await adm.waitForTimeout(3000);
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
// Re-opened at EACH size: changing the viewport closes the editor, so capturing
// once and resizing around it produced a "form" figure with no form in it.
if (await adm.locator('[data-testid^="override-open-"]').first().count()) {
  await pair(adm, '19-override-form', {
    prepare: async (p) => {
      // Only if none is open. `prepare` runs once per size, and the editor
      // survives the phone shot — so clicking blindly opened a SECOND one at
      // desktop width, and the figure showed two half-filled forms.
      if (await p.locator('[data-testid^="override-reason-"]').count()) return;
      const btn = p.locator('[data-testid^="override-open-"]').first();
      if (await btn.count()) await btn.click();
    },
  });
}

// Attendance report (toggle: by session / by student).
await openHikam(adm);
await tap(adm, 'nav-attendance'); await adm.waitForTimeout(2000);
await pair(adm, '20-attendance-report');

await home(adm);
await tap(adm, 'tab-library'); await adm.waitForTimeout(3000);
await pair(adm, '21-library');

await home(adm);
await more(adm, 'more-audit'); await adm.waitForTimeout(1500);
await pair(adm, '22-audit');
await adm.context().close();

await browser.close();
console.log('done — screenshots in', DIR);
