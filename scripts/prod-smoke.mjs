/**
 * Smoke checks against the DEPLOYED site. Run after every hosting deploy:
 *
 *     npm run smoke:prod
 *
 * These are the things the emulator suite structurally cannot tell you, because
 * every one of them is about the production bundle and the real project:
 * whether Hosting serves the auth handler, whether the shipped bundle talks to
 * production rather than an emulator, and whether dev-only UI leaked into it.
 *
 * Deliberately unauthenticated — it stops at the sign-in screen. Signing in
 * needs a real Google account, so anything past that is a human step. This is a
 * DEPLOY check, not a security suite; rules are covered by the emulator tests.
 */
import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE ?? 'https://sabeel-class-recordings.web.app';
const PROJECT_ID = 'sabeel-class-recordings';

const fails = [];
function check(condition, message) {
  if (condition) {
    console.log('  ok   ' + message);
  } else {
    fails.push(message);
    console.log('  FAIL ' + message);
  }
}

// Hosting must serve /__/auth/* itself. That is the entire reason authDomain
// points at the hosting domain: it keeps the sign-in redirect same-origin, which
// storage-partitioned in-app webviews require.
const handler = await fetch(`${BASE}/__/auth/handler`);
check(handler.ok, `/__/auth/handler -> ${handler.status}`);

const init = await (await fetch(`${BASE}/__/firebase/init.json`)).json();
check(init.projectId === PROJECT_ID, `init.json projectId ${init.projectId}`);

const browser = await chromium.launch();
const page = await browser.newPage();

const errors = [];
const hosts = new Set();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => {
  try {
    hosts.add(new URL(r.url()).host);
  } catch {
    // Non-http requests (data:, blob:) are not interesting here.
  }
});

await page.goto(BASE, { waitUntil: 'networkidle' });
const body = await page.locator('body').innerText();

// A bundle that fails to boot renders a blank white page, and every check below
// would pass vacuously against it.
const rendered = /sign in/i.test(body);
check(rendered, `sign-in screen rendered${rendered ? '' : ` (body: ${body.slice(0, 120)})`}`);

// The check this script exists for. A production bundle built with the emulator
// flag still set looks completely normal until someone tries to sign in.
const localHosts = [...hosts].filter((h) => /127\.0\.0\.1|localhost|10\.0\.2\.2/.test(h));
check(
  localHosts.length === 0,
  `no emulator hosts contacted${localHosts.length ? `: ${localHosts.join(', ')}` : ''}`,
);

// Grepping the bundle for this proves nothing — strings survive minification.
// It has to be shown not to RENDER.
const devRows = await page.getByTestId('dev-signin').count();
check(devRows === 0, 'dev sign-in row absent');

const googleButtons = await page.getByRole('button', { name: /google/i }).count();
check(googleButtons > 0, 'Google (staff) sign-in offered');

check(
  errors.length === 0,
  `no console errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`,
);

await page.screenshot({ path: 'e2e-shots/prod-01-signin.png', fullPage: true });
await browser.close();

console.log(fails.length ? `\n${fails.length} check(s) FAILED` : '\nall production checks passed');
process.exit(fails.length ? 1 : 0);
