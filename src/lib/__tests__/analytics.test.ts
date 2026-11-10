import { describe, expect, it } from 'vitest';
import { computeAnalytics, filterTrades, sessionOf } from '../analytics';
import { Trade } from '../types';

let seq = 0;
function trade(overrides: Partial<Trade> = {}): Trade {
  seq += 1;
  return {
    id: `t${seq}`,
    timestamp: '2026-01-05T15:00:00.000Z', // 10 AM ET — outside NY evening
    closedAt: '2026-01-05T16:00:00.000Z',
    symbol: 'XAUUSD',
    direction: 'long',
    entryPrice: 100,
    exitPrice: 110,
    result: 'win',
    pnlPercent: 10,
    pnlAmount: 100,
    rMultiple: 2,
    brokerAccountId: 7,
    setupTags: ['Sweep'],
    notes: '',
    ...overrides,
  };
}

describe('computeAnalytics', () => {
  it('preserves crypto cash precision in totals, buckets and equity', () => {
    const result = computeAnalytics([
      trade({ pnlAmount: 0.00000003 }),
      trade({ pnlAmount: -0.00000001, result: 'loss' }),
    ], {}, 8);
    expect(result.totals.net).toBe(0.00000002);
    expect(result.totals.avgLoss).toBe(-0.00000001);
    expect(result.totals.expectancy).toBe(0.00000001);
    expect(result.byTag.Sweep.net).toBe(0.00000002);
    expect(result.equity[0].cumulative).toBe(0.00000002);
    expect(result.totals.profitFactor).toBe(3);
  });
  it('treats imported tag names as ordinary keys without modifying object prototypes', () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    const { byTag } = computeAnalytics([trade({ setupTags: ['__proto__', 'constructor', 'toString'] })]);
    for (const tag of ['__proto__', 'constructor', 'toString']) {
      expect(Object.hasOwn(byTag, tag)).toBe(true);
      expect(byTag[tag]).toMatchObject({ trades: 1, net: 100 });
    }
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
  });
  it('computes headline metrics with honest coverage', () => {
    const rows = [
      trade({ pnlAmount: 100, rMultiple: 2 }),
      trade({ result: 'loss', pnlPercent: -5, pnlAmount: -50, rMultiple: -1 }),
      trade({ result: 'breakeven', pnlPercent: 0, pnlAmount: 0, rMultiple: 0 }),
      trade({ result: null, exitPrice: null, pnlPercent: null, pnlAmount: null, rMultiple: null }),
      trade({ symbol: 'US100', pnlAmount: null, rMultiple: null, setupTags: [] }), // percent-only win
    ];

    const { totals } = computeAnalytics(rows);

    expect(totals.trades).toBe(5);
    expect(totals.closed).toBe(4);
    expect(totals.open).toBe(1);
    expect(totals.wins).toBe(2);
    expect(totals.losses).toBe(1);
    expect(totals.breakeven).toBe(1);
    expect(totals.winRate).toBe(66.67); // 2 / (2 + 1), BE excluded
    expect(totals.net).toBe(50);
    expect(totals.moneyCoverage).toBe(75); // 3 of 4 closed have pnlAmount
    expect(totals.grossProfit).toBe(100);
    expect(totals.grossLoss).toBe(-50);
    expect(totals.profitFactor).toBe(2);
    expect(totals.avgWin).toBe(100);
    expect(totals.avgLoss).toBe(-50);
    expect(totals.expectancy).toBe(16.67); // 50 / 3
    expect(totals.avgR).toBe(0.33); // (2 - 1 + 0) / 3
    expect(totals.rCoverage).toBe(75);
  });

  it('returns nulls on empty input instead of NaN', () => {
    const { totals, calendar } = computeAnalytics([]);
    expect(totals.winRate).toBeNull();
    expect(totals.net).toBeNull();
    expect(totals.profitFactor).toBeNull();
    expect(totals.moneyCoverage).toBeNull();
    expect(calendar).toEqual([]);
  });

  it('groups the calendar by close date and falls back to log date', () => {
    const rows = [
      trade({ closedAt: '2026-01-05T16:00:00.000Z' }),
      trade({ result: 'loss', pnlAmount: -20, closedAt: '2026-01-05T18:00:00.000Z' }),
      trade({ closedAt: null, timestamp: '2026-01-06T10:00:00.000Z' }),
    ];

    const { calendar } = computeAnalytics(rows);
    expect(calendar.map((d) => d.date)).toEqual(['2026-01-05', '2026-01-06']);
    expect(calendar[0]).toMatchObject({ trades: 2, wins: 1, losses: 1, net: 80 });
    expect(calendar[1]).toMatchObject({ trades: 1, net: 100 });
  });

  it('segments by symbol, tag, session, and weekday', () => {
    const rows = [
      trade({ setupTags: ['Sweep'] }),
      trade({ symbol: 'US100', setupTags: ['IFVG'], timestamp: '2026-01-06T01:00:00.000Z' }), // 8 PM ET Mon
      trade({ symbol: 'EURUSD' as never, setupTags: [], pnlAmount: null, rMultiple: null }),
    ];

    const { bySymbol, byTag, bySession, byWeekday } = computeAnalytics(rows);

    expect(bySymbol.XAUUSD).toMatchObject({ trades: 1, net: 100 });
    expect(bySymbol.EURUSD.net).toBeNull(); // percent-only bucket, not zero
    expect(byTag.Sweep.trades).toBe(1);
    expect(byTag.IFVG.trades).toBe(1);
    expect(bySession['NY Evening (8P-12A ET)'].trades).toBe(1);
    expect(bySession['Outside NY Evening'].trades).toBe(2);
    expect(Object.keys(byWeekday).length).toBeGreaterThan(0);
  });
});

