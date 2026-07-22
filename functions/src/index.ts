import { onCall } from 'firebase-functions/v2/https';
import { REGION } from '@sabeel/shared';

/**
 * The payload `ping` returns, as a plain function.
 *
 * Handlers are kept separate from their `onCall`/`onDocumentWritten` wrappers
 * throughout this codebase: the wrapper needs a live functions runtime to
 * invoke, the logic does not. Everything worth asserting therefore stays a
 * unit test instead of needing the emulator.
 */
export function pingPayload(): { ok: true; region: string } {
  return { ok: true, region: REGION };
}

/**
 * Phase 0 smoke callable.
 *
 * It exists so the deploy surface is exercised end to end before any real
 * function depends on it: esbuild inlining the private `@sabeel/shared` import,
 * the region constant, and the functions emulator actually registering a
 * callable. Replaced by real callables in Phase 1.
 */
export const ping = onCall({ region: REGION }, () => pingPayload());
