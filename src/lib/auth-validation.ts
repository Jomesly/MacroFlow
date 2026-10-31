import { z } from 'zod';

export type AuthFormState = { error?: string; message?: string; retryAfter?: number };
export const emailSchema = z.object({ email: z.string().trim().pipe(z.email('Enter a valid email address.')) });
const passwordFields = {
  password: z.string().min(8, 'Use at least 8 characters.').max(128, 'Use no more than 128 characters.'),
  confirmPassword: z.string(),
};
export const passwordSchema = z.object(passwordFields).refine(
  (input) => input.password === input.confirmPassword,
  { message: 'Passwords do not match.', path: ['confirmPassword'] },
);
export const signupSchema = z.object({ ...emailSchema.shape, ...passwordFields }).refine(
  (input) => input.password === input.confirmPassword,
  { message: 'Passwords do not match.', path: ['confirmPassword'] },
);
export const loginSchema = z.object({
  ...emailSchema.shape,
  password: z.string().min(1, 'Enter your password.').max(1024),
});
export const profileSchema = z.object({
  displayName: z.string().trim().max(80).optional().default(''),
  reportingTimezone: z.string().max(100).refine((value) => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Choose a valid IANA timezone, such as UTC or Asia/Manila.'),
  destination: z.enum(['log', 'accounts', 'skip']),
}).strict();
export type ProfileInput = z.infer<typeof profileSchema>;

export function safeJournalDestination(value: string | null): '/journal' | '/journal/welcome' {
  return value === '/journal/welcome' ? value : '/journal';
}

export function applicationOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) throw new Error('Set NEXT_PUBLIC_APP_URL to the application origin.');
  const url = new URL(configured);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an HTTPS origin (HTTP is allowed on localhost).');
  }
  return url.origin;
}