describe('dashboard series', () => {
  it('builds the running equity curve, drawdown and day statistics', () => {
    const day = (date: string, pnlAmount: number | null) =>
      trade({ closedAt: `${date}T16:00:00.000Z`, pnlAmount, result: pnlAmount !== null && pnlAmount < 0 ? 'loss' : 'win' });
    const { equity, totals } = computeAnalytics([
      day('2026-01-05', 100),
      day('2026-01-06', -150),
      day('2026-01-07', -30),
      day('2026-01-08', 200),
      day('2026-01-09', null), // no cash figure: counted as a trade, kept off the curve
    ]);

    expect(equity.map((p) => p.cumulative)).toEqual([100, -50, -80, 120]);
    expect(totals.maxDrawdown).toBe(-180); // 100 peak down to -80
    expect(totals.winningDays).toBe(2);
    expect(totals.losingDays).toBe(2);
    expect(totals.dayWinRate).toBe(50);
    expect(totals.bestDay).toEqual({ date: '2026-01-08', net: 200 });
    expect(totals.worstDay).toEqual({ date: '2026-01-06', net: -150 });
    expect(totals.winLossRatio).toBe(1.67); // 150 average win over 90 average loss
  });

  it('reports no day statistics without money data', () => {
    const { equity, totals } = computeAnalytics([trade({ pnlAmount: null })]);
    expect(equity).toEqual([]);
    expect(totals.maxDrawdown).toBeNull();
    expect(totals.dayWinRate).toBeNull();
    expect(totals.bestDay).toBeNull();
    expect(totals.winLossRatio).toBeNull();
  });

  it('tracks streaks in close order and lets breakeven trades pass through', () => {
    const at = (hour: number, result: Trade['result']) =>
      trade({ closedAt: `2026-01-05T${String(hour).padStart(2, '0')}:00:00.000Z`, result });
    const { totals } = computeAnalytics([
      at(15, 'loss'), at(10, 'win'), at(11, 'win'), at(12, 'breakeven'), at(13, 'win'), at(14, 'loss'),
    ]);

    expect(totals.longestWinStreak).toBe(3);
    expect(totals.longestLossStreak).toBe(2);
    expect(totals.currentStreak).toEqual({ result: 'loss', count: 2 });
    expect(computeAnalytics([]).totals.currentStreak).toBeNull();
  });

  it('buckets entries by New York weekday and 4-hour block, skipping unknown entry times', () => {
    const { timeHeatmap } = computeAnalytics([
      trade({ timestamp: '2026-01-05T15:00:00.000Z' }), // Mon 10 AM ET
      trade({ timestamp: '2026-01-05T16:30:00.000Z', result: 'loss', pnlAmount: -40 }), // Mon 11:30 AM ET
      trade({ timestamp: '2026-01-06T01:00:00.000Z' }), // Mon 8 PM ET
      trade({ importInfo: { dateMeaning: 'entry', datePrecision: 'date', closedPrecision: null, sourceDate: '2026-01-05', timezone: 'UTC', sourceClosedDate: null } }),
    ]);

    expect(timeHeatmap).toHaveLength(2);
    expect(timeHeatmap.find((c) => c.block === 2)).toMatchObject({ weekday: 'Mon', trades: 2, winRate: 50, net: 60 });
    expect(timeHeatmap.find((c) => c.block === 5)).toMatchObject({ weekday: 'Mon', trades: 1, winRate: 100 });
  });
});

describe('sessionOf', () => {
  it('labels 8 PM–12 AM ET as NY evening regardless of DST', () => {
    // January (EST, UTC-5): 01:00 UTC Tue = 8 PM ET Mon
    expect(sessionOf('2026-01-06T01:00:00.000Z')).toBe('NY Evening (8P-12A ET)');
    // July (EDT, UTC-4): 00:00 UTC = 8 PM ET previous day
    expect(sessionOf('2026-07-07T00:00:00.000Z')).toBe('NY Evening (8P-12A ET)');
    // 10 AM ET is outside
    expect(sessionOf('2026-01-05T15:00:00.000Z')).toBe('Outside NY Evening');
  });
});

describe('filterTrades', () => {
  it('applies account, symbol, tag, and date filters', () => {
    const rows = [
      trade({ brokerAccountId: 7, symbol: 'XAUUSD', setupTags: ['Sweep'] }),
      trade({ brokerAccountId: 9, symbol: 'US100', setupTags: ['IFVG'] }),
    ];

    expect(filterTrades(rows, { accountIds: [7] })).toHaveLength(1);
    expect(filterTrades(rows, { symbols: ['US100'] })).toHaveLength(1);
    expect(filterTrades(rows, { tags: ['IFVG'] })).toHaveLength(1);
    expect(filterTrades(rows, { from: '2026-06-01' })).toHaveLength(0);
    expect(filterTrades(rows, {})).toHaveLength(2);
  });

  it('includes trades logged during the last day of a date range', () => {
    const rows = [trade({ timestamp: '2026-01-05T15:00:00.000Z' })];

    expect(filterTrades(rows, { from: '2026-01-05', to: '2026-01-05' })).toHaveLength(1);
    expect(filterTrades(rows, { to: '2026-01-04' })).toHaveLength(0);
  });
});
