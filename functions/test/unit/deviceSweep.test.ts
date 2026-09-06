import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * How `onDeviceRegistered` is bound, which no behavioural test can reach.
 *
 * The sweep itself is covered end to end in
 * `functions/test/integration/notify.integration.test.ts`. What is not — and
 * cannot be — is the RECOVERY path: the trigger fires on every write rather
 * than only on a create, so a duplicate registration that the sweep failed to
 * clear is cleared the next time either account signs in.
 *
 * That only matters when an invocation has already failed (a still-building
 * index right after a deploy is the realistic one), and while the sweep works,
 * every registration finds the other row gone and is therefore a create. No
 * fixture can stage the broken state: anything written fires the sweep and is
 * tidied away. With a create-only binding the duplicate was PERMANENT —
 * `registerThisDevice` uses `setDoc`, which Firestore evaluates as an update
 * once the row exists, so neither account could ever clear it, and the previous
 * student's notifications kept arriving on the next student's phone.
 *
 * A test that reads the declaration is weak. A behavioural test that passed
 * under either binding would be worse: it would say the property is covered.
 */
const SRC = readFileSync(
  resolve(import.meta.dirname, '../../src/notifyTrigger.ts'),
  'utf8',
);

/** The declaration through to the end of its handler options. */
const declaration = SRC.slice(SRC.indexOf('export const onDeviceRegistered'));

describe('the device sweep is bound to every write', () => {
  it('found the declaration', () => {
    // A guard on the guard: a renamed export would make both assertions vacuous.
    expect(SRC).toContain('export const onDeviceRegistered');
  });

  it('fires on writes, not only on creates', () => {
    expect(declaration).toMatch(/^export const onDeviceRegistered = onDocumentWritten\(/);
  });

  /*
   * And ignores deletes — the document is gone, so there is nothing to keep,
   * and sweeping on one would race the deletes the handler itself performs.
   */
  it('returns early on a delete', () => {
    expect(declaration).toContain('if (!event.data?.after.exists) return;');
  });
});
