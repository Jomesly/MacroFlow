import { describe, expect, it } from 'vitest';
import { scoreMacroAlignment } from '../alignment';
import { buildMacroInputs } from '../macro-context';
import { buildMarketEvents, priceDatasetIssues, type PriceDataset } from '../market-evidence';
import { isFullCashIndexHour } from '../api/intraday';
import { classifyHeadline } from '../api/classifier';
import { contextFixture } from './fixtures/macro';
import type { MacroEvent } from '../types';

const asOf = '2026-11-10T12:00:00.000Z';
const context = buildMacroInputs(contextFixture(), asOf).context;
function event(category: MacroEvent['category'], value: string, evidenceType: MacroEvent['evidenceType'] = 'headline'): MacroEvent {
  return { id: `${category}:${value}`, category, value, evidenceType, title: value, description: value,
    country: 'US', impact: 'high', timestamp: asOf };
}
const bullish = () => [event('fed_tone', 'dovish'), event('inflation', 'low', 'surprise'), event('dollar_strength', 'weak', 'market')];

describe('four-hour alignment evidence gates', () => {
  it('applies the same activity regime to the existing S&P market as the other equity indices', () => {
    const employment = event('employment', 'strong', 'surprise');
    const growth = scoreMacroAlignment([employment], { ...context, regime: 'growth_sensitive' }, asOf, 'US500')[0];
    const rates = scoreMacroAlignment([employment], { ...context, regime: 'rates_sensitive' }, asOf, 'US500')[0];
    expect(growth.biasScore).toBeGreaterThan(0);
    expect(rates.biasScore).toBe(-growth.biasScore);
  });
  it('does not turn Boeing layoffs into a Bank of England policy signal', () => {
    expect(classifyHeadline('Boeing to cut 5% of commercial airplane workforce').some(row => row.category === 'boe_tone')).toBe(false);
    expect(classifyHeadline('BoE cuts interest rates').some(row => row.category === 'boe_tone')).toBe(true);
  });
  it('uses measured dollar/yield observations rather than price-headline proxies', () => {
    const before = scoreMacroAlignment(bullish(), context, asOf, 'XAUUSD')[0];
    const after = scoreMacroAlignment([...bullish(), event('dollar_strength', 'strong'), event('yields', 'rising')], context, asOf, 'XAUUSD')[0];
    expect(after).toEqual(before);
  });
  it('qualifies bullish and bearish alignment symmetrically without claiming probabilities', () => {
    for (const inputs of [bullish(), [event('fed_tone', 'hawkish'), event('inflation', 'high', 'surprise'), event('dollar_strength', 'strong', 'market')]]) {
      const [result] = scoreMacroAlignment(inputs, context, asOf, 'XAUUSD');
      expect(result.alignment).toMatchObject({ status: 'aligned', horizonHours: 4, probability: null, validation: 'unvalidated' });
      expect(result.conviction).toBe('high');
      expect(Math.abs(result.biasScore)).toBe(70);
    }
  });
  it('blocks headline-only alignment even with a large score', () => {
    const [result] = scoreMacroAlignment(bullish().map(row => ({ ...row, evidenceType: row.evidenceType === 'surprise' ? 'headline' : row.evidenceType })), context, asOf, 'XAUUSD');
    expect(result.alignment.status).toBe('insufficient_evidence');
    expect(result.signal).toBe('neutral');
  });
  it('distinguishes fresh flat markets from missing observations', () => {
    const [result] = scoreMacroAlignment([...bullish().slice(0, 2), event('dollar_strength', 'neutral', 'market')], context, asOf, 'XAUUSD');
    expect(result.alignment.status).toBe('conflicted');
    expect(result.alignment.reasons).toContain('Market evidence does not confirm the bias.');
  });
  it('rejects future context and expired market confirmation', () => {
    expect(scoreMacroAlignment(bullish(), { ...context, asOf: '2026-11-11T00:00:00Z' }, asOf, 'XAUUSD')[0].signal).toBe('neutral');
    const inputs = bullish(); inputs[2].timestamp = '2026-11-10T08:00:00Z';
    expect(scoreMacroAlignment(inputs, context, asOf, 'XAUUSD')[0].alignment.status).toBe('insufficient_evidence');
  });
  it('does not count a category with net opposing evidence as supportive breadth', () => {
    const inputs = [...Array.from({ length: 4 }, (_, i) => ({ ...event('fed_tone', 'dovish'), id: `fed-${i}` })),
      event('dollar_strength', 'weak', 'market'), event('inflation', 'low', 'surprise'), event('inflation', 'high')];
    const [result] = scoreMacroAlignment(inputs, context, asOf, 'XAUUSD');
    expect(result.biasScore).toBeGreaterThanOrEqual(50);
    expect(result.confirmationRatio).toBeGreaterThanOrEqual(60);
    expect(result.alignment.status).not.toBe('aligned');
  });
});

