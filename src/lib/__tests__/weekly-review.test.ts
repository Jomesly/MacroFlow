import { describe, expect, it } from 'vitest';
import { computeWeeklyReview, weekStart } from '../weekly-review';
import type { Trade } from '../types';
const trade = (patch: Partial<Trade> = {}): Trade => ({
  id: 't1',
  symbol: 'XAUUSD',
  direction: 'long',
  timestamp: '2026-10-30T23:00:00Z',
  closedAt: '2026-11-02T00:00:00.000Z',
  entryPrice: 100,
  exitPrice: 110,
  result: 'win',
  pnlPercent: 10,
  pnlAmount: 100,
  rMultiple: 2,
  brokerAccountId: 1,
  setupTags: ['Sweep'],
  notes: 'Followed plan',
  ...patch,
});
describe('weekly reviews', () => {
  it('uses Monday UTC close dates with an exclusive next-week boundary', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    const review = computeWeeklyReview(
      [
        trade(),
        trade({ id: 't2', closedAt: '2026-11-09T00:00:00.000Z' }),
        trade({ id: 't3', result: null }),
        trade({
          id: 't4',
          closedAt: null,
          timestamp: '2026-11-08T23:59:59Z',
          pnlAmount: null,
          notes: '',
        }),
      ],
      '2026-11-08',
    );
    expect(review.trades.map((t) => t.id)).toEqual(['t1', 't4']);
    expect(review.analytics.totals).toMatchObject({
      closed: 2,
      net: 100,
      moneyCoverage: 50,
    });
    expect(review.notesCoverage).toBe(50);
  });
  it('never combines money across accounts, but preserves counts and R', () => {
    const rows = [
      trade(),
      trade({ brokerAccountId: 2, pnlAmount: -20, result: 'loss' }),
    ];
    const review = computeWeeklyReview(rows, '2026-11-03');
    expect(review.moneyComparable).toBe(false);
    expect(review.analytics.totals).toMatchObject({
      net: null,
      closed: 2,
      winRate: 50,
      avgR: 2,
    });
    expect(review.analytics.byTag.Sweep.net).toBeNull();
    expect(
      computeWeeklyReview(rows, '2026-11-03', 1).analytics.totals.net,
    ).toBe(100);
  });
  it('rejects invalid dates and gives honest empty reviews', () => {
    expect(() => weekStart('2026-02-30')).toThrow();
    expect(() => weekStart('2026-1-1')).toThrow();
    expect(computeWeeklyReview([], '2026-11-08')).toMatchObject({
      notesCoverage: null,
      tagCoverage: null,
      trades: [],
      analytics: { totals: { net: null, winRate: null } },
    });
  });
  it('compares equivalent ISO offsets numerically at the week boundary', () => {
    expect(
      computeWeeklyReview(
        [
          trade({ closedAt: '2026-11-02T00:00:00+00:00' }),
          trade({ closedAt: '2026-11-01T19:00:00-05:00' }),
        ],
        '2026-11-08',
      ).trades,
    ).toHaveLength(2);
  });
});
