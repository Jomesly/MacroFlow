import { z } from 'zod';
import { moneyUnits } from './account-money';

export const CASH_KINDS = ['deposit', 'withdrawal', 'adjustment-increase', 'adjustment-decrease', 'fee'] as const;
export type CashKind = typeof CASH_KINDS[number];
export const CASH_LABELS: Record<CashKind, string> = { deposit: 'Deposit', withdrawal: 'Withdrawal', 'adjustment-increase': 'Adjustment · increase', 'adjustment-decrease': 'Adjustment · decrease', fee: 'Standalone fee' };
const amount = z.string().max(25).refine(value => { try { moneyUnits(value); return true; } catch { return false; } }, 'Enter a valid decimal amount.');
const positiveAmount = amount.refine(value => { try { return moneyUnits(value) > 0n; } catch { return false; } }, 'Amount must be greater than zero.');
const effectiveAt = z.iso.datetime({ offset: true }).refine(value => new Date(value).getTime() <= Date.now() + 60_000, 'Funds dates cannot be in the future.');
const cashFields = { kind: z.enum(CASH_KINDS), amount: positiveAmount, effectiveAt, note: z.string().trim().max(1000).default('') };
const reason = z.string().trim().min(1, 'Add a reason for this correction.').max(1000);
export const fundsMutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set-opening'), amount, effectiveAt, note: z.string().trim().max(1000).default(''), expectedVersion: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal('add'), ...cashFields }).strict(),
  z.object({ action: z.literal('edit'), entryId: z.uuid(), expectedVersion: z.number().int().positive(), ...cashFields, reason }).strict(),
  z.object({ action: z.literal('void'), entryId: z.uuid(), expectedVersion: z.number().int().positive(), reason }).strict(),
]).superRefine((value, ctx) => {
  if (value.action === 'set-opening' && value.expectedVersion > 0 && !value.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Explain the opening balance correction.' });
  if ((value.action === 'add' || value.action === 'edit') && value.kind.startsWith('adjustment') && !value.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Add a reason for the adjustment.' });
});
export const fundsRequestSchema = z.object({ requestId: z.uuid(), mutation: fundsMutationSchema }).strict();
export type FundsMutation = z.infer<typeof fundsMutationSchema>;

export interface FundRevision {
  id: string; operation: string; reason: string; createdAt: string;
  before: { amount?: string; effectiveAt?: string; kind?: string; note?: string; voidedAt?: string | null } | null;
  after: { amount?: string; effectiveAt?: string; kind?: string; note?: string; voidedAt?: string | null };
}
export interface CashEntry {
  id: string; kind: CashKind; amount: string; effectiveAt: string; note: string;
  version: number; voidedAt: string | null; revisions: FundRevision[];
}
export interface AccountFunds {
  currency: string | null;
  syncedAccount: boolean;
  opening: { amount: string; effectiveAt: string; version: number; note: string; revisions: FundRevision[] } | null;
  summary: { balance: string | null; netFunding: string; netPnl: string; fees: string; adjustments: string; missingPnl: number; missingDates: number; complete: boolean; asOf: string };
  entries: CashEntry[]; hasMore: boolean;
}
