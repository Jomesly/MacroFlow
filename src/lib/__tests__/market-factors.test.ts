import { describe, expect, it } from 'vitest';
import { classifyHeadline, createEventFromClassification } from '../api/classifier';
import { scoreMarketForecast } from '../forecast';
import { unknownContext } from '../macro-context';
import { biasWord, convictionLabel, factorCounts, factorReason, marketFactors } from '../market-factors';
import type { MacroEvent } from '../types';

const asOf = '2026-11-11T12:00:00.000Z';
const news = (text: string, source: string, path: string) =>
  classifyHeadline(text).map(row => createEventFromClassification(row, source, `https://${source}.example/${path}`, asOf));
const usdjpy = (events: MacroEvent[]) => scoreMarketForecast(events, unknownContext(asOf), asOf, 'USDJPY')[0];

describe('trader conviction from news and macro factors', () => {
  const bullish = [
    ...news('USD/JPY rallies as the yen weakens', 'wire', 'a'),
    ...news('BoJ delays rate hikes', 'desk', 'b'),
    ...news('Japanese yen weakens ahead of data', 'paper', 'c'),
  ];

  it('gives high conviction to a strong one-sided story backed by several outlets', () => {
    const result = usdjpy(bullish);
    expect(result.biasScore).toBeGreaterThanOrEqual(60);
    expect(result.conviction).toBe('high');
    expect(result.signal).toBe('strong_buy');
  });

  it('withholds high conviction when every story comes from a single outlet', () => {
    const single = bullish.map(event => ({ ...event, sourceName: 'wire' }));
    expect(usdjpy(single).conviction).not.toBe('high');
  });

  it('withholds high conviction when the macro backdrop contradicts the news', () => {
    const macro: MacroEvent = { id: 'jp-yields', category: 'yields', value: 'rising', country: 'JP', evidenceType: 'market',
      timestamp: asOf, title: 'Japanese yields rising', description: 'Market data', impact: 'high' };
    const result = usdjpy([...bullish, macro]);
    expect(result.forecast?.components?.macro?.score).toBeLessThan(0);
    expect(result.conviction).not.toBe('high');
  });

  it('lists the strongest factors first with their side, once per story', () => {
    const result = usdjpy([...bullish, ...news('USD/JPY falls', 'other', 'd')]);
    const factors = marketFactors(result, 3);
    expect(factors).toHaveLength(3);
    expect(factors.every(factor => factor.kind === 'news')).toBe(true);
    expect(new Set(factors.map(factor => factor.reason)).size).toBe(3);
    expect(factorCounts(result).bearish).toBeGreaterThanOrEqual(1);
    expect(biasWord(result.direction)).toBe('Bullish');
  });

  it('does not call a single-outlet lean medium conviction when macro data contradicts it', () => {
    const single = bullish.map(event => ({ ...event, sourceName: 'wire' }));
    const against: MacroEvent = { id: 'jp-yields', category: 'yields', value: 'rising', country: 'JP', evidenceType: 'market',
      timestamp: asOf, title: 'Japanese yields rising', description: 'Market data', impact: 'high' };
    const result = usdjpy([...single, against]);
    expect(Math.abs(result.biasScore)).toBeGreaterThanOrEqual(30);
    expect(result.forecast?.components?.macro?.score).toBeLessThan(0);
    expect(result.conviction).toBe('low');
    const backed = usdjpy([...single, { ...against, value: 'falling', title: 'Japanese yields falling' }]);
    expect(backed.forecast?.components?.macro?.score).toBeGreaterThan(0);
    expect(backed.conviction).toBe('medium');
  });

  it('lists one factor per driver channel, so repeated stories do not inflate the count', () => {
    const repeated = Array.from({ length: 6 }, (_, i) => news(`Japanese yen weakens on day ${i}`, `outlet${i}`, `y${i}`)).flat();
    const result = usdjpy(repeated);
    expect(marketFactors(result, Infinity)).toHaveLength(1);
    expect(factorCounts(result)).toEqual({ bullish: 1, bearish: 0 });
    expect(marketFactors(result)[0].reason).toBe('Yen weakening');
  });

  it.each([
    [{ category: 'fed_tone', value: 'hawkish' }, 'Fed hawkish'],
    [{ category: 'yields', value: 'rising', country: 'US' }, 'US yields rising'],
    [{ category: 'yields', value: 'falling' }, 'Yields falling'],
    [{ category: 'dollar_strength', value: 'strong' }, 'US dollar strengthening'],
    [{ category: 'risk_sentiment', value: 'risk_off' }, 'Risk-off mood'],
    [{ category: 'inflation', value: 'high', country: 'GB' }, 'UK inflation hot'],
    [{ category: 'employment', value: 'weak', country: 'US' }, 'US jobs weak'],
    [{ category: 'employment', value: 'weak' }, 'Jobs weak'],
    [{ category: 'inflation', value: 'high', country: 'MIXED' }, 'Inflation hot'],
    [{ category: 'gdp', value: 'beat', country: 'OTHER' }, 'GDP beat'],
    [{ category: 'boj_tone', value: 'dovish' }, 'BoJ dovish'],
    [{ category: 'asset_sentiment', value: 'bullish' }, 'Direct report: price rising'],
  ] as const)('explains the channel %j as "%s"', (event, label) => {
    expect(factorReason(event)).toBe(label);
  });

  it('lists the factors behind the bias before a stronger opposing one', () => {
    const macro: MacroEvent = { id: 'dxy', category: 'dollar_strength', value: 'weak', evidenceType: 'market',
      timestamp: asOf, title: 'DXY lower', description: 'Market data', impact: 'high' };
    const result = usdjpy([...bullish, macro]);
    expect(result.biasScore).toBeGreaterThan(0);
    const factors = marketFactors(result, Infinity);
    const firstOpposing = factors.findIndex(factor => factor.side === 'bearish');
    expect(firstOpposing).toBeGreaterThan(0);
    expect(factors.slice(0, firstOpposing).every(factor => factor.side === 'bullish')).toBe(true);
    expect(factors.slice(firstOpposing).every(factor => factor.side === 'bearish')).toBe(true);
  });

  it('labels a market with no factors without inventing conviction', () => {
    const result = usdjpy([]);
    expect(marketFactors(result)).toEqual([]);
    expect(biasWord(result.direction)).toBe('Neutral');
    expect(convictionLabel(result)).toBe('No fresh factors');
  });
});
