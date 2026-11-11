import { describe, expect, it } from 'vitest';
import { classifyHeadline, createEventFromClassification } from '../api/classifier';
import { scoreMarketForecast } from '../forecast';
import { unknownContext } from '../macro-context';
import type { AssetSymbol } from '../types';

const asOf = '2026-11-11T12:00:00.000Z';
const context = unknownContext(asOf);
function forecast(text: string, symbol?: AssetSymbol) {
  const events = classifyHeadline(text).map(row => createEventFromClassification(row, 'Fixture', 'https://example.com/story', asOf));
  return scoreMarketForecast(events, context, asOf, symbol);
}
const markets: [AssetSymbol, string[]][] = [
  ['XAUUSD', ['XAU/USD', 'Gold']],
  ['GBPUSD', ['GBP/USD', 'Sterling', 'Cable']],
  ['USDJPY', ['USD/JPY', 'Dollar-yen']],
  ['BTCUSD', ['BTC/USD', 'Bitcoin', 'BTC']],
  ['US100', ['US100', 'Nasdaq 100', 'NAS100', 'USTEC']],
  ['DJ30', ['DJ30', 'Dow Jones', 'US30', 'WS30']],
  ['US500', ['US500', 'S&P 500', 'SP500']],
  ['EURUSD', ['EUR/USD', 'EURUSD']],
  ['USDCHF', ['USD/CHF', 'USDCHF']],
  ['AUDUSD', ['AUD/USD', 'Aussie']],
  ['USDCAD', ['USD/CAD', 'USDCAD']],
  ['NZDUSD', ['NZD/USD', 'Kiwi']],
];

