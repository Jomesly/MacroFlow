import { NextRequest, NextResponse } from 'next/server';
import { requireJournalAccess } from '@/lib/auth';
import { listTrades } from '@/lib/journal';
import { computeAnalytics, filterTrades } from '@/lib/analytics';
import { TradingAccountError } from '@/lib/trading-account-types';
import { requireOwnedTradingAccount } from '@/lib/trading-accounts';
import { currencyPrecision } from '@/lib/account-money';

export const dynamic = 'force-dynamic';

function parseList(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * GET /api/journal/analytics?account=1,2&symbol=XAUUSD&tag=Sweep&from=...&to=...
 * TradeZella-core aggregates over the current user's trades.
 */
export async function GET(request: NextRequest) {
  const auth = await requireJournalAccess(request);
  if (!auth.ok) return auth.response;

  try {
    const params = request.nextUrl.searchParams;
    const accountParam = parseList(params.get('account'));
    const accountIds = accountParam
      ?.map(Number)
      .filter((n) => Number.isInteger(n));

    const trades = await listTrades(auth.userId, params.get('tradingAccount') ?? undefined);
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
    const currency = moneyAccountId ? (await requireOwnedTradingAccount(auth.userId, moneyAccountId)).currency : null;
    const analytics = computeAnalytics(moneyComparable ? filtered : filtered.map(t => ({ ...t, pnlAmount: null })), {}, currency ? currencyPrecision(currency) : 2);

    return NextResponse.json({ analytics, moneyComparable, currency, timestamp: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof TradingAccountError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 });
  }
}
