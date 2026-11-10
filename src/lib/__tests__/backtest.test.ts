import { describe, expect, it } from 'vitest';
import { evaluateFourHours, directionSign, temporalSplit, nonOverlapping, wilsonInterval, replayAt, type EvaluationRecord, type ReplaySnapshot } from '../backtest';
import { buildMacroInputs, MODEL_VERSION } from '../macro-context';
import { scoreMacroAlignment } from '../alignment';
import { buildMarketEvents, type PriceDataset } from '../market-evidence';
import { contextFixture } from './fixtures/macro';

const time = (hour: number) => new Date(Date.UTC(2026, 10, 10, hour)).toISOString();
function prices(): PriceDataset {
  return { schemaVersion: 1, instrument: 'XAUUSD', provider: 'test', intervalMinutes: 60, fetchedAt: time(23),
    bars: Array.from({ length: 10 }, (_, i) => ({ openTime: time(i + 9), closeTime: time(i + 10), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i })) };
}
function prediction(): ReplaySnapshot {
  const { context, events } = buildMacroInputs(contextFixture(), time(10));
  const [result] = scoreMacroAlignment(events, context, time(10), 'XAUUSD');
  return { schemaVersion: 1, modelVersion: MODEL_VERSION, timestamp: time(10), inputProfile: 'trend-market-only', result: { ...result, direction: 'weakly_bullish', biasScore: 30 } };
}

describe('four-hour execution', () => {
  it('uses the next open, includes only the holding interval, and subtracts round-trip costs', () => {
    const result = evaluateFourHours(prediction(), prices(), 5);
    expect(result.entryTime).toBe(time(11));
    expect(result.exitTime).toBe(time(15));
    expect(result.grossReturn).toBeCloseTo(106 / 102 - 1);
    expect(result.netReturn).toBeCloseTo(106 / 102 - 1 - 0.0005);
    expect(result.mae).toBeCloseTo(101 / 102 - 1);
  });
  it('does not use pre-entry lows or the entry bar close as the entry price', () => {
    const data = prices(); data.bars[0].low = 1; data.bars[1].low = 1;
    const result = evaluateFourHours(prediction(), data, 0);
    expect(result.mae).toBeGreaterThan(-0.02);
    expect(result.grossReturn).toBeCloseTo(106 / 102 - 1);
  });
  it('rejects daily data and missing hours instead of fabricating four-hour returns', () => {
    expect(evaluateFourHours(prediction(), { ...prices(), intervalMinutes: 1440 }).netReturn).toBeNull();
    const data = prices(); data.bars.splice(3, 1);
    expect(evaluateFourHours(prediction(), data).rejection).toContain('gap');
    expect(evaluateFourHours(prediction(), { ...prices(), bars: prices().bars.slice(0, 4) }).netReturn).toBeNull();
  });
  it('treats leaning directions as directional predictions and neutral as no trade', () => {
    expect(directionSign('weakly_bullish')).toBe(1);
    expect(directionSign('weakly_bearish')).toBe(-1);
    const bearish = prediction(); bearish.result.direction = 'weakly_bearish';
    expect(evaluateFourHours(bearish, prices(), 0).netReturn).toBeLessThan(0);
    bearish.result.direction = 'neutral';
    expect(evaluateFourHours(bearish, prices()).rejection).toBe('Neutral prediction');
  });
});

describe('validation separation', () => {
  function row(hour: number, symbol: EvaluationRecord['symbol'] = 'XAUUSD'): EvaluationRecord {
    return { timestamp: time(hour), symbol, direction: 'bullish', score: 60, regime: 'mixed', qualified: true,
      entryTime: time(hour), exitTime: time(hour + 4), grossReturn: 0.01, netReturn: 0.0095, longNetReturn: 0.0095, shortNetReturn: -0.0105, mae: -0.005, rejection: null };
  }
  it('keeps all assets at the cutoff together and purges overlapping development labels', () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(hour => [row(hour), row(hour, 'GBPUSD')]);
    const split = temporalSplit(rows);
    expect(split.cutoff).toBe(time(7));
    expect(split.development.every(record => record.exitTime! < time(7))).toBe(true);
    expect(split.holdout.filter(record => record.timestamp === time(7))).toHaveLength(2);
  });
  it('counts non-overlapping positions per asset', () => {
    expect(nonOverlapping([row(0), row(1), row(4), row(1, 'GBPUSD')])).toHaveLength(3);
  });
  it('does not equate a few wins with a high-confidence edge', () => {
    expect(wilsonInterval(3, 3)![0]).toBeLessThan(0.5);
    expect(wilsonInterval(0, 0)).toBeNull();
  });
});

describe('production and replay parity', () => {
  it('scores the same inputs identically and does not consume future market bars', () => {
    const asOf = time(10), fixture = contextFixture();
    const { context, events } = buildMacroInputs(fixture, asOf);
    const markets = { DXY: { ...prices(), instrument: 'DXY', bars: [
      { openTime: time(-2), closeTime: time(-1), open: 99, high: 100, low: 98, close: 99 }, ...prices().bars,
    ] } };
    expect(buildMarketEvents(markets, asOf)).toHaveLength(1);
    const live = scoreMacroAlignment([...events, ...buildMarketEvents(markets, asOf)], context, asOf);
    expect(replayAt(asOf, fixture, markets).map(row => row.result)).toEqual(live);
    const modified = { DXY: { ...markets.DXY, bars: markets.DXY.bars.map(bar => Date.parse(bar.closeTime) > Date.parse(asOf) ? { ...bar, open: 900, high: 1000, low: 800, close: 950 } : bar) } };
    expect(replayAt(asOf, fixture, modified)).toEqual(replayAt(asOf, fixture, markets));
  });
});
