/**
 * Capture user-manual screenshots from the WEB app — every screen at phone
 * (390) and desktop (1280) width. Against the emulator with the guide dataset.
 * Home is a RELOAD (goto), not goBack — the nav stack is not browser history.
 */
import { chromium } from 'playwright';

const WEB = 'http://127.0.0.1:8083/';
const FN = 'http://127.0.0.1:5001/demo-sabeel/us-central1';
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
await tap(stu, 'nav-myrecordings');
await stu.waitForTimeout(3000);
await pair(stu, '04-browse-all');
await stu.context().close();

console.log('Admin / staff');
const adm = await newPage(PHONE);
await tap(adm, 'dev-signin-first-admin');
await fetch(`${FN}/bootstrapAdmin`).catch(() => {});
await adm.getByTestId('nav-cohorts').waitFor({ timeout: 30000 });
await pair(adm, '10-staff-home');

await tap(adm, 'nav-students'); await adm.waitForTimeout(3000);
await pair(adm, '11-students');

await home(adm);
await tap(adm, 'nav-staff'); await adm.waitForTimeout(1200);
await pair(adm, '12-staff-approvals');

await home(adm);
await tap(adm, 'nav-cohorts'); await adm.waitForTimeout(3000);
await pair(adm, '13-cohorts');
await tap(adm, 'cohort-open-Autumn 2026'); await adm.waitForTimeout(3000);
await pair(adm, '14-classes');
await tap(adm, 'class-open-Hikam Foundations');
await adm.getByTestId('nav-recordings').waitFor({ timeout: 15000 });
await pair(adm, '15-class-detail');
await tap(adm, 'nav-recordings'); await adm.waitForTimeout(3000);
await pair(adm, '16-recordings');
await tap(adm, 'recording-ledger-Session 1 — Introduction to the Hikam');
await adm.getByTestId('ledger-filter-all').waitFor({ timeout: 15000 });
await tap(adm, 'ledger-filter-all'); await adm.waitForTimeout(800);
await pair(adm, '17-recording-ledger');
await tap(adm, 'ledger-filter-notComplete'); await adm.waitForTimeout(600);
const ovBtn = adm.locator('[data-testid^="override-open-"]').first();
if (await ovBtn.count()) { await ovBtn.click(); await adm.waitForTimeout(700); await pair(adm, '18-override-form'); }

await home(adm);
await tap(adm, 'nav-library'); await adm.waitForTimeout(3000);
await pair(adm, '19-library');

await home(adm);
await tap(adm, 'nav-audit-global'); await adm.waitForTimeout(1500);
await pair(adm, '20-audit');
await adm.context().close();

await browser.close();
console.log('done — screenshots in', DIR);
