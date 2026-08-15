import { describe, it, expect } from 'vitest';
import { isDeadToken } from '../../src/messaging';

/**
 * Which FCM failures may delete a device registration.
 *
 * The send itself cannot be tested — there is no FCM emulator — but the verdict
 * on each per-token error can be, and it is the half that can silently
 * unregister everybody. Pruning is irreversible from the server's side: the
 * device only comes back if its owner happens to reopen the notification
 * settings, so a wrong "dead" reads as notifications simply stopping.
 */
describe('isDeadToken', () => {
  it('is true only for the two codes specific to the token', () => {
    expect(isDeadToken('messaging/registration-token-not-registered')).toBe(true);
    expect(isDeadToken('messaging/invalid-registration-token')).toBe(true);
  });

  it('is FALSE for invalid-argument, which FCM also returns for a bad message', () => {
    // A title or data payload FCM rejects comes back against every entry in the
    // batch, so treating this as a token verdict prunes every recipient at once
    // over one malformed message.
    expect(isDeadToken('messaging/invalid-argument')).toBe(false);
  });

  it('is false for transient failures and for no code at all', () => {
    expect(isDeadToken('messaging/server-unavailable')).toBe(false);
    expect(isDeadToken('messaging/internal-error')).toBe(false);
    expect(isDeadToken('messaging/quota-exceeded')).toBe(false);
    expect(isDeadToken(undefined)).toBe(false);
  });
});
