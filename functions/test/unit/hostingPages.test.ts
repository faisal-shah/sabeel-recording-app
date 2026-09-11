import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIVACY_URL } from '@sabeel/shared';

/**
 * The three pages a store reviewer reads, and the two ways they break silently.
 *
 * `npm run smoke:prod` is what actually proves they answer, because it fetches
 * the deployed site the way a reviewer does. This runs in the ordinary suite and
 * catches the same two faults before a deploy rather than after:
 *
 *  1. **A rewrite behind the catch-all.** `**` sends everything to the SPA, so a
 *     `/privacy` listed after it answers 200 with the app shell — a reviewer
 *     finds no policy, and nothing looks broken from here.
 *  2. **A rewrite pointing at a file nobody wrote.** Same 200, same shell.
 *
 * And the link in the app has to agree with the rewrite: `PRIVACY_URL` is opened
 * from the More menu, and a policy that exists at a path the app does not name
 * satisfies nobody.
 */

const ROOT = resolve(import.meta.dirname, '..', '..', '..');
const hosting = JSON.parse(readFileSync(resolve(ROOT, 'firebase.json'), 'utf8')).hosting as {
  rewrites: { source: string; destination: string }[];
};

/** The pages Apple and Play require, and the app or the listing points at. */
const STORE_PAGES = ['/privacy', '/support', '/get-app'];

describe('the static pages the stores need', () => {
  it('rewrites each one ahead of the SPA catch-all', () => {
    const catchAll = hosting.rewrites.findIndex((r) => r.source === '**');
    expect(catchAll, 'no `**` rewrite at all').toBeGreaterThan(-1);

    for (const page of STORE_PAGES) {
      const at = hosting.rewrites.findIndex((r) => r.source === page);
      expect(at, `${page} has no rewrite`).toBeGreaterThan(-1);
      expect(at, `${page} is behind \`**\`, so it serves the app shell`).toBeLessThan(catchAll);
    }
  });

  it('points each one at a file that exists', () => {
    for (const page of STORE_PAGES) {
      const rule = hosting.rewrites.find((r) => r.source === page);
      const file = resolve(ROOT, 'app', 'public', rule!.destination.replace(/^\//, ''));
      expect(existsSync(file), `${page} -> ${rule!.destination}, which is not in app/public`).toBe(
        true,
      );
    }
  });

  it('serves the privacy policy at the path the app actually opens', () => {
    // The More menu opens `PRIVACY_URL`. If that drifts from the rewrite, the
    // one link a reviewer is guaranteed to follow leads nowhere — which is the
    // state this app was in until 2026-09-07, pointing at a host attached to
    // nothing.
    expect(new URL(PRIVACY_URL).pathname).toBe('/privacy');
  });

  it('keeps the app from naming a way to get an account', () => {
    /*
     * THE STORE EXEMPTION, GUARDED WHERE IT IS EASIEST TO LOSE. Play triggers the
     * account-deletion requirement if an app "directs the user to an app account
     * creation flow outside of the app", so /get-app may link to the app but
     * nothing shipped IN the app may link to /get-app or name it. A helpful line
     * on the sign-in screen two years from now is the whole risk.
     */
    const getApp = readFileSync(resolve(ROOT, 'app', 'public', 'get-app.html'), 'utf8');
    expect(getApp).toContain('sign in on this website once');

    // The refusal's own words live in `auth/signInMessage.ts`; the screen and
    // the More sheet are where a helpful link would be added.
    for (const file of [
      'src/auth/signInMessage.ts',
      'src/screens/SignInScreen.tsx',
      'src/components/MoreSheet.tsx',
    ]) {
      const src = readFileSync(resolve(ROOT, 'app', file), 'utf8');
      expect(src, `${file} names /get-app`).not.toMatch(/get-app/);
      expect(src, `${file} tells someone to sign up on the website`).not.toMatch(
        /sign up|create an account|on the website/i,
      );
    }
  });
});
