/**
 * This checkout's Firebase emulator and dev-server ports — the one place
 * `scripts/*.mjs` read them.
 *
 * Several files have to agree and cannot share a representation: this one (ESM),
 * `firebase.json` (JSON, what the emulators bind), `app/src/env.ts` (TS, inlined
 * into the client bundle at build time), the `PORTS=(…)` array in
 * `free-emulator-ports.sh` and the `WEB_PORT` default in `screens-e2e.sh`
 * (shell). The copies are unavoidable; the copies drifting is not.
 * `functions/test/unit/emulatorPorts.test.ts` asserts they agree, so a change to
 * one of them fails the unit suite in seconds rather than surfacing later as an
 * emulator that answers on a port nobody expected — or, far worse, as a SIBLING
 * repo's emulator answering, which reads and writes happily and passes.
 */
export const EMULATOR_PORTS = {
  firestore: 8080,
  firestoreWebsocket: 9150,
  auth: 9099,
  functions: 5001,
  storage: 9199,
  ui: 4000,
  hub: 4400,
  logging: 4500,
};

/**
 * Expo web dev-server ports. Deliberately two: the screenshot sweep and
 * `test:e2e` must be able to run at the same time, and two suites that grab the
 * same port cannot.
 */
export const WEB_PORTS = {
  sweep: 8086,
  e2e: 8083,
};
