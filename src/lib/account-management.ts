import { z } from 'zod';

export interface BrokerAccount {
  id: number;
  account_login: string;
  server: string;
  currency: string | null;
  source: string;
  ea_version: string | null;
  last_seen_at: string | null;
  display_name: string | null;
  notes: string;
  lifecycle: 'active' | 'paused' | 'removed';
  removed_at: string | null;
  trade_count: number;
  management_version: number;
}

export const accountIdSchema = z.string().regex(/^[1-9]\d*$/, 'Invalid account ID.').transform(Number)
  .refine(Number.isSafeInteger, 'Invalid account ID.');
const operationFields = { expectedVersion: z.number().int().positive().max(2147483647), operationId: z.uuid() };
export const accountReconnectSchema = z.object(operationFields).strict();
export const accountPatchSchema = z.discriminatedUnion('action', [
  z.object({ ...operationFields, action: z.literal('edit'), displayName: z.string().trim().max(80), notes: z.string().trim().max(1000) }).strict(),
  z.object({ ...operationFields, action: z.enum(['pause', 'resume']) }).strict(),
]);
export const accountRemovalSchema = z.object({
  ...operationFields,
  deleteTrades: z.boolean(), confirmation: z.string().max(64).default(''),
}).strict();
export const userDeletionSchema = z.object({
  password: z.string().min(1, 'Enter your current password.').max(1024),
  confirmation: z.literal('DELETE', { error: 'Type DELETE to confirm.' }),
}).strict();

export function accountError(error: { message?: string; code?: string }): { status: number; code: string; error: string } {
  const known: Record<string, [number, string]> = {
    ACCOUNT_NOT_FOUND: [404, 'Trading account not found.'],
    ACCOUNT_REMOVED: [409, 'This account was removed. Reconnect it in Accounts to sync again.'],
    ACCOUNT_PAUSED: [409, 'Sync is paused for this account. Resume it in Accounts.'],
    ACCOUNT_STATE_CHANGED: [409, 'This account changed. Refresh Accounts and try again.'],
    ACCOUNT_OPERATION_CONFLICT: [409, 'This request changed. Close the dialog and confirm a new request.'],
    ACCOUNT_CLIENT_OUTDATED: [409, 'Reload this page before changing an account.'],
    JOURNAL_WRITE_BUSY: [503, 'Another journal update is in progress. Please retry shortly.'],
    CONFIRMATION_REQUIRED: [400, 'Type the account login to confirm deleting its trades.'],
    ACCOUNT_DELETING: [403, 'Account deletion has started. Open Account settings to finish deletion.'],
    JOURNAL_ACCESS_REVOKED: [403, 'Journal access is unavailable for this account.'],
    BILLING_REVIEW_REQUIRED: [409, 'Resolve your active subscription with the site owner before deleting your account.'],
  };
  const code = Object.keys(known).find((candidate) => error.message === candidate);
  if (code) return { status: known[code][0], code, error: known[code][1] };
  return { status: 503, code: 'ACCOUNT_STORAGE_UNAVAILABLE', error: 'Account management is temporarily unavailable. Please retry shortly.' };
}