describe('forecasts across every supported market', () => {
  for (const [symbol, aliases] of markets) {
    it.each(aliases)(`${symbol} recognizes bullish and bearish %s headlines without macro data`, alias => {
      for (const [verb, sign] of [['rallies', 1], ['falls', -1]] as const) {
        const [result] = forecast(`${alias} ${verb}`, symbol);
        expect(Math.sign(result.biasScore)).toBe(sign);
        expect(result.forecast?.basis).toBe('news');
        const chance = result.forecast!.directionChance!;
        expect(chance.status).toBe('estimated');
        expect(chance.calibration).toBe('unvalidated');
        expect(chance.upPercent! + chance.downPercent!).toBeCloseTo(100);
        expect(Math.sign(chance.upPercent! - chance.downPercent!)).toBe(sign);
        expect(result.conviction).toBe('low');
      }
    });

    it(`${symbol} does not let negated or conditional direction leak through another category`, () => {
      for (const text of [`${aliases[0]} is not bullish`, `${aliases[0]} may rally`, `${aliases[0]} fails to rally`]) {
        expect(forecast(text).every(result => result.biasScore === 0)).toBe(true);
      }
    });

    it(`${symbol} keeps an isolated price headline out of unrelated markets`, () => {
      const results = forecast(`${aliases[1]} rallies`);
      expect(results.find(result => result.symbol === symbol)?.biasScore).toBeGreaterThan(0);
      expect(results.filter(result => result.symbol !== symbol).every(result => result.biasScore === 0)).toBe(true);
    });
  }

  it.each([
    ['Gold rallies, Bitcoin falls', 'XAUUSD', 1],
    ['Gold rallies, Bitcoin falls', 'BTCUSD', -1],
    ['GBP/USD falls while USD/JPY rises', 'GBPUSD', -1],
    ['GBP/USD falls while USD/JPY rises', 'USDJPY', 1],
    ['Nasdaq rises despite hawkish Federal Reserve comments', 'US100', 1],
    ['Dow rallies despite hawkish Fed comments', 'DJ30', 1],
    ['Nasdaq rallies despite Fed signals rate hike', 'US100', 1],
    ['Dow rallies despite Fed signals rate hike', 'DJ30', 1],
    ['Gold and Bitcoin rally', 'XAUUSD', 1],
    ['Gold and Bitcoin rally', 'BTCUSD', 1],
    ['Gold, Bitcoin and sterling fall', 'XAUUSD', -1],
    ['Gold, Bitcoin and sterling fall', 'GBPUSD', -1],
  ] as const)('keeps each named asset direction in "%s": %s', (text, symbol, sign) => {
    expect(Math.sign(forecast(text, symbol)[0].biasScore)).toBe(sign);
  });

  it.each(['Gold miners rally', 'Bitcoin mining shares rally', 'Nasdaq-listed company gains', 'GBP/JPY rallies', 'Could Gold rally?', 'Bitcoin ETF outlook ahead of data'])(
    'does not invent a supported asset price move from "%s"', text => {
      expect(forecast(text).every(result => result.biasScore === 0)).toBe(true);
    },
  );

  it('requires explicit dollar evidence rather than interpreting a pound move as a dollar-index move', () => {
    expect(classifyHeadline('Sterling rallies').filter(row => row.category === 'dollar_strength')).toEqual([]);
    const results = forecast('Dollar rises as sterling falls');
    expect(results.find(result => result.symbol === 'USDJPY')?.biasScore).toBeGreaterThan(0);
    expect(results.find(result => result.symbol === 'GBPUSD')?.biasScore).toBeLessThan(0);
  });

  it.each([
    ['BoE cuts rates', 'GBPUSD', -1],
    ['Hawkish BoE signals tighter policy', 'GBPUSD', 1],
    ['Fed delays rate hikes', 'GBPUSD', 1],
    ['Fed delays rate hikes', 'XAUUSD', 1],
    ['BoJ delays rate cuts', 'USDJPY', -1],
  ] as const)('keeps policy tone local to its central bank: %s', (text, symbol, sign) => {
    expect(Math.sign(forecast(text, symbol)[0].biasScore)).toBe(sign);
  });

  it('does not turn a Fed hold plus a BoE cut into a dovish Fed signal', () => {
    expect(classifyHeadline('Fed holds rates while the Bank of England cuts rates').filter(row => row.category === 'fed_tone')).toEqual([]);
  });

  it('does not convert ETF mentions into positive crypto regulation', () => {
    expect(classifyHeadline('Bitcoin ETF sees outflows').filter(row => row.category === 'crypto_regulation')).toEqual([]);
    expect(classifyHeadline('SEC rejects Bitcoin ETF application').filter(row => row.category === 'crypto_regulation'))
      .toEqual([expect.objectContaining({ value: 'negative' })]);
    expect(classifyHeadline('SEC approves Bitcoin ETF application').filter(row => row.category === 'crypto_regulation'))
      .toEqual([expect.objectContaining({ value: 'positive' })]);
  });

  it('does not apply Japanese yield news as a US yield shock to gold or the pound', () => {
    const results = forecast('Japanese bond yields rise');
    expect(results.find(result => result.symbol === 'USDJPY')?.biasScore).toBeLessThan(0);
    expect(results.filter(result => result.symbol !== 'USDJPY').every(result => result.biasScore === 0)).toBe(true);
  });

  it('uses British gilt news for GBP/USD instead of treating it as US rates', () => {
    const results = forecast('British gilt yields rise');
    expect(results.find(result => result.symbol === 'GBPUSD')?.biasScore).toBeGreaterThan(0);
    expect(results.filter(result => result.symbol !== 'GBPUSD').every(result => result.biasScore === 0)).toBe(true);
  });

  it('retains broad market risk narratives without inferring them from isolated asset moves', () => {
    expect(forecast('Trade war tensions escalate', 'US100')[0].biasScore).toBeLessThan(0);
    expect(forecast('Trade deal reached', 'US100')[0].biasScore).toBeGreaterThan(0);
    expect(forecast('Global stocks rally', 'US100')[0].biasScore).toBeGreaterThan(0);
    expect(forecast('Global stocks fall', 'XAUUSD')[0].biasScore).toBeGreaterThan(0);
  });
});
