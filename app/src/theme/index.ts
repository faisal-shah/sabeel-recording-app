/**
 * Semantic theme tokens. Every color in the app comes from here.
 *
 * SINGLE LIGHT THEME — no dark mode (decided 2026-07-21; see docs/BRAND.md).
 * `useTheme()` returns the one theme; it is a hook so a stored preference or a
 * second theme could be layered in here later without any screen changing.
 *
 * Usage inside a component:
 *   const t = useTheme();
 *   <View style={{ backgroundColor: t.bg.surface }}>
 *
 * Module-scope StyleSheet.create (which cannot call a hook) uses getTheme():
 *   const t = getTheme();
 *   const styles = StyleSheet.create({ card: { backgroundColor: t.bg.surface } });
 * This is safe precisely because the theme is static (single light theme) — the
 * value is fixed at module load. If a second theme is ever added, those static
 * styles are where it would need revisiting; screens using useTheme() would not.
 *
 * Names describe ROLE, not appearance — `text.muted`, never `text.grey`.
 *
 * Copied from the sibling time-tracker, which carries the fuller token set
 * (accent.gold / goldText / sage decorative accents, bg.goldSoft, bg.sage,
 * accent.onAccentMuted). This app needs those for recording status chips.
 * See docs/BRAND.md.
 */
import { palette } from './palette';

function build() {
  const p = palette;
  return {
    bg: {
      /** App background, behind everything. */
      canvas: p.canvas,
      /** Cards, sheets, list rows. */
      surface: p.surface,
      /** Surfaces that sit above other surfaces (menus). */
      raised: p.raised,
      /** Recessed areas — text inputs. */
      inset: p.inset,
      /** Tint behind selected/active items. */
      accentSoft: p.accentSoft,
      /** Tint behind destructive confirmation. */
      dangerSoft: p.dangerSoft,
      /** Ivory-gold tint behind a pending / awaiting row. */
      goldSoft: p.goldSoft,
      /** Sage-charactered fill for secondary buttons and neutral chips. */
      sage: p.bgSage,
    },
    text: {
      primary: p.textPrimary,
      secondary: p.textSecondary,
      /** Captions, placeholders — never body text. */
      muted: p.textMuted,
      /** Text on an accent (raspberry) fill. */
      inverse: p.textInverse,
      accent: p.accent,
      danger: p.danger,
    },
    border: {
      subtle: p.borderSubtle,
      strong: p.borderStrong,
    },
    accent: {
      base: p.accent,
      hover: p.accentHover,
      onAccent: p.accentText,
      /** Muted text on a raspberry fill (e.g. a secondary line on an accent card). */
      onAccentMuted: p.onAccentMuted,
      /** Decorative gold — dividers, hairline borders, fills. NOT read-critical. */
      gold: p.gold,
      /** Gold used AS TEXT (labels, status). Deepened to read on ivory. */
      goldText: p.goldText,
      /** Decorative sage — status dots, accent borders. */
      sage: p.sage,
    },
    feedback: {
      danger: p.danger,
      success: p.success,
      warning: p.warning,
    },
    effect: {
      /** Scrim behind a modal. */
      overlay: p.overlay,
      shadow: p.shadow,
    },
  } as const;
}

export type Theme = ReturnType<typeof build>;

const theme: Theme = build();

/**
 * The app theme. A hook by design: if a manual override or a second theme is
 * ever added, this is the single place it layers in and no screen needs touching.
 */
export function useTheme(): Theme {
  return theme;
}

/** Non-hook access, for module-scope styles and `.web` seams that cannot use hooks. */
export function getTheme(): Theme {
  return theme;
}

/** Spacing scale, in points — 4pt grid. */
export const spacing = (n: number) => n * 4;

/**
 * The width the content column stops growing at.
 *
 * The one number this app's layout turns on. Below it a screen is full-bleed;
 * at and above it the column caps here and centres, so the empty space lands on
 * both sides instead of leaving lines too long to read. There is no second
 * layout — no rail, no columns — which is why this is the whole breakpoint.
 *
 * `scripts/screens-e2e.mjs` READS THIS FILE for the number rather than keeping
 * its own copy, and picks its viewport widths to straddle it. A constant
 * restated in the test that checks it drifts from the thing it is testing.
 */
export const CONTENT_MAX_WIDTH = 720;
