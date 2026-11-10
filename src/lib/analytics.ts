import { Trade } from './types';
import { tradeDay } from './trade-dates';

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

export interface DayExtreme {
  date: string;
  net: number;
}

export interface EquityPoint {
  date: string;
  net: number;
  cumulative: number;
}

/** Entry-time bucket: `block` is the 4-hour slot of the New York day (0 = 12-4 AM). */
export interface TimeCell extends BucketStats {
  weekday: string;
  block: number;
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
    winningDays: number | null; // days with money data and a positive net
    losingDays: number | null;
    dayWinRate: number | null; // winning / (winning + losing) days
    winLossRatio: number | null; // avg win / |avg loss|
    maxDrawdown: number | null; // deepest fall from a running peak, <= 0
    bestDay: DayExtreme | null;
    worstDay: DayExtreme | null;
    longestWinStreak: number;
    longestLossStreak: number;
    currentStreak: { result: 'win' | 'loss'; count: number } | null;
  };
  calendar: CalendarDay[];
  equity: EquityPoint[]; // running net across days that have money data
  timeHeatmap: TimeCell[]; // entry weekday x 4-hour block, New York time
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

function addToBucket(b: BucketStats, trade: Trade, moneyBuckets: Set<BucketStats>, decimals: number): void {
  b.trades += 1;
  if (trade.result === 'win') b.wins += 1;
  if (trade.result === 'loss') b.losses += 1;
  if (trade.pnlAmount !== null) {
    b.net = Number(((b.net ?? 0) + trade.pnlAmount).toFixed(decimals));
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
    const date = t.importInfo?.datePrecision === 'date' ? tradeDay(t, false) : t.timestamp;
    if (filters.from && date < filters.from) return false;
    // A date-only bound covers its whole day, so compare it with the day part.
    if (filters.to && (filters.to.length === 10 ? date.slice(0, 10) : date) > filters.to) return false;
    return true;
  });
}

function closeTime(trade: Trade): number {
  return Date.parse(trade.closedAt ?? trade.timestamp);
}

/** Runs of consecutive wins or losses in close order; breakeven trades neither extend nor end a run. */
function streaksOf(closed: Trade[]) {
  const decisive = closed
    .filter((t) => t.result === 'win' || t.result === 'loss')
    .sort((a, b) => closeTime(a) - closeTime(b));
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let run: { result: 'win' | 'loss'; count: number } | undefined;
  for (const trade of decisive) {
    const result = trade.result as 'win' | 'loss';
    run = run?.result === result ? { result, count: run.count + 1 } : { result, count: 1 };
    if (result === 'win') longestWinStreak = Math.max(longestWinStreak, run.count);
    else longestLossStreak = Math.max(longestLossStreak, run.count);
  }
  return { longestWinStreak, longestLossStreak, currentStreak: run ?? null };
}

