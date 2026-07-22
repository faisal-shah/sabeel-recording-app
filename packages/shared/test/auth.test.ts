import { describe, it, expect } from 'vitest';
import { ALLOWED_EMAIL_DOMAIN, isAllowedStaffEmail, isStaffRole } from '../src';

describe('isAllowedStaffEmail', () => {
  it('accepts a verified address on the org domain', () => {
    expect(isAllowedStaffEmail(`someone@${ALLOWED_EMAIL_DOMAIN}`, true)).toBe(true);
  });

  it('rejects an unverified address, even on the org domain', () => {
    // Google will hand over an account with an unverified address, and an
    // unverified address proves nothing about who controls it.
    expect(isAllowedStaffEmail(`someone@${ALLOWED_EMAIL_DOMAIN}`, false)).toBe(false);
  });

  it('rejects other domains', () => {
    expect(isAllowedStaffEmail('someone@gmail.com', true)).toBe(false);
    expect(isAllowedStaffEmail('someone@example.org', true)).toBe(false);
  });

  it('rejects a lookalike domain that merely ends with ours', () => {
    // The check must compare the whole domain, not a suffix — `endsWith` here
    // would hand the org to anyone who registers notoursabeel.com.
    expect(isAllowedStaffEmail('someone@notoursabeel.com', true)).toBe(false);
    expect(isAllowedStaffEmail(`someone@evil-${ALLOWED_EMAIL_DOMAIN}`, true)).toBe(false);
  });

  it('rejects an address whose domain only appears in the local part', () => {
    expect(isAllowedStaffEmail(`${ALLOWED_EMAIL_DOMAIN}@gmail.com`, true)).toBe(false);
  });

  it('takes the LAST @ so an embedded one cannot smuggle a domain in', () => {
    expect(isAllowedStaffEmail(`a@${ALLOWED_EMAIL_DOMAIN}@gmail.com`, true)).toBe(false);
    expect(isAllowedStaffEmail(`a@gmail.com@${ALLOWED_EMAIL_DOMAIN}`, true)).toBe(true);
  });

  it('is case- and whitespace-insensitive on the domain', () => {
    expect(isAllowedStaffEmail(`Someone@${ALLOWED_EMAIL_DOMAIN.toUpperCase()} `, true)).toBe(true);
  });

  it('rejects missing, empty and malformed addresses', () => {
    expect(isAllowedStaffEmail(undefined, true)).toBe(false);
    expect(isAllowedStaffEmail(null, true)).toBe(false);
    expect(isAllowedStaffEmail('', true)).toBe(false);
    expect(isAllowedStaffEmail('no-at-sign', true)).toBe(false);
  });
});

describe('isStaffRole', () => {
  it('counts admin and manager as staff', () => {
    expect(isStaffRole('admin')).toBe(true);
    expect(isStaffRole('manager')).toBe(true);
  });

  it('does not count students or a missing role', () => {
    expect(isStaffRole('student')).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});
