import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAssetMomentum, fetchAssetMomentum } from '../api/asset-momentum';
import { ALL_SYMBOLS } from '../engine';
import { momentumEvent, MARKET_REFERENCES } from '../asset-momentum';
import { scoreMarketForecast } from '../forecast';
import { unknownContext } from '../macro-context';
import { classifyHeadline, createEventFromClassification } from '../api/classifier';
import type { MacroEvent } from '../types';

vi.mock('../api/cache', () => ({ getCached: vi.fn(async () => null), setCache: vi.fn(async () => undefined) }));
const asOf = '2026-11-11T16:10:00.000Z';
const quoteTime = Date.parse(asOf) / 1000;
const chart = (meta = {}) => ({ chart: { result: [{
  meta: { regularMarketTime: quoteTime, regularMarketPrice: 102, previousClose: 100, chartPreviousClose: 80, ...meta },
  timestamp: [quoteTime - 4200, quoteTime - 3900, quoteTime - 3600, quoteTime + 100],
  indicators: { quote: [{ close: [99, 101, 50, 1] }] },
}] } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('asset price ingestion', () => {
  it('uses the previous session close and only completed bars for the one-hour reference', () => {
    const event = parseAssetMomentum(chart(), 'US100', asOf)!;
    expect(event.marketMove?.previousClose).toBe(100);
    expect(event.marketMove?.sessionChangePercent).toBeCloseTo(2);
    expect(event.marketMove!.recentChangePercent).toBeCloseTo((102 / 101 - 1) * 100);
    expect(event.timestamp).toBe(asOf);
    expect(event.expiresAt).toBe('2026-11-11T16:40:00.000Z');
  });
  it.each([
    { regularMarketTime: quoteTime + 1 }, { regularMarketTime: quoteTime - 1800 },
    { regularMarketPrice: null }, { previousClose: 0 }, { regularMarketPrice: '102' },
  ])('rejects stale, future or malformed quotes: %j', meta => {
    expect(parseAssetMomentum(chart(meta), 'US100', asOf)).toBeNull();
  });
  it('labels the gold futures proxy explicitly', () => {
    expect(parseAssetMomentum(chart(), 'XAUUSD', asOf)?.marketMove).toMatchObject({ ticker: 'GC=F', proxy: true });
  });
  it('keeps other markets when one quote fails and requests a one-day baseline', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(asOf));
    const fetcher = vi.fn(async (url: string) => ({ ok: !url.includes('JPY%3DX'), json: async () => chart() }));
    vi.stubGlobal('fetch', fetcher);
    const events = await fetchAssetMomentum();
    expect(events).toHaveLength(11);
    expect(events.some(event => event.symbol === 'USDJPY')).toBe(false);
    expect(new Set(events.map(event => event.symbol)).size).toBe(11);
    expect(fetcher.mock.calls.every(([url]) => url.includes('range=1d'))).toBe(true);
  });
});

describe('market-led forecasts', () => {
  const price = (symbol: typeof ALL_SYMBOLS[number], sign = 1) => momentumEvent(symbol, {
    ...MARKET_REFERENCES[symbol], price: 100 + 3 * sign, previousClose: 100,
    sessionChangePercent: 3 * sign, recentChangePercent: 1.5 * sign,
  }, asOf);
  const news = (title: string, index = 0) => classifyHeadline(title).map(row => createEventFromClassification(row, `Publisher ${index}`, `https://example.com/${index}`, asOf));
  it.each(ALL_SYMBOLS)('%s never scores its own price action, which is left to technical analysis', symbol => {
    for (const sign of [1, -1]) {
      const [result] = scoreMarketForecast([price(symbol, sign)], unknownContext(asOf), asOf, symbol);
      expect(result.biasScore).toBe(0);
      expect(result.direction).toBe('neutral');
      expect(result.events).toEqual([]);
      expect(result.forecast?.basis).toBe('unavailable');
      expect(result.forecast?.marketMove?.sessionChangePercent).toBe(3 * sign);
    }
  });
  it('does not let a falling price overturn bullish news', () => {
    const [result] = scoreMarketForecast([price('US100', -1), ...news('Nasdaq jumps')], unknownContext(asOf), asOf, 'US100');
    expect(result.biasScore).toBeGreaterThan(0);
    expect(result.forecast?.components).not.toHaveProperty('momentum');
    expect(result.signal).toBe('buy');
  });
  it('weights fresh news 70% and macro background 30%', () => {
    const macro: MacroEvent[] = [
      { id: 'dxy', category: 'dollar_strength', value: 'strong' },
      { id: 'yield', category: 'yields', value: 'rising' },
    ].map(row => ({ ...row, category: row.category as MacroEvent['category'], title: row.id, description: row.id,
      timestamp: asOf, impact: 'high', evidenceType: 'market' }));
    const [result] = scoreMarketForecast([...macro, ...news('Nasdaq soars')], unknownContext(asOf), asOf, 'US100');
    expect(result.forecast?.components?.news?.weight).toBe(0.7);
    expect(result.forecast?.components?.macro?.weight).toBe(0.3);
    expect(result.forecast?.components?.macro?.score).toBeLessThan(0);
  });
  it.each([['QQQ jumps', 'US100'], ['SPY soars', 'US500'], ['DIA sinks', 'DJ30']] as const)('recognizes ETF narrative %s', (headline, symbol) => {
    const events = news(headline);
    const results = scoreMarketForecast(events, unknownContext(asOf), asOf);
    expect(results.find(row => row.symbol === symbol)!.biasScore).not.toBe(0);
    expect(results.filter(row => row.symbol !== symbol).every(row => row.biasScore === 0)).toBe(true);
  });
  it.each(['Greece stocks higher at close of trade; Athens General Composite up 0.53%', 'Gulf markets rise as investors assess Iran war'])(
    'does not treat foreign market reporting as a US rally: %s', headline => {
      expect(classifyHeadline(headline).some(row => row.category === 'risk_sentiment')).toBe(false);
    });
});


it('does not read rising market anxiety as rising stock prices', () => {
  const events = classifyHeadline('Market angst is driving investors into low-volatility stocks as AI trade stumbles. Anxiety in the U.S. stock market has surged amid a sharp selloff in artificial intelligence names.');
  expect(events.some(event => event.category === 'risk_sentiment' && event.value === 'risk_on')).toBe(false);
});
it('reads a broad equity futures rise as positive market news', () => {
  expect(classifyHeadline('Exchange-Traded Funds, Equity Futures Higher Pre-Bell Wednesday as Nvidia Stock Recovers'))
    .toContainEqual(expect.objectContaining({ category: 'risk_sentiment', value: 'risk_on' }));
});
