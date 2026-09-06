import { describe, expect, it, vi } from 'vitest';
import { errorText } from './errors';

/**
 * What a person reads when something fails.
 *
 * Every case here is a real shape one of this app's own dependencies produces,
 * transcribed from what they actually build: `FunctionsError` sets `message` to
 * the description with no prefix, and `@firebase/util`'s `ErrorFactory` builds
 * `Firebase: <message> (<service>/<code>).`
 */
const GENERIC = 'Something went wrong. Try again in a moment.';

describe('errorText', () => {
  it('passes a callable’s own sentence straight through', () => {
    expect(errorText(new Error('The due date for this recording has passed.'))).toBe(
      'The due date for this recording has passed.',
    );
  });

  /*
   * A callable that throws without a message surfaces its CODE in the message's
   * place — which is how `INTERNAL` came to be the entire text of a full-width
   * error band in the staff app.
   */
  it.each(['internal', 'unauthenticated', 'permission-denied', 'INTERNAL'])(
    'turns the bare code %s into a sentence',
    (code) => {
      const e = Object.assign(new Error(code), { code: `functions/${code}` });
      expect(errorText(e)).toBe(GENERIC);
    },
  );

  it('turns away the SDK talking to a developer', () => {
    const e = Object.assign(new Error('Firebase: Error (auth/user-not-found).'), {
      code: 'auth/user-not-found',
    });
    expect(errorText(e)).toBe(GENERIC);
  });

  it.each([undefined, null, {}, 'a string throw', new Error('')])(
    'has an answer for %s',
    (thrown) => {
      expect(errorText(thrown)).toBe(GENERIC);
    },
  );

  it('logs the raw value, whatever it was', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorText(Object.assign(new Error('internal'), { code: 'functions/internal' }));
    expect(warn).toHaveBeenCalledWith('request failed', 'functions/internal');
    warn.mockClear();
    // No code, no message — the log still says something rather than nothing.
    errorText({});
    expect(warn).toHaveBeenCalledWith('request failed', 'unknown');
    warn.mockRestore();
  });
});
