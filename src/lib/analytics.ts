import { Trade } from './types';

// ── TradeZella-core analytics over a user's trades ──────────────────────
// Money math uses pnlAmount (EA/synced trades). Manual percent-only trades
// contribute to counts/win-rate but are excluded from money metrics, and
// every money metric reports its coverage so gaps stay visible.

export interface AnalyticsFilters {
  accountIds?: number[];
  symbols?: string[];
  tags?: string[];
  from?: string; // ISO date (inclusive), compared on logged_at
  to?: string; // ISO date (inclusive), compared on logged_at
}

export interface BucketStats {
  trades: number;
  wins: number;
  losses: number;
  net: number | null;
  winRate: number | null;
}

export interface CalendarDay extends BucketStats {
  date: string;
  breakeven: number;
}

export interface AnalyticsResult {
  totals: {
    trades: number;
    closed: number;
    open: number;
    wins: number;
    losses: number;
    breakeven: number;
    winRate: number | null; // wins / (wins + losses); BE excluded
    net: number | null;
    moneyCoverage: number | null; // share of closed trades with pnlAmount
    grossProfit: number | null;
    grossLoss: number | null;
    profitFactor: number | null; // null when no losing money trades
    avgWin: number | null;
    avgLoss: number | null;
    expectancy: number | null; // net per money trade
    avgR: number | null;
    rCoverage: number | null; // share of closed trades with rMultiple
  };
  calendar: CalendarDay[];
  bySymbol: Record<string, BucketStats>;
  byTag: Record<string, BucketStats>;
  bySession: Record<string, BucketStats>;
  byWeekday: Record<string, BucketStats>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function winRateOf(wins: number, losses: number): number | null {
  const decisive = wins + losses;
  return decisive > 0 ? round2((wins / decisive) * 100) : null;
}

function nyParts(iso: string): { hour: number; weekday: string } {
  const d = new Date(iso);
  const hourFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  });
  let hour = Number(hourFmt.format(d));
  if (hour === 24) hour = 0; // midnight edge in some ICU builds
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(d);
  return { hour, weekday };
}

/** NY evening session (8 PM–12 AM ET) in America/New_York local time. */
export function sessionOf(iso: string): string {
  const { hour } = nyParts(iso);
  return hour >= 20 && hour < 24 ? 'NY Evening (8P-12A ET)' : 'Outside NY Evening';
}

function emptyBucket(): BucketStats {
  return { trades: 0, wins: 0, losses: 0, net: 0, winRate: null };
}

function addToBucket(b: BucketStats, trade: Trade, moneyBuckets: Set<BucketStats>): void {
  b.trades += 1;
  if (trade.result === 'win') b.wins += 1;
  if (trade.result === 'loss') b.losses += 1;
  if (trade.pnlAmount !== null) {
    b.net = round2((b.net ?? 0) + trade.pnlAmount);
    moneyBuckets.add(b);
  }
  b.winRate = winRateOf(b.wins, b.losses);
}

function finalizeBucketMoney(b: BucketStats, hasMoney: boolean): void {
  if (!hasMoney) b.net = null;
}

export function filterTrades(trades: Trade[], filters: AnalyticsFilters): Trade[] {
  return trades.filter((t) => {
    if (filters.accountIds && filters.accountIds.length > 0) {
      if (t.brokerAccountId === null || !filters.accountIds.includes(t.brokerAccountId)) return false;
    }
    if (filters.symbols && filters.symbols.length > 0 && !filters.symbols.includes(t.symbol)) {
      return false;
    }
    if (filters.tags && filters.tags.length > 0 && !filters.tags.some((tag) => t.setupTags.includes(tag))) {
      return false;
    }
    if (filters.from && t.timestamp < filters.from) return false;
    if (filters.to && t.timestamp > filters.to) return false;
    return true;
  });
}

