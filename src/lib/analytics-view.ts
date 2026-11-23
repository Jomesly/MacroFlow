import 'server-only';
import { listTrades } from './journal';
import { filterTrades } from './analytics';
import { requireOwnedTradingAccount } from './trading-accounts';
import type { Trade } from './types';

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export interface AnalyticsView {
  /** Filtered trades; cash is cleared when the view mixes accounts. */
  trades: Trade[];
  moneyComparable: boolean;
  currency: string | null;
}

/**
 * The trades behind one analytics view. The analytics summary and the
 * calendar day drill-down both use this, so a day shows exactly the trades
 * its calendar cell counted.
 */
export async function loadAnalyticsView(userId: string, params: URLSearchParams): Promise<AnalyticsView> {
  const accountIds = parseList(params.get('account'))
    ?.map(Number)
    .filter((n) => Number.isInteger(n));
  const trades = await listTrades(userId, params.get('tradingAccount') ?? undefined);
  const filtered = filterTrades(trades, {
    accountIds,
    symbols: parseList(params.get('symbol')),
    tags: parseList(params.get('tag')),
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
  });
  // Aggregating different accounts can mix currencies. Keep counts and R;
  // monetary figures are only meaningful for one journal/broker account.
  const moneyAccounts = new Set(filtered.filter(t => t.result !== null && t.pnlAmount !== null).map(t => t.journalAccountId ?? t.brokerAccountId));
  const moneyComparable = moneyAccounts.size <= 1;
  const moneyAccountId = moneyComparable ? filtered.find(t => t.result !== null && t.pnlAmount !== null)?.journalAccountId : undefined;
  const currency = moneyAccountId ? (await requireOwnedTradingAccount(userId, moneyAccountId)).currency : null;
  return {
    trades: moneyComparable ? filtered : filtered.map(t => ({ ...t, pnlAmount: null, pnlAmountExact: null })),
    moneyComparable,
    currency,
  };
}