describe('intraday market data integrity', () => {
  const dataset = (): PriceDataset => ({ schemaVersion: 1, instrument: 'DXY', provider: 'test', intervalMinutes: 60, fetchedAt: asOf, bars: [
    { openTime: '2026-11-09T22:00:00Z', closeTime: '2026-11-09T23:00:00Z', open: 100, high: 100, low: 100, close: 100 },
    { openTime: '2026-11-10T11:00:00Z', closeTime: asOf, open: 100, high: 101, low: 100, close: 101 },
  ] });
  it('uses only completed fresh observations with a previous session reference', () => {
    expect(buildMarketEvents({ DXY: dataset() }, asOf)[0]?.value).toBe('strong');
    expect(buildMarketEvents({ DXY: dataset() }, '2026-11-10T11:30:00Z')).toHaveLength(0);
    expect(buildMarketEvents({ DXY: dataset() }, '2026-11-10T16:00:00Z')).toHaveLength(0);
    expect(buildMarketEvents({ DXY: { ...dataset(), bars: dataset().bars.slice(1) } }, asOf)).toHaveLength(0);
  });
  it('rejects duplicate timestamps and unverified weekend FX sessions', () => {
    const data = dataset(); data.bars.push(data.bars[0]);
    expect(priceDatasetIssues(data)).toContain('Duplicate bar timestamps');
    const fx = { ...dataset(), instrument: 'GBPUSD', bars: [{ ...dataset().bars[0], openTime: '2026-11-07T12:00:00Z', closeTime: '2026-11-07T13:00:00Z' }] };
    expect(priceDatasetIssues(fx).join()).toContain('Weekend');
  });
  it('ignores invalid or duplicate archive rows dated after the prediction', () => {
    const future = { ...dataset().bars[1], openTime: '2026-11-11T11:00:00Z', closeTime: '2026-11-11T12:00:00Z' };
    expect(buildMarketEvents({ DXY: { ...dataset(), bars: [...dataset().bars, future, future] } }, asOf)[0]?.value).toBe('strong');
    const broken = { ...future, high: 0 };
    expect(buildMarketEvents({ DXY: { ...dataset(), bars: [...dataset().bars, broken] } }, asOf)[0]?.value).toBe('strong');
    const knownDuplicate = dataset(); knownDuplicate.bars.push(knownDuplicate.bars[0]);
    expect(buildMarketEvents({ DXY: knownDuplicate }, asOf)).toHaveLength(0);
  });
  it('applies the shared DXY and yield thresholds at their exact boundaries in production', () => {
    const at = (instrument: 'DXY' | 'US10Y', prior: number, latest: number) => {
      const data = dataset(); data.instrument = instrument; data.bars[0].close = prior; data.bars[0].open = prior; data.bars[0].high = prior; data.bars[0].low = prior;
      Object.assign(data.bars[1], { open: latest, high: latest, low: latest, close: latest });
      return buildMarketEvents({ [instrument]: data }, asOf)[0]?.value;
    };
    expect(at('DXY', 100, 100.2)).toBe('strong');
    expect(at('DXY', 100, 100.19)).toBe('neutral');
    expect(at('DXY', 100, 99.8)).toBe('weak');
    expect(at('US10Y', 4, 4.03)).toBe('rising');
    expect(at('US10Y', 4, 4.02)).toBe('neutral');
    expect(at('US10Y', 4, 3.97)).toBe('falling');
  });
  it('excludes partial cash-index closing bars across daylight-saving changes', () => {
    expect(isFullCashIndexHour('2026-10-30T18:30:00Z')).toBe(true);
    expect(isFullCashIndexHour('2026-10-30T19:30:00Z')).toBe(false);
    expect(isFullCashIndexHour('2026-11-09T19:30:00Z')).toBe(true);
    expect(isFullCashIndexHour('2026-11-09T20:30:00Z')).toBe(false);
    expect(isFullCashIndexHour('2026-11-09T21:00:00Z')).toBe(false);
  });
});
