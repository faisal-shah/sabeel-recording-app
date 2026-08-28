import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every place this checkout states an emulator or dev-server port agrees.
 *
 * Three Sabeel repos share one machine, and every one of them used to pin the
 * same ports — so whichever suite started second SIGTERMed the other's
 * Firestore, and both sessions spent real time diagnosing symptoms that belonged
 * to the other process. Each checkout now owns a disjoint block.
 *
 * The ports cannot live in one file. Five consumers need five representations:
 *
 *   firebase.json               JSON   what the emulators actually bind
 *   app/src/env.ts              TS     inlined into the client bundle
 *   scripts/lib/ports.mjs       ESM    read by scripts/*.mjs
 *   free-emulator-ports.sh      shell  the kill list
 *   screens-e2e.sh              shell  the sweep's web dev-server port
 *
 * So the goal is not one copy, it is copies that cannot drift. A mismatch is
 * otherwise silent until something connects to a port nobody is serving — or,
 * far worse, to a port a SIBLING REPO is serving, which reads and writes
 * happily and passes.
 *
 * Lives in `functions/test/unit` because that workspace is the only one here
 * with a runner wired up; it asserts about repo files, not about functions.
 * Same reasoning as `ciCoverage.test.ts` next door.
 */
const REPO = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

/** `firebase.json` — what the emulator suite binds. */
function portsFromFirebaseJson(): Record<string, number> {
  const emulators = JSON.parse(read('firebase.json')).emulators as Record<
    string,
    { port?: number; websocketPort?: number }
  >;
  const out: Record<string, number> = {};
  for (const [service, cfg] of Object.entries(emulators)) {
    if (cfg && typeof cfg.port === 'number') out[service] = cfg.port;
    if (cfg && typeof cfg.websocketPort === 'number') {
      out.firestoreWebsocket = cfg.websocketPort;
    }
  }
  return out;
}

/**
 * The client's copy. Parsed rather than imported: `app/src/env.ts` imports
 * `react-native`, which will not load under the functions workspace's vitest.
 */
function portsFromClient(): Record<string, number> {
  const block = read('app/src/env.ts').match(/EMULATOR_PORTS\s*=\s*\{([^}]*)\}/)?.[1];
  if (!block) throw new Error('EMULATOR_PORTS not found in app/src/env.ts');
  return Object.fromEntries(
    [...block.matchAll(/(\w+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
  );
}

/** The scripts' copy. */
async function portsFromScripts(): Promise<{
  emulator: Record<string, number>;
  web: Record<string, number>;
}> {
  const mod = await import(resolve(REPO, 'scripts/lib/ports.mjs'));
  return { emulator: mod.EMULATOR_PORTS, web: mod.WEB_PORTS };
}

/** The shell kill list — a flat set of numbers, not a service map. */
function portsFromShell(): number[] {
  const line = read('scripts/free-emulator-ports.sh').match(/^PORTS=\(([^)]*)\)/m)?.[1];
  if (!line) throw new Error('PORTS=(…) not found in scripts/free-emulator-ports.sh');
  return line.trim().split(/\s+/).map(Number);
}

/** The sweep's web port, defaulted in shell before Node ever sees it. */
function sweepWebPortFromShell(): number {
  const m = read('scripts/screens-e2e.sh').match(/WEB_PORT="\$\{SWEEP_WEB_PORT:-(\d+)\}"/);
  if (!m) throw new Error('WEB_PORT default not found in scripts/screens-e2e.sh');
  return Number(m[1]);
}

/**
 * This checkout's block. Bases are 100 apart, one per repo on this machine.
 *
 * 61100+ because the ephemeral range here is 32768-60999
 * (`/proc/sys/net/ipv4/ip_local_port_range`) so nothing above it is handed out
 * at random, and Firebase's own defaults top out at 9499
 * (`firebase-tools/lib/emulator/constants.js`) so the block collides with
 * nothing the CLI would choose for itself.
 */
const BLOCK_START = 61100;
const BLOCK_END = BLOCK_START + 99;

describe('emulator ports agree across every file that states them', () => {
  it('every port is inside this checkout\u2019s block', async () => {
    const { emulator, web } = await portsFromScripts();
    const all = { ...emulator, ...web };
    expect(Object.keys(all).length).toBeGreaterThan(0);

    for (const [service, port] of Object.entries(all)) {
      expect(
        port >= BLOCK_START && port <= BLOCK_END,
        `${service}=${port} is outside ${BLOCK_START}-${BLOCK_END} — that is another checkout's territory`,
      ).toBe(true);
    }
  });

  it('no two services claim the same port', async () => {
    const { emulator, web } = await portsFromScripts();
    expect(Object.keys(emulator).length).toBeGreaterThan(0);
    expect(Object.keys(web).length).toBeGreaterThan(0);

    const all = [...Object.values(emulator), ...Object.values(web)];
    expect(new Set(all).size, 'two services claim the same port').toBe(all.length);
  });

  it('firebase.json matches scripts/lib/ports.mjs', async () => {
    const { emulator } = await portsFromScripts();
    const config = portsFromFirebaseJson();

    // Guard the guard: an empty parse would make every comparison below
    // trivially true, which is the failure mode this whole file exists to stop.
    expect(Object.keys(config).length).toBeGreaterThan(0);

    for (const [service, port] of Object.entries(config)) {
      expect(emulator[service], `firebase.json ${service}=${port}`).toBe(port);
    }
  });

  it('the client bundle uses the same ports as the scripts', async () => {
    const { emulator } = await portsFromScripts();
    const client = portsFromClient();
    expect(Object.keys(client).length).toBeGreaterThan(0);

    for (const [service, port] of Object.entries(client)) {
      expect(emulator[service], `app/src/env.ts ${service}=${port}`).toBe(port);
    }
  });

  it('free-emulator-ports.sh frees exactly the emulator ports this checkout uses', async () => {
    const { emulator } = await portsFromScripts();
    const shell = portsFromShell();
    expect(shell.length).toBeGreaterThan(0);

    // Every port we bind must be swept…
    for (const [service, port] of Object.entries(emulator)) {
      expect(shell, `${service}=${port} is not in the PORTS array`).toContain(port);
    }
    // …and nothing else, or the sweep reaches into another checkout's block.
    // That is not hypothetical: on 2026-08-27 a port-based sweep killed a
    // sibling repo's running emulator.
    const owned = new Set(Object.values(emulator));
    for (const port of shell) {
      expect(owned.has(port), `PORTS contains ${port}, which this checkout does not own`).toBe(
        true,
      );
    }
  });

  it('the sweep script and the sweep runner agree on the web port', async () => {
    const { web } = await portsFromScripts();
    expect(sweepWebPortFromShell(), 'screens-e2e.sh WEB_PORT vs WEB_PORTS.sweep').toBe(web.sweep);
  });
});
