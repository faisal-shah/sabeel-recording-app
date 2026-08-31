#!/usr/bin/env node
/**
 * SCREENSHOTS FOR THE NAVIGATION DESIGN REVIEW.
 *
 *   bash scripts/capture-design.sh
 *
 * Three competing designs (`app/src/design/variant.ts`), three populations, two
 * widths each — a phone and a laptop — against the one seeded world in
 * `lib/seed-world.mjs`. The output feeds `docs/design/NAV-PROPOSALS.html`.
 *
 * NOT A TEST. It asserts nothing and it must never be mistaken for the sweep:
 * `screens-e2e.mjs` is what proves a layout is not broken, and this only
 * photographs one. It exists because a design argument made in prose about
 * screens nobody has looked at is worth very little, and because the difference
 * between three navigation models is mostly invisible until you see the same
 * screen under each.
 *
 * The designs are selected by `?nav=a|b|c`, read once at module load in the
 * client. One dev server therefore serves all three, and — more to the point —
 * all three run against IDENTICAL DATA, which is the only way the comparison
 * means anything.
 */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
import { EMULATOR_PORTS, WEB_PORTS } from './lib/ports.mjs';
import { EMULATOR_PROJECT_ID, EMULATOR_STORAGE_BUCKET } from './lib/project.mjs';
import { byId, resetEmulators, seedWorld, tap } from './lib/seed-world.mjs';

const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${WEB_PORTS.sweep}/`;
const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = resolve(ROOT, 'shots', 'design');

process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${EMULATOR_PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${EMULATOR_PORTS.auth}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= `127.0.0.1:${EMULATOR_PORTS.storage}`;
process.env.GCLOUD_PROJECT = EMULATOR_PROJECT_ID;

admin.initializeApp({ projectId: EMULATOR_PROJECT_ID, storageBucket: EMULATOR_STORAGE_BUCKET });
const db = admin.firestore();
const auth = admin.auth();

await resetEmulators();
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const world = await seedWorld({ db, auth, browser, base: BASE });

/**
 * Phone and laptop. Two, not five: the sweep's job is to find the width where a
 * layout breaks, and this one's is to show what the design looks like at the
 * two sizes anybody will actually hold it at.
 */
const VIEWPORTS = [
  ['narrow', { width: 390, height: 844 }],
  ['wide', { width: 1440, height: 900 }],
];

const VARIANTS = ['a', 'b', 'c'];

let taken = 0;
async function shot(page, variant, who, view, name) {
  // Settle: react-native-web lays out after paint, and a screenshot taken in
  // between catches a half-measured column.
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(SHOTS, `${variant}-${who}-${view}-${name}.png`),
    fullPage: true,
  });
  taken += 1;
  process.stdout.write('.');
}

/** Back to the tab root before the next screen, so no tour depends on the last. */
async function home(page) {
  await page.goto(`${BASE}?nav=${page.__variant}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
}

async function signInStaff(page, testId, marker) {
  await page.goto(`${BASE}?nav=${page.__variant}`, { waitUntil: 'domcontentloaded' });
  await tap(byId(page, testId), 60_000);
  await byId(page, marker).waitFor({ timeout: 60_000 });
}

async function signInStudent(page) {
  await page.goto(`${BASE}?nav=${page.__variant}`, { waitUntil: 'domcontentloaded' });
  await byId(page, 'signin-email').fill(world.STUDENT.email);
  await byId(page, 'signin-password').fill(world.STUDENT_PASSWORD);
  await tap(byId(page, 'signin-student'));
  await byId(page, 'tab-listening').waitFor({ timeout: 60_000 });
}

async function tourStudent(page, variant, view) {
  await shot(page, variant, 'student', view, '1-listening');

  // Design B promotes the most urgent OPEN recording to a hero card and drops it
  // from the grouped list below, so the same recording has two possible handles
  // depending on the design. Try the hero first.
  const hero = byId(page, `next-up-${world.dueSoon.title}`);
  await tap((await hero.count()) ? hero : byId(page, `task-${world.dueSoon.title}`));
  await page.waitForTimeout(2500); // let the signed URL mint and the media load
  await shot(page, variant, 'student', view, '2-player');

  // Leave the player WHILE IT IS LOADED — the whole point of the docked bar.
  await tap(byId(page, 'tab-classes'));
  await page.waitForTimeout(900);
  await shot(page, variant, 'student', view, '3-classes-miniplayer');

  await tap(byId(page, 'myclass-Hikam Foundations'));
  await page.waitForTimeout(900);
  await shot(page, variant, 'student', view, '4-attendance');

  await home(page);
  await tap(byId(page, 'tab-more'));
  await page.waitForTimeout(500);
  await shot(page, variant, 'student', view, '5-more');
}

async function tourStaff(page, variant, view, who) {
  await shot(page, variant, who, view, '1-home');

  // The course spine, however this design reaches it.
  if (variant === 'b') {
    await tap(byId(page, 'tab-courses'));
    await page.waitForTimeout(900);
    await shot(page, variant, who, view, '2-courses');
  }

  if (who === 'admin') {
    const cohort = byId(page, 'cohort-open-Autumn 2026');
    if (await cohort.count()) {
      await tap(cohort);
      await page.waitForTimeout(800);
      await shot(page, variant, who, view, '3-cohort');
    }
  }

  const course = byId(page, 'course-open-Hikam Foundations');
  if (await course.count()) {
    await tap(course);
    await page.waitForTimeout(900);
    await shot(page, variant, who, view, '4-course');
  }

  const sessions = byId(page, 'nav-sessions');
  if (await sessions.count()) {
    await tap(sessions);
    await page.waitForTimeout(900);
    await shot(page, variant, who, view, '5-sessions');
    const session = byId(page, `session-open-${world.dueSoon.title}`);
    if (await session.count()) {
      await tap(session);
      await page.waitForTimeout(900);
      await shot(page, variant, who, view, '6-session');
    }
  }

  await home(page);
  await tap(byId(page, 'tab-library'));
  await page.waitForTimeout(1200);
  await shot(page, variant, who, view, '7-library');

  await home(page);
  await tap(byId(page, 'tab-people'));
  await page.waitForTimeout(1200);
  await shot(page, variant, who, view, '8-people');

  await home(page);
  await tap(byId(page, 'tab-more'));
  await page.waitForTimeout(600);
  await shot(page, variant, who, view, '9-more');
}

const TOURS = [
  ['admin', (p) => signInStaff(p, 'dev-signin-first-admin', 'tab-library'), tourStaff],
  ['manager', (p) => signInStaff(p, 'dev-signin-manager', 'tab-library'), tourStaff],
  ['student', signInStudent, tourStudent],
];

for (const variant of VARIANTS) {
  for (const [viewName, viewport] of VIEWPORTS) {
    for (const [who, signIn, tour] of TOURS) {
      const ctx = await browser.newContext({ viewport });
      const page = await ctx.newPage();
      page.__variant = variant;
      page.on('console', (m) => {
        if (m.type() === 'error') console.log(`\n  console: ${m.text().slice(0, 160)}`);
      });
      process.stdout.write(`\n${variant} ${who} ${viewName} `);
      try {
        await signIn(page);
        await tour(page, variant, viewName, who);
      } catch (e) {
        console.log(`\n  !! ${variant}/${who}/${viewName}: ${e.message.split('\n')[0]}`);
        await page.screenshot({
          path: join(SHOTS, `FAILED-${variant}-${who}-${viewName}.png`),
          fullPage: true,
        });
      }
      await ctx.close();
    }
  }
}

await browser.close();
console.log(`\n\n${taken} screenshots in ${SHOTS}`);
