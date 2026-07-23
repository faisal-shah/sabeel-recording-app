/**
 * Build the web bundle FOR DEPLOY, with Sentry source maps.
 *
 * Runs as the hosting predeploy. Four steps:
 *   1. Export with external source maps (plain `web:export` emits none).
 *   2. Inject Sentry "debug IDs" into the JS and the maps. Debug IDs match a
 *      runtime error to its map with no release/version coordination.
 *   3. Upload the maps to the `sabeel-recording-web` Sentry project.
 *   4. DELETE the .map files from the deploy dir, so Firebase Hosting never
 *      serves them publicly — the maps live in Sentry, not on the open web. The
 *      shipped JS keeps its debug id, so events still symbolicate.
 *
 * The Sentry steps are skipped (with a note) when the gitignored
 * app/android/sentry.properties has no auth token — a fresh clone or CI can
 * still build and deploy, just without uploading maps. The token is read only by
 * sentry-cli, via SENTRY_PROPERTIES; it never passes through this script.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'app', 'dist-web');
const PROPS = join(ROOT, 'app', 'android', 'sentry.properties');
const ORG = 'devnull-ke';
const WEB_PROJECT = 'sabeel-recording-web';

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
}

// 1. Export with source maps.
run('npm', ['run', 'web:export:maps', '-w', '@sabeel/app']);

// Does the token file carry an auth token? (Presence check only — the value is
// never read here; sentry-cli reads it itself.)
const hasToken =
  existsSync(PROPS) && /^auth\.token=\S/m.test(readFileSync(PROPS, 'utf8'));

if (hasToken) {
  const env = { ...process.env, SENTRY_PROPERTIES: PROPS };
  console.log('\n[web-release] injecting debug ids + uploading source maps to Sentry…');
  // inject takes a path, not org/project — call it without the trailing flags.
  run('npx', ['sentry-cli', 'sourcemaps', 'inject', DIST], { env });
  run('npx', ['sentry-cli', 'sourcemaps', 'upload', '--org', ORG, '--project', WEB_PROJECT, DIST], {
    env,
  });
} else {
  console.log('\n[web-release] no Sentry token — skipping source-map upload.');
}

// 4. Strip maps from the deploy dir so they are not served publicly.
let stripped = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.map')) {
      rmSync(p);
      stripped++;
    }
  }
};
if (existsSync(DIST)) walk(DIST);
console.log(`[web-release] stripped ${stripped} source map(s) from the deploy bundle.`);
