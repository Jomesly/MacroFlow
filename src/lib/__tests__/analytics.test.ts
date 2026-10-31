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
});
