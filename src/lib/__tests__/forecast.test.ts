import { describe, expect, it } from 'vitest';
import { ALL_SYMBOLS } from '../engine';
import { classifyHeadline, createEventFromClassification } from '../api/classifier';
import { scoreMarketForecast } from '../forecast';
import { unknownContext } from '../macro-context';
import type { MacroEvent } from '../types';

const asOf = '2026-11-11T12:00:00.000Z';
const context = unknownContext(asOf);
const news = (text: string, timestamp = asOf, url = 'https://example.com/story', source = 'Example') =>
  classifyHeadline(text).map(row => createEventFromClassification(row, source, url, timestamp));
const predict = (events: MacroEvent[]) => scoreMarketForecast(events, context, asOf, 'USDJPY')[0];

describe('USD/JPY news coverage', () => {
  it('includes USD/JPY in the dashboard markets', () => {
    expect(ALL_SYMBOLS).toContain('USDJPY');
  });

  it('recognizes a rising pair as asset-specific bullish news', () => {
    expect(classifyHeadline('USD/JPY rallies as the yen weakens')).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'asset_sentiment', value: 'bullish', symbol: 'USDJPY' }),
    ]));
  });

  it.each([
    ['USD/JPY rallies as the yen weakens', 1],
    ['USDJPY falls as stocks rally', -1],
    ['Japanese yen weakens ahead of data', 1],
    ['Japanese yen strengthens ahead of data', -1],
    ['BoJ delays rate hikes', 1],
    ['Bank of Japan raises interest rates', -1],
  ])('forms a signed forecast without structured data: %s', (text, sign) => {
    const result = predict(news(text));
    expect(Math.sign(result.biasScore)).toBe(sign);
    expect(result.direction).toBe(sign > 0 ? 'weakly_bullish' : 'weakly_bearish');
    expect(result.forecast).toMatchObject({ basis: 'news', probability: null, horizonHours: 4 });
    expect(result.conviction).toBe('low');
    expect(result.signal).toBe('neutral');
    expect(result.alignment?.status).toBe('insufficient_evidence');
  });

  it('keeps pair narratives from spilling into other assets or inverting yen strength', () => {
    const events = news('USD/JPY rallies');
    expect(events.filter(event => event.category === 'yen_strength')).toEqual([]);
    const results = scoreMarketForecast(events, context, asOf);
    expect(results.find(result => result.symbol === 'USDJPY')?.biasScore).toBeGreaterThan(0);
    expect(results.filter(result => result.symbol !== 'USDJPY').every(result => result.biasScore === 0)).toBe(true);
  });

  it('does not infer dollar weakness from a falling USD/JPY pair', () => {
    expect(classifyHeadline('USD/JPY falls sharply').filter(row => row.category === 'dollar_strength')).toEqual([]);
  });

  it.each(['USD/JPY may rally', 'USD/JPY could fall', 'USD/JPY is not bullish', 'USD/JPY fails to rally'])('does not treat hypothetical or negated moves as directional facts: %s', text => {
    expect(classifyHeadline(text).filter(row => row.category === 'asset_sentiment')).toEqual([]);
  });

  it('decays older stories and rejects expired, future, and malformed timestamps', () => {
    const fresh = predict(news('USD/JPY rallies'));
    const old = predict(news('USD/JPY rallies', '2026-11-11T00:00:00.000Z'));
    expect(old.biasScore).toBeGreaterThan(0);
    expect(old.biasScore).toBeLessThan(fresh.biasScore);
    for (const timestamp of ['2026-11-10T12:00:00.000Z', '2026-11-12T12:00:00.000Z', 'invalid']) {
      expect(predict(news('USD/JPY rallies', timestamp)).forecast?.basis).toBe('unavailable');
    }
  });

  it('weights equally old bullish and bearish narratives symmetrically', () => {
    const timestamp = '2026-11-11T00:00:00.000Z';
    expect(predict(news('USD/JPY rallies', timestamp)).biasScore)
      .toBe(-predict(news('USD/JPY falls', timestamp)).biasScore);
  });

  it('counts a story once and resists repeated articles in the same category', () => {
    const events = news('USD/JPY rallies as the yen weakens');
    const once = predict(events);
    const repeated = predict([...events, ...events, ...news('USD/JPY rallies as the yen weakens', asOf, 'https://example.com/story?utm_source=copy')]);
    expect(repeated.biasScore).toBe(once.biasScore);
    expect(repeated.eventCount).toBe(1);
    const many = Array.from({ length: 20 }, (_, i) => news(`USD/JPY rallies on session ${i}`, asOf, `https://example.com/${i}`)).flat();
    expect(predict(many).biasScore).toBe(predict(news('USD/JPY rallies')).biasScore);
    expect(predict(many).conviction).toBe('low');
  });

  it('lets recent opposing news reverse an older narrative', () => {
    const events = [...news('USD/JPY rallies', '2026-11-11T00:00:00.000Z'), ...news('USD/JPY plunges', asOf, 'https://example.com/new')];
    expect(predict(events).biasScore).toBeLessThan(0);
    expect(predict(events).forecast?.limitations).toContain('Fresh inputs disagree on direction.');
  });

  it('allows recent news to outweigh a slow economic prior', () => {
    const trend: MacroEvent = { id: 'trend', category: 'inflation', value: 'cooling', evidenceType: 'trend', country: 'US',
      timestamp: asOf, title: 'US inflation cooling', description: 'Trend only', impact: 'high' };
    expect(predict([trend]).biasScore).toBeLessThan(0);
    const result = predict([trend, ...news('USD/JPY rallies')]);
    expect(result.biasScore).toBeGreaterThan(0);
    expect(result.forecast?.basis).toBe('mixed');
    expect(result.forecast?.macroBiasScore).toBeLessThan(0);
  });

  it('keeps no-input and exactly balanced forecasts neutral', () => {
    expect(predict([])).toMatchObject({ direction: 'neutral', biasScore: 0, conviction: 'low', forecast: { basis: 'unavailable' } });
    expect(predict([...news('USD/JPY rallies'), ...news('USD/JPY falls', asOf, 'https://example.com/opposing')]).direction).toBe('neutral');
  });
});
