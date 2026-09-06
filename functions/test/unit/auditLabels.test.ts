import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every action the server audits has a sentence, and every sentence has an
 * action.
 *
 * The audit screen maps an action name to English and falls back to the name
 * itself, so a missing entry is not an error anywhere — it is one camelCase
 * function name sitting in a list of sentences, on the screen people consult to
 * establish what happened. `AuditScreen`'s own docblock has said "adding an
 * `auditedCall` means adding a line here" since the map was written, and by the
 * time anyone checked it was wrong in BOTH directions: every Zoom import
 * rendered as `importZoomRecording`, while `assignCatchup` and `updateRecording`
 * labelled actions no callable had written since the catch-up concept was
 * removed. A rule stated in a comment is not a rule.
 *
 * BY TEXT, because the two sides are in different workspaces and one of them is
 * a `.tsx` the functions runner cannot import. What matters is that both lists
 * are read from the files that define them, not restated here.
 *
 * Lives in `functions/test/unit` because that workspace is the only one here
 * with a runner wired up — same reasoning as `emulatorPorts.test.ts` next door.
 */
const REPO = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

/**
 * What the server writes into `auditLog.action`.
 *
 * Two shapes, and both are real: `auditedCall('name', …)` wraps a callable, and
 * the auth trigger — which has no callable to wrap — hands `writeAudit` an
 * entry carrying its own `action`. The second is matched against `writeAudit`
 * rather than against a bare `action:` key: `action` is also a Cloud Storage
 * signed-URL option and a discriminant in `provision.ts`, and matching those
 * would have this test demand English for `read` and `ignore`.
 */
function serverActions(): Set<string> {
  const dir = resolve(REPO, 'functions/src');
  const out = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(resolve(dir, file), 'utf8');
    for (const m of src.matchAll(/auditedCall\(\s*'([A-Za-z]+)'/g)) out.add(m[1]);
    for (const m of src.matchAll(/writeAudit\(\{[\s\S]*?action:\s*'([A-Za-z]+)'/g)) out.add(m[1]);
  }
  return out;
}

/** The keys of `ACTION_LABELS` in the audit screen. */
function labelledActions(): Set<string> {
  const src = read('app/src/screens/AuditScreen.tsx');
  const block = src.match(/const ACTION_LABELS: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('ACTION_LABELS not found — this test is reading the wrong shape');
  return new Set([...block[1].matchAll(/^\s{2}([A-Za-z]+):/gm)].map((m) => m[1]));
}

describe('audit action labels', () => {
  // A guard on the guard: if either reader stops matching, both sets go empty
  // and every assertion below passes for the wrong reason.
  it('found both lists', () => {
    expect(serverActions().size).toBeGreaterThan(15);
    expect(labelledActions().size).toBeGreaterThan(15);
  });

  it('gives every audited action a sentence', () => {
    const missing = [...serverActions()].filter((a) => !labelledActions().has(a)).sort();
    expect(missing).toEqual([]);
  });

  it('carries no sentence for an action nothing writes', () => {
    const orphaned = [...labelledActions()].filter((a) => !serverActions().has(a)).sort();
    expect(orphaned).toEqual([]);
  });
});