export function computeAnalytics(trades: Trade[], filters: AnalyticsFilters = {}, moneyDecimals = 2): AnalyticsResult {
  const roundMoney = (value: number) => Number(value.toFixed(moneyDecimals));
  const rows = filterTrades(trades, filters);
  const closed = rows.filter((t) => t.result !== null);
  const open = rows.length - closed.length;

  const wins = closed.filter((t) => t.result === 'win').length;
  const losses = closed.filter((t) => t.result === 'loss').length;
  const breakeven = closed.filter((t) => t.result === 'breakeven').length;

  const money = closed.filter((t) => t.pnlAmount !== null);
  const grossProfit = money.filter((t) => (t.pnlAmount as number) > 0);
  const grossLoss = money.filter((t) => (t.pnlAmount as number) < 0);
  const grossProfitSum = roundMoney(grossProfit.reduce((s, t) => s + (t.pnlAmount as number), 0));
  const grossLossSum = roundMoney(grossLoss.reduce((s, t) => s + (t.pnlAmount as number), 0));
  const net = money.length > 0 ? roundMoney(money.reduce((s, t) => s + (t.pnlAmount as number), 0)) : null;

  const rTrades = closed.filter((t) => t.rMultiple !== null);

  const calendarMap = new Map<string, CalendarDay>();
  // Tags can come from CSV files. Treat names such as __proto__ as data keys.
  const bySymbol: Record<string, BucketStats> = Object.create(null);
  const byTag: Record<string, BucketStats> = Object.create(null);
  const bySession: Record<string, BucketStats> = Object.create(null);
  const byWeekday: Record<string, BucketStats> = Object.create(null);
  const timeMap = new Map<string, TimeCell>();
  const moneyBuckets = new Set<BucketStats>();

  for (const trade of closed) {
    // Calendar groups by close date (UTC), falling back to log date.
    const day = tradeDay(trade);
    let cal = calendarMap.get(day);
    if (!cal) {
      cal = { ...emptyBucket(), date: day, breakeven: 0 };
      calendarMap.set(day, cal);
    }
    addToBucket(cal, trade, moneyBuckets, moneyDecimals);
    if (trade.result === 'breakeven') cal.breakeven += 1;

    addToBucket((bySymbol[trade.symbol] ??= emptyBucket()), trade, moneyBuckets, moneyDecimals);

    for (const tag of trade.setupTags) {
      addToBucket((byTag[tag] ??= emptyBucket()), trade, moneyBuckets, moneyDecimals);
    }

    const unknownEntry = trade.importInfo?.dateMeaning === 'close' || trade.importInfo?.datePrecision === 'date';
    addToBucket((bySession[unknownEntry ? 'Unknown entry time' : sessionOf(trade.timestamp)] ??= emptyBucket()), trade, moneyBuckets, moneyDecimals);
    addToBucket((byWeekday[unknownEntry ? 'Unknown entry time' : nyParts(trade.timestamp).weekday] ??= emptyBucket()), trade, moneyBuckets, moneyDecimals);

    if (!unknownEntry) {
      const { weekday, hour } = nyParts(trade.timestamp);
      const block = Math.floor(hour / 4);
      const key = `${weekday}:${block}`;
      let cell = timeMap.get(key);
      if (!cell) {
        cell = { ...emptyBucket(), weekday, block };
        timeMap.set(key, cell);
      }
      addToBucket(cell, trade, moneyBuckets, moneyDecimals);
    }
  }

  for (const bucket of [
    ...Object.values(bySymbol),
    ...Object.values(byTag),
    ...Object.values(bySession),
    ...Object.values(byWeekday),
    ...calendarMap.values(),
    ...timeMap.values(),
  ]) {
    finalizeBucketMoney(bucket, moneyBuckets.has(bucket));
  }

  const calendar = [...calendarMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equity: EquityPoint[] = [];
  for (const day of calendar) {
    if (day.net === null) continue;
    running = roundMoney(running + day.net);
    peak = Math.max(peak, running);
    maxDrawdown = Math.min(maxDrawdown, roundMoney(running - peak));
    equity.push({ date: day.date, net: day.net, cumulative: running });
  }
  const winningDays = equity.filter((d) => d.net > 0).length;
  const losingDays = equity.filter((d) => d.net < 0).length;
  const extreme = (pick: (a: EquityPoint, b: EquityPoint) => boolean): DayExtreme | null => {
    if (equity.length === 0) return null;
    const day = equity.reduce((best, d) => (pick(d, best) ? d : best));
    return { date: day.date, net: day.net };
  };
  const avgWin = grossProfit.length > 0 ? roundMoney(grossProfitSum / grossProfit.length) : null;
  const avgLoss = grossLoss.length > 0 ? roundMoney(grossLossSum / grossLoss.length) : null;

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
      avgWin,
      avgLoss,
      expectancy: money.length > 0 && net !== null ? roundMoney(net / money.length) : null,
      avgR:
        rTrades.length > 0
          ? round2(rTrades.reduce((s, t) => s + (t.rMultiple as number), 0) / rTrades.length)
          : null,
      rCoverage: closed.length > 0 ? round2((rTrades.length / closed.length) * 100) : null,
      winningDays: equity.length > 0 ? winningDays : null,
      losingDays: equity.length > 0 ? losingDays : null,
      dayWinRate: winRateOf(winningDays, losingDays),
      winLossRatio: avgWin !== null && avgLoss !== null ? round2(avgWin / Math.abs(avgLoss)) : null,
      maxDrawdown: equity.length > 0 ? maxDrawdown : null,
      bestDay: extreme((a, b) => a.net > b.net),
      worstDay: extreme((a, b) => a.net < b.net),
      ...streaksOf(closed),
    },
    calendar,
    equity,
    timeHeatmap: [...timeMap.values()],
    bySymbol,
    byTag,
    bySession,
    byWeekday,
  };
}
