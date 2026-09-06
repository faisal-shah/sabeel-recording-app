import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The modal dialog's width cap, argued rather than measured.
 *
 * `Sheet.tsx` states its own maximum — deliberately, for the same reason the
 * player keeps its 560 where it is used: a number offered in the theme is a
 * number some screen will take, and a 420px page is not a thing this app wants.
 *
 * WHICH LEAVES IT UNJUDGED BY EVERYTHING THAT READS IT. The layout sweep parses
 * that same line to check the rendered panel against it, so raising the cap
 * moves both sides of the comparison at once: set it to 2000 and every sheet
 * renders full-bleed at 1440 with the sweep green. That is exactly the division
 * of labour `app/src/theme/layout.test.ts` describes for the column caps —
 * measurement in the sweep, argument in a unit test — and this is the argument.
 *
 * Lives in `functions/test/unit` because that workspace is the only one here
 * with a runner and node types — same reasoning as `emulatorPorts.test.ts`.
 */
const REPO = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

describe('the sheet', () => {
  const cap = Number(read('app/src/components/Sheet.tsx').match(/maxWidth:\s*(\d+)/)?.[1]);
  const contentMax = Number(
    read('app/src/theme/index.ts').match(/CONTENT_MAX_WIDTH\s*=\s*(\d+)/)?.[1],
  );

  it('states a maximum, and the theme still states a reading column', () => {
    expect(cap).toBeGreaterThan(0);
    expect(contentMax).toBeGreaterThan(0);
  });

  /*
   * A modal panel holds a short form — a couple of fields and a pair of buttons
   * — laid over the screen it was opened from. It has to be wide enough for a
   * labelled field and that button pair at 320, and narrow enough that it still
   * reads as something ON the page rather than as the page.
   */
  it('is a dialog width, not a page width', () => {
    expect(cap).toBeGreaterThanOrEqual(320);
    expect(cap).toBeLessThan(contentMax);
  });
});
