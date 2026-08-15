import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Which sender the module picks, in both directions.
 *
 * This guard is worth pinning because BOTH ways of getting it wrong are silent.
 * Suppressing in production would stop every notification with nothing failing;
 * sending under the emulator puts a live trigger's FCM call in a race with the
 * tests, where whatever the credential-less Admin SDK returns is read as a
 * verdict on real tokens — and a dead-token verdict DELETES the device row the
 * running test is using. That is what made `notify.integration` flaky.
 *
 * The choice is made at module load, so each case re-imports with the
 * environment stubbed rather than calling a setter.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
});

const MESSAGE = { title: 't', body: 'b' };

async function freshMessaging() {
  vi.resetModules();
  return import('../../src/messaging');
}

describe('sender selection', () => {
  it('suppresses the send under the emulator, pruning nothing', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { send } = await freshMessaging();

    // No FCM call at all: resolves, reports nothing sent, and — the part that
    // matters — reports no stale tokens, so no device can be deleted.
    await expect(send(['tok-a', 'tok-b'], MESSAGE)).resolves.toEqual({ stale: [], sent: 0 });
    expect(log).toHaveBeenCalled();
  });

  it('uses the REAL sender when the emulator variable is absent', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', '');
    const { send } = await freshMessaging();

    // There is no initialized Admin app in this process, so the real path throws
    // on getMessaging(). Reaching that throw is the assertion: it proves the
    // production branch was taken. The suppressed sender resolves and could
    // never get here.
    await expect(send(['tok-a'], MESSAGE)).rejects.toThrow();
  });

  it('treats any value other than the literal "true" as production', async () => {
    // The emulator sets exactly "true". A stray "1" or "false" must not be read
    // as "we are in a test" and quietly disable notifications.
    for (const value of ['1', 'false', 'TRUE']) {
      vi.stubEnv('FUNCTIONS_EMULATOR', value);
      const { send } = await freshMessaging();
      await expect(send(['tok-a'], MESSAGE)).rejects.toThrow();
    }
  });

  it('resetSender restores the default rather than re-arming a real send', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { send, setSender, resetSender } = await freshMessaging();

    setSender(async () => ({ stale: ['tok-a'], sent: 0 }));
    await expect(send(['tok-a'], MESSAGE)).resolves.toEqual({ stale: ['tok-a'], sent: 0 });

    resetSender();
    await expect(send(['tok-a'], MESSAGE)).resolves.toEqual({ stale: [], sent: 0 });
  });
});
