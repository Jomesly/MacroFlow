import { z } from 'zod';
import { TRADE_SYMBOLS } from './types';
import { moneyUnits, normalizeMoney } from './account-money';

const price = z.number().finite().positive().max(1e12);
const date = z.iso.datetime({ offset: true }).refine(value => new Date(value).getTime() <= Date.now() + 60_000, 'Execution dates cannot be in the future.');
const money = z.string().max(25).refine(value => { try { moneyUnits(value); return true; } catch { return false; } }, 'Enter a valid decimal money amount.');

export const tradeBatchSchema = z.object({
  requestId: z.uuid(),
  symbol: z.enum(TRADE_SYMBOLS as [string, ...string[]]),
  direction: z.enum(['long', 'short']),
  entryPrice: price,
  openedAt: date,
  setupTags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  notes: z.string().max(10_000).default(''),
  accounts: z.array(z.object({
    accountId: z.uuid(),
    entryPrice: price.optional(),
    openedAt: date.optional(),
    exitPrice: price.nullable().optional(),
    result: z.enum(['win', 'loss', 'breakeven']).nullable().optional(),
    closedAt: date.nullable().optional(),
    netPnl: money.nullable().optional(),
  }).strict()).min(1, 'Choose at least one account.').max(20, 'Select up to 20 accounts per trade.'),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.accounts.forEach((account, index) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', path: ['accounts', index], message });
    if (ids.has(account.accountId)) issue('Choose each account only once.');
    ids.add(account.accountId);
    const closed = !!account.closedAt;
    if (closed && !account.result && account.netPnl == null) issue('Choose a result or enter net P&L for a closed trade.');
    if (!closed && (account.result || account.exitPrice != null || account.netPnl != null)) issue('A closed trade needs a closing date and time.');
    if (closed && new Date(account.closedAt!).getTime() < new Date(account.openedAt ?? value.openedAt).getTime()) issue('Closing time must be on or after entry time.');
    if (account.netPnl != null && account.result) {
      try {
        const units = moneyUnits(account.netPnl);
        if (account.result !== (units > 0n ? 'win' : units < 0n ? 'loss' : 'breakeven')) issue('Result must match the sign of net P&L.');
      } catch { /* field validation supplies the error */ }
    }
  });
});

export type TradeBatchInput = z.infer<typeof tradeBatchSchema>;

export function normalizeBatch(input: TradeBatchInput) {
  return { ...input, accounts: input.accounts.map(account => ({
    ...account,
    netPnl: account.netPnl == null ? null : normalizeMoney(account.netPnl),
    result: account.netPnl == null ? account.result ?? null : moneyUnits(account.netPnl) > 0n ? 'win' : moneyUnits(account.netPnl) < 0n ? 'loss' : 'breakeven',
  })) };
}
