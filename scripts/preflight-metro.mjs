// Refuse to start if port 8081 belongs to a DIFFERENT project's Metro.
//
// The Android emulator reaches Metro at 10.0.2.2:8081 — the host machine, port
// 8081, directly. `adb reverse` does not intercept that, and Metro's port cannot
// simply be moved without also rebuilding the native app. So whoever holds 8081
// serves our app.
//
// This machine has several React Native projects (kanban, time-tracker, PineTimeCompanion).
// A leftover Metro from one of them on 8081 serves ITS bundle to this app: the
// Gradle build succeeds, the install succeeds, and the app boots showing a red
// screen full of another repo's module paths. Easy to misread as a bug in this
// project. Fail loudly instead. (Observed in the kanban repo on 2026-07-19,
// which is where this guard was written; copied here 2026-08-28 because the
// port is shared and the guard was not.)
import { execSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 8081;
const APP_DIR = resolve(import.meta.dirname, '..', 'app');

function pidsOnPort(port) {
  try {
    // `ss`, not `lsof`. This guard protects the ONE port that cannot be moved
    // into a per-repo block (Metro 8081, which the Android emulator reaches
    // directly at 10.0.2.2:8081), and `lsof` is not on PATH in a
    // non-interactive shell without the toolchain env sourced — so the catch
    // below turned the whole guard into a no-op that always said "free",
    // exactly where it mattered most. `ss` is in /usr/bin and always present.
    return execSync(`ss -lptn 'sport = :${port}'`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\n')
      .flatMap((line) => line.match(/pid=(\d+)/)?.[1] ?? [])
      .filter((v, i, a) => a.indexOf(v) === i);
  } catch {
    return []; // nothing listening
  }
}

function cwdOf(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

const foreign = pidsOnPort(PORT)
  .map((pid) => ({ pid, cwd: cwdOf(pid) }))
  .filter(({ cwd }) => cwd && !cwd.startsWith(APP_DIR));

if (foreign.length > 0) {
  console.error(`\n✖ Port ${PORT} is held by a Metro from another project:\n`);
  for (const { pid, cwd } of foreign) console.error(`    pid ${pid}  ${cwd}`);
  console.error(
    `\n  The Android emulator reaches Metro at 10.0.2.2:${PORT}, so that server would\n` +
      `  serve ITS bundle to this app — the red screen you'd get is misleading.\n\n` +
      `  Stop it first (in that project's terminal), or:  kill ${foreign.map((f) => f.pid).join(' ')}\n`,
  );
  process.exit(1);
}
