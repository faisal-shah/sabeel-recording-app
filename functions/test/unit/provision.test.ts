import { describe, it, expect } from 'vitest';
import { ALLOWED_EMAIL_DOMAIN } from '@sabeel/shared';
import { decideProvision } from '../../src/provision';

const staffEmail = `teacher@${ALLOWED_EMAIL_DOMAIN}`;
const google = (over: Partial<Parameters<typeof decideProvision>[0]> = {}) =>
  decideProvision({
    email: staffEmail,
    emailVerified: true,
    displayName: 'A Teacher',
    photoURL: null,
    providerIds: ['google.com'],
    ...over,
  });

describe('decideProvision — staff via Google', () => {
  it('provisions a verified org address as a pending manager', () => {
    const d = google();
    expect(d.action).toBe('provision');
    if (d.action !== 'provision') return;
    // Pending grants nothing; an admin must approve. Domain membership alone is
    // explicitly not authorisation.
    expect(d.claims).toEqual({ role: 'manager', status: 'pending' });
    expect(d.profile.email).toBe(staffEmail);
  });

  it('rejects an address outside the org domain', () => {
    expect(google({ email: 'someone@gmail.com' }).action).toBe('reject');
  });

  it('rejects an unverified org address', () => {
    expect(google({ emailVerified: false }).action).toBe('reject');
  });

  it('falls back to the local part when Google sends no display name', () => {
    const d = google({ displayName: null });
    expect(d.action === 'provision' && d.profile.displayName).toBe('teacher');
  });

  it('falls back when the display name is only whitespace', () => {
    const d = google({ displayName: '   ' });
    expect(d.action === 'provision' && d.profile.displayName).toBe('teacher');
  });
});

describe('decideProvision — students via email/password', () => {
  it('IGNORES password accounts rather than deleting them', () => {
    // The whole reason this app cannot reuse the kanban trigger: there, anything
    // off-domain is deleted, which would destroy every student account the
    // moment createStudent made one.
    const d = decideProvision({
      email: 'student@example.com',
      emailVerified: false,
      providerIds: ['password'],
    });
    expect(d.action).toBe('ignore');
  });

  it('ignores an Admin-SDK account that has NO provider yet', () => {
    // The bug this exists to prevent: createStudent deliberately creates the
    // account WITHOUT a password so the student sets their own, and such a user
    // has empty providerData until they do. Rejecting it deleted every student
    // seconds after creation, and the failure looked intermittent because it
    // depended on trigger timing.
    const d = decideProvision({
      email: 'student@example.com',
      emailVerified: false,
      providerIds: [],
    });
    expect(d.action).toBe('ignore');
  });

  it('still rejects a providerless account with NO email', () => {
    // Anonymous sign-in also has empty providerData. The address is what
    // separates a real staff-created student from one.
    const d = decideProvision({ email: null, providerIds: [] });
    expect(d.action).toBe('reject');
  });

  it('ignores password accounts regardless of domain', () => {
    // Students are not org members and never will be. Applying the staff domain
    // gate to them would be exactly the bug this branch exists to prevent.
    for (const email of ['a@gmail.com', `b@${ALLOWED_EMAIL_DOMAIN}`, null]) {
      expect(decideProvision({ email, providerIds: ['password'] }).action).toBe('ignore');
    }
  });
});

describe('decideProvision — everything else', () => {
  it('rejects providers we do not use', () => {
    for (const provider of ['facebook.com', 'apple.com', 'anonymous', 'phone']) {
      const d = decideProvision({ email: staffEmail, emailVerified: true, providerIds: [provider] });
      expect(d.action).toBe('reject');
      expect(d.action === 'reject' && d.reason).toBe('unsupported-provider');
    }
  });

  it('treats password as authoritative when an account carries both providers', () => {
    // A linked account is staff-created first; deleting it because of the other
    // provider would lose a real student.
    expect(
      decideProvision({
        email: 'student@example.com',
        providerIds: ['password', 'google.com'],
      }).action,
    ).toBe('ignore');
  });
});
