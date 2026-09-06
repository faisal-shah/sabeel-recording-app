import { describe, expect, it } from 'vitest';
import { CONTENT_MAX_WIDTH, LAYOUT_WIDTHS, RAIL_WIDTH, WIDE_BREAKPOINT } from './index';

/**
 * The layout constants, pinned by the reasoning that produced them.
 *
 * THE SWEEP CANNOT DO THIS. `screens-e2e.mjs` parses these numbers out of this
 * module on purpose — a constant restated in the test that checks it drifts from
 * the thing it is testing — which means its column check moves with the value:
 * change `CONTENT_MAX_WIDTH` to 420 and every reading screen renders a 420px
 * ribbon in a 1364px window, and the sweep passes, because 420 is now what it
 * expects. The sweep proves a screen honours its declared column. Only something
 * that knows WHY the number is what it is can prove the number.
 *
 * So the arithmetic is here, where it can be argued rather than measured.
 */
describe('the reading column', () => {
  /*
   * A line of body text should run 45–75 characters; below that the eye jumps
   * back too often, above it loses the return. At the app's 15px body size an
   * average character is close to 0.5em, so a character costs ~7.5px and the
   * band is roughly 340–560px of text — plus a screen's own 16px of padding on
   * each side, and the tolerance that a heading and a card border also live in
   * this column. 720 sits at the generous end of that, which is right for a
   * screen that mixes prose with forms and cards.
   */
  it('is wide enough for a full line and narrow enough to return', () => {
    expect(CONTENT_MAX_WIDTH).toBeGreaterThanOrEqual(600);
    expect(CONTENT_MAX_WIDTH).toBeLessThanOrEqual(820);
  });

  it('is the width `read` means', () => {
    expect(LAYOUT_WIDTHS.read).toBe(CONTENT_MAX_WIDTH);
  });
});

describe('the list column', () => {
  /*
   * A collection wants columns, and a column is one card. The narrowest card
   * this app lays out is 300px and the gap is 12, so a list cap has to hold at
   * least three of them to be worth having — anything under that is a reading
   * column wearing a different name, which is the mistake the student screens
   * made before they were moved onto it.
   */
  it('holds at least three of the narrowest cards', () => {
    const narrowestCard = 300;
    const gap = 12;
    expect(LAYOUT_WIDTHS.list).toBeGreaterThanOrEqual(narrowestCard * 3 + gap * 2);
  });

  it('is wider than the reading column, or it would not be a second width', () => {
    expect(LAYOUT_WIDTHS.list).toBeGreaterThan(CONTENT_MAX_WIDTH);
  });
});

describe('the desktop breakpoint', () => {
  /*
   * The rail replaces the bottom bar here, so the window has to be wide enough
   * that giving up `RAIL_WIDTH` still leaves a usable content area — and wide
   * enough to be a laptop rather than a large phone in landscape, which is
   * around 900.
   */
  it('leaves a full reading column after the rail', () => {
    expect(WIDE_BREAKPOINT - RAIL_WIDTH).toBeGreaterThanOrEqual(CONTENT_MAX_WIDTH);
  });

  it('is above the widest phone and below the narrowest laptop', () => {
    expect(WIDE_BREAKPOINT).toBeGreaterThan(500);
    expect(WIDE_BREAKPOINT).toBeLessThanOrEqual(1024);
  });
});
