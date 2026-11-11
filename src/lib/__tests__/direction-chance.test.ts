import { describe, expect, it } from 'vitest';
import { chanceHeadline, currentDirectionChance, estimateDirectionChance, type DirectionChance } from '../direction-chance';
import { scoreMarketForecast } from '../forecast';
import { unknownContext } from '../macro-context';

const issuedAt = '2026-11-12T12:00:00.000Z';
const now = Date.parse(issuedAt);
const estimate = (score: number) => estimateDirectionChance({ momentum: { score, weight: 1 }, news: null, macro: null }, 0, issuedAt);
const result = (chance: DirectionChance) => {
  const base = scoreMarketForecast([], unknownContext(issuedAt), issuedAt, 'USDJPY')[0];
  return { ...base, forecast: { ...base.forecast!, directionChance: chance } };
};

describe('estimated four-hour direction chance', () => {
  it('uses complementary, bounded, symmetric and monotonic percentages across the entire evidence range', () => {
    let previous = 0;
    for (let score = -100; score <= 100; score++) {
      const chance = estimate(score);
      expect(chance.status).toBe('estimated');
      expect(chance.upPercent).toBeGreaterThanOrEqual(20);
      expect(chance.upPercent).toBeLessThanOrEqual(80);
      expect(chance.upPercent! + chance.downPercent!).toBeCloseTo(100);
      expect(chance.upPercent).toBeCloseTo(estimate(-score).downPercent!);
      expect(chance.upPercent).toBeGreaterThanOrEqual(previous);
      previous = chance.upPercent!;
    }
  });
  it('maps directional evidence to odds instead of appending a percent sign to a score', () => {
    expect(estimate(100)).toMatchObject({ upPercent: 80, downPercent: 20, calibration: 'unvalidated' });
    expect(estimate(50)).toMatchObject({ upPercent: 66.7, downPercent: 33.3 });
    expect(chanceHeadline(estimate(-50))).toEqual({ percent: 66.7, direction: 'down' });
  });
  it('distinguishes balanced evidence from no usable evidence', () => {
    expect(estimate(0)).toMatchObject({ status: 'estimated', upPercent: 50, downPercent: 50 });
    const absent = estimateDirectionChance({ momentum: null, news: null, macro: null }, 0, issuedAt);
    expect(absent).toMatchObject({ status: 'unavailable', upPercent: null, downPercent: null });
    expect(chanceHeadline(estimate(0))).toEqual({ percent: 50, direction: 'balanced' });
    expect(chanceHeadline(null)).toEqual({ percent: null, direction: 'unavailable' });
  });
  it('reduces certainty with missing price data and fewer news sources', () => {
    const news = { momentum: null, news: { score: 100, weight: 1 }, macro: null };
    const many = estimateDirectionChance(news, 2, issuedAt).upPercent!;
    const one = estimateDirectionChance(news, 1, issuedAt).upPercent!;
    const macro = estimateDirectionChance({ momentum: null, news: null, macro: { score: 100, weight: 1 } }, 0, issuedAt).upPercent!;
    expect(estimate(100).upPercent).toBeGreaterThan(many);
    expect(many).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(macro);
    expect(macro).toBeGreaterThan(50);
  });
  it.each([NaN, Infinity, 101, -101])('rejects invalid score %s', score => {
    expect(estimate(score).status).toBe('unavailable');
  });
  it('rejects invalid component weights', () => {
    expect(estimateDirectionChance({ momentum: { score: 50, weight: 0.6 }, news: null, macro: null }, 0, issuedAt).status).toBe('unavailable');
  });
  it('displays valid estimates only within their four-hour lifetime', () => {
    const data = result(estimate(50));
    expect(currentDirectionChance(data, now)).toEqual(data.forecast.directionChance);
    expect(currentDirectionChance(data, now - 1)).toBeNull();
    expect(currentDirectionChance(data, now + 4 * 3_600_000 - 1)).not.toBeNull();
    expect(currentDirectionChance(data, now + 4 * 3_600_000)).toBeNull();
    expect(currentDirectionChance(data, now, true)).toBeNull();
  });
  it.each([
    { upPercent: NaN }, { downPercent: Infinity }, { upPercent: 101 }, { upPercent: null },
    { upPercent: 65, downPercent: 50 }, { issuedAt: 'bad' }, { expiresAt: issuedAt }, { status: 'unavailable' as const },
  ])('hides malformed or unavailable responses: %j', change => {
    expect(currentDirectionChance(result({ ...estimate(50), ...change }), now)).toBeNull();
  });
});
