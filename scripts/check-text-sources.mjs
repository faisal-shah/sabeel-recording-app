#!/usr/bin/env node
// Fail if any tracked source file contains a NUL byte (or other control bytes
// that make tools treat it as binary).
//
// Why this exists: functions/src/driveRows.ts once held a RAW NUL character
// inside a template literal used as a composite Map-key separator. It compiled
// and ran correctly — but `file` reported the source as "data", git diffed it as
// binary, and **grep silently skipped the entire file**. During a dead-code
// audit that made a live constant look unreferenced, which nearly got it
// deleted. A verification tool that returns "no matches" for a file it cannot
// read is worse than no tool at all.
//
// Write control characters as escapes (`\u0000`) instead: identical runtime
// value, plain-text source that every tool can read.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|sh|rules|gradle|py)$/;
// Bytes that are legal in text: tab (9), LF (10), CR (13). Everything below 32
// otherwise — and NUL above all — makes tooling treat the file as binary.
const isBadByte = (b) => b === 0 || (b < 9) || (b > 13 && b < 32);

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && EXTS.test(f));

const offenders = [];
for (const f of files) {
  let buf;
  try {
    buf = readFileSync(f);
  } catch {
    continue; // deleted/unreadable — not this check's business
  }
  for (let i = 0; i < buf.length; i++) {
    if (isBadByte(buf[i])) {
      const upto = buf.subarray(0, i);
      const line = upto.toString('utf8').split('\n').length;
      offenders.push({ file: f, line, byte: buf[i] });
      break; // one report per file is enough to act on
    }
  }
}

if (offenders.length === 0) {
  console.log(`check-text-sources: ${files.length} files, all plain text`);
  process.exit(0);
}

console.error('check-text-sources: control bytes found in source files —');
for (const o of offenders) {
  console.error(
    `  ${o.file}:${o.line}  byte 0x${o.byte.toString(16).padStart(2, '0')}` +
      `  → write it as an escape (e.g. \\u0000) so grep/git can read the file`,
  );
}
process.exit(1);
