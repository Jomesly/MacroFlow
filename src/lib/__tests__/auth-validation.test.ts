import { describe, expect, it, afterEach } from 'vitest';
import { signupSchema, passwordSchema, profileSchema, safeJournalDestination, applicationOrigin } from '../auth-validation';

describe('auth input and redirect boundaries', () => {
  it('rejects mismatched passwords and invalid email before contacting Auth', () => {
    expect(signupSchema.safeParse({ email: 'bad', password: 'long-password', confirmPassword: 'other' }).success).toBe(false);
    expect(signupSchema.safeParse({ email: ' a@example.test ', password: 'long-password', confirmPassword: 'long-password' }).success).toBe(true);
    expect(passwordSchema.safeParse({ password: 'short', confirmPassword: 'short' }).success).toBe(false);
  });
  it('allows only explicit journal return destinations', () => {
    for (const value of ['https://evil.test', '//evil.test', '/auth/confirm', '/journal?next=//evil.test', null]) {
      expect(safeJournalDestination(value)).toBe('/journal');
    }
    expect(safeJournalDestination('/journal/welcome')).toBe('/journal/welcome');
  });
  it('validates timezone/preferences and rejects authorization metadata', () => {
    expect(profileSchema.safeParse({ displayName: 'Trader', reportingTimezone: 'Asia/Manila', destination: 'log' }).success).toBe(true);
    expect(profileSchema.safeParse({ reportingTimezone: 'not-a-timezone', destination: 'log' }).success).toBe(false);
    expect(profileSchema.safeParse({ reportingTimezone: 'UTC', destination: 'log', status: 'active' }).success).toBe(false);
  });
});

describe('configured application origin', () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => { if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL = original; });
  it('uses a configured origin and rejects credential-bearing URLs', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3137';
    expect(applicationOrigin()).toBe('http://localhost:3137');
    process.env.NEXT_PUBLIC_APP_URL = 'https://user:secret@example.test';
    expect(() => applicationOrigin()).toThrow();
    process.env.NEXT_PUBLIC_APP_URL = 'http://untrusted.test';
    expect(() => applicationOrigin()).toThrow();
  });
});
