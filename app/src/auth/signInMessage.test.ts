import { describe, it, expect, vi } from 'vitest';
import { signInMessage } from './signInMessage';

describe('the sign-in screen\'s words for a failure', () => {
  it('refuses a Google sign-in with no account without naming the website', () => {
    const text = signInMessage({ code: 'auth/no-account', message: 'No account for that sign-in.' });
    expect(text).toBe("This account isn't set up for the app yet. Contact your administrator.");
    // THE STORE EXEMPTION: the refusal must not point at a way to get an account.
    expect(text).not.toMatch(/website|sign up|create/i);
  });

  it('never prints the functions SDK\'s bare token when accountExists cannot be reached', () => {
    // What `httpsCallable` rejects with when fetch itself fails: code and
    // message are both the one word.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const text = signInMessage({ code: 'functions/internal', message: 'internal' });
    expect(text).not.toBe('internal');
    expect(text).toMatch(/\s/);
  });

  it('lets a sentence the server wrote through', () => {
    expect(signInMessage({ code: 'functions/unauthenticated', message: 'That sign-in could not be verified.' }))
      .toBe('That sign-in could not be verified.');
  });

  it('says the same thing for a wrong password and an unknown address', () => {
    expect(signInMessage({ code: 'auth/wrong-password' })).toBe(signInMessage({ code: 'auth/user-not-found' }));
  });
});
