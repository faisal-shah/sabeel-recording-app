import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * THE PRIVACY POLICY'S ONE CODE-LEVEL PROMISE. `app/public/privacy.html`:
 * "Crash reports carry no name, no email address and no account identifier.
 * This application attaches no user identity to them at all. That is enforced
 * in the code, not by policy alone." This is the enforcement. A `setUser`, or
 * an email or uid handed to Sentry as a tag, would make the published policy
 * false on the next deploy — and the request to add one has already been made
 * once (2026-09-17, for triage), which is why it is a test and not a comment.
 */
const APP_SRC = resolve(import.meta.dirname, '..', '..', '..', 'app', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(entry) && !/\.test\./.test(entry) ? [p] : [];
  });

describe('Sentry never learns who', () => {
  it('no file identifies the account to Sentry', () => {
    const offenders: string[] = [];
    for (const file of files(APP_SRC)) {
      const src = readFileSync(file, 'utf8');
      if (/\bsetUser\s*\(/.test(src)) offenders.push(`${file}: setUser`);
      if (/setTag\(\s*['"](uid|email|user|name|displayName)['"]/.test(src)) {
        offenders.push(`${file}: identity tag`);
      }
      if (/setContext\(\s*['"]user['"]/.test(src)) offenders.push(`${file}: user context`);
    }
    expect(offenders).toEqual([]);
  });

  it('the seams are the ones reporting, and carry the release and the role', () => {
    // A guard on the guard: grepping nothing would pass the test above.
    for (const seam of ['sentry.ts', 'sentry.web.ts']) {
      const src = readFileSync(join(APP_SRC, seam), 'utf8');
      expect(src).toMatch(/captureException\(/);
      expect(src).toMatch(/setTag\('role'/);
      expect(src).toMatch(/release: BUILD_LABEL/);
    }
  });
});