export function computeAnalytics(trades: Trade[], filters: AnalyticsFilters = {}): AnalyticsResult {
  const rows = filterTrades(trades, filters);
  const closed = rows.filter((t) => t.result !== null);
  const open = rows.length - closed.length;

  const wins = closed.filter((t) => t.result === 'win').length;
  const losses = closed.filter((t) => t.result === 'loss').length;
  const breakeven = closed.filter((t) => t.result === 'breakeven').length;

  const money = closed.filter((t) => t.pnlAmount !== null);
  const grossProfit = money.filter((t) => (t.pnlAmount as number) > 0);
  const grossLoss = money.filter((t) => (t.pnlAmount as number) < 0);
  const grossProfitSum = round2(grossProfit.reduce((s, t) => s + (t.pnlAmount as number), 0));
  const grossLossSum = round2(grossLoss.reduce((s, t) => s + (t.pnlAmount as number), 0));
  const net = money.length > 0 ? round2(money.reduce((s, t) => s + (t.pnlAmount as number), 0)) : null;

  const rTrades = closed.filter((t) => t.rMultiple !== null);

  const calendarMap = new Map<string, CalendarDay>();
  const bySymbol: Record<string, BucketStats> = {};
  const byTag: Record<string, BucketStats> = {};
  const bySession: Record<string, BucketStats> = {};
  const byWeekday: Record<string, BucketStats> = {};
  const moneyBuckets = new Set<BucketStats>();

  for (const trade of closed) {
    // Calendar groups by close date (UTC), falling back to log date.
    const day = (trade.closedAt ?? trade.timestamp).slice(0, 10);
    let cal = calendarMap.get(day);
    if (!cal) {
      cal = { ...emptyBucket(), date: day, breakeven: 0 };
      calendarMap.set(day, cal);
    }
    addToBucket(cal, trade, moneyBuckets);
    if (trade.result === 'breakeven') cal.breakeven += 1;

    addToBucket((bySymbol[trade.symbol] ??= emptyBucket()), trade, moneyBuckets);

    for (const tag of trade.setupTags) {
      addToBucket((byTag[tag] ??= emptyBucket()), trade, moneyBuckets);
    }

    addToBucket((bySession[sessionOf(trade.timestamp)] ??= emptyBucket()), trade, moneyBuckets);
    addToBucket((byWeekday[nyParts(trade.timestamp).weekday] ??= emptyBucket()), trade, moneyBuckets);
  }

  for (const bucket of [
    ...Object.values(bySymbol),
    ...Object.values(byTag),
    ...Object.values(bySession),
    ...Object.values(byWeekday),
    ...calendarMap.values(),
  ]) {
    finalizeBucketMoney(bucket, moneyBuckets.has(bucket));
  }

  const calendar = [...calendarMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    totals: {
      trades: rows.length,
      closed: closed.length,
      open,
      wins,
      losses,
      breakeven,
      winRate: winRateOf(wins, losses),
      net,
      moneyCoverage: closed.length > 0 ? round2((money.length / closed.length) * 100) : null,
      grossProfit: money.length > 0 ? grossProfitSum : null,
      grossLoss: money.length > 0 ? grossLossSum : null,
      profitFactor:
        grossLossSum < 0 ? round2(grossProfitSum / Math.abs(grossLossSum)) : null,
      avgWin:
        grossProfit.length > 0 ? round2(grossProfitSum / grossProfit.length) : null,
      avgLoss:
        grossLoss.length > 0 ? round2(grossLossSum / grossLoss.length) : null,
      expectancy: money.length > 0 && net !== null ? round2(net / money.length) : null,
      avgR:
        rTrades.length > 0
          ? round2(rTrades.reduce((s, t) => s + (t.rMultiple as number), 0) / rTrades.length)
          : null,
      rCoverage: closed.length > 0 ? round2((rTrades.length / closed.length) * 100) : null,
    },
    calendar,
    bySymbol,
    byTag,
    bySession,
    byWeekday,
  };
}
