import { describe, expect, it } from 'vitest';
import { articleText, classifyHeadline, createEventFromClassification } from '../api/classifier';
import { scoreMarketForecast } from '../forecast';
import { unknownContext } from '../macro-context';

const asOf = '2026-11-11T15:20:00.000Z';

describe('real-feed attribution regressions', () => {
  it.each(['Australian', 'Canadian', 'New Zealand', 'Singapore', 'Hong Kong', 'Taiwan'])(
    'does not equate %s dollar weakness with US dollar weakness', currency => {
      expect(classifyHeadline(`${currency} Dollar slips as policy outlooks diverge`).filter(event => event.category === 'dollar_strength')).toEqual([]);
    },
  );

  it('still recognizes an explicit US dollar move in a foreign currency article', () => {
    const events = classifyHeadline('Canadian Dollar slips while the US Dollar rallies');
    expect(events.filter(event => event.category === 'dollar_strength')).toEqual([
      expect.objectContaining({ value: 'strong' }),
    ]);
  });

  it.each(['Bitcoin sits out a stock rebound', 'Bitcoin trails a stock rally', 'Gold lags a rally in equities', 'Bitcoin held steady as stocks rebounded'])(
    'does not borrow a different market move in "%s"', text => {
      expect(classifyHeadline(text).filter(event => event.category === 'asset_sentiment')).toEqual([]);
    },
  );

  it('does not let the body of one sentence supply the named subject of another', () => {
    expect(classifyHeadline('Gold is stable. Bitcoin rallies.').filter(event => event.category === 'asset_sentiment'))
      .toEqual([expect.objectContaining({ symbol: 'BTCUSD', value: 'bullish' })]);
  });

  it('keeps a genuine Bitcoin rally when it follows a flat headline in a separate sentence', () => {
    expect(classifyHeadline('Bitcoin held steady. Bitcoin now rallies.').filter(event => event.category === 'asset_sentiment'))
      .toEqual([expect.objectContaining({ symbol: 'BTCUSD', value: 'bullish' })]);
  });

  it('does not read "Steve Jobs Missed Years Of Gains" as weak jobs data or an earnings miss', () => {
    const events = classifyHeadline('Cramer Says Apple Investors Who Sold After Steve Jobs Missed Years Of Gains. The Stock Is Up Nearly 3,000% Since.');
    expect(events.filter(event => event.category === 'earnings' || event.category === 'employment')).toEqual([]);
  });

  it('still reads a genuine big-tech earnings miss and weak jobs data', () => {
    expect(classifyHeadline('Apple revenue misses estimates as iPhone sales drop'))
      .toContainEqual(expect.objectContaining({ category: 'earnings', value: 'negative' }));
    expect(classifyHeadline('US jobs report disappoints as hiring slows'))
      .toContainEqual(expect.objectContaining({ category: 'employment', value: 'weak' }));
  });

  it('reads fading peace hopes as tension, not easing', () => {
    const events = classifyHeadline('WTI Oil steadies above $85 as hopes of Middle East peace agreement fades Oil prices picked up from two-month lows on Wednesday as investors start to worry about the lack of progress in negotiations to reach a peace deal in the Middle East.');
    expect(events.filter(event => event.category === 'geopolitical')).toEqual([expect.objectContaining({ value: 'tension' })]);
    expect(classifyHeadline('Israel and Hamas sign ceasefire agreement').filter(event => event.category === 'geopolitical'))
      .toEqual([expect.objectContaining({ value: 'easing' })]);
  });

  it('reads an asset reversing its gains as falling and erasing its losses as rising', () => {
    expect(classifyHeadline('Gold struggles below $4,050 as Fed rate-hike bets boost US Dollar Gold (XAU/USD) reverses its earlier gains on Wednesday as a broadly stronger US Dollar (USD) weighs on the precious metal.')
      .filter(event => event.category === 'asset_sentiment')).toEqual([expect.objectContaining({ symbol: 'XAUUSD', value: 'bearish' })]);
    expect(classifyHeadline('Bitcoin erases losses').filter(event => event.category === 'asset_sentiment'))
      .toEqual([expect.objectContaining({ symbol: 'BTCUSD', value: 'bullish' })]);
    expect(classifyHeadline('EUR/USD pares gains').filter(event => event.category === 'asset_sentiment'))
      .toEqual([expect.objectContaining({ symbol: 'EURUSD', value: 'bearish' })]);
  });

  it('keeps a headline subject from borrowing the first verb of the article body', () => {
    const text = articleText('Gold struggles below $4,050 as Fed rate-hike bets boost US Dollar',
      'Gold (XAU/USD) reverses its earlier gains on Wednesday as a broadly stronger US Dollar (USD) weighs on the precious metal.');
    const events = classifyHeadline(text);
    expect(events.filter(event => event.category === 'dollar_strength' && event.value === 'weak')).toEqual([]);
    expect(events.filter(event => event.category === 'asset_sentiment')).toEqual([expect.objectContaining({ symbol: 'XAUUSD', value: 'bearish' })]);
    expect(articleText('Stocks rally!', 'More follows')).toBe('Stocks rally! More follows');
    expect(articleText('Only a title', undefined)).toBe('Only a title');
  });

  it('isolates a foreign-dollar-only article from every supported asset', () => {
    const events = classifyHeadline('Australian Dollar slips as policy outlooks diverge')
      .map(row => createEventFromClassification(row, 'Fixture', 'https://example.com/aud', asOf));
    expect(scoreMarketForecast(events, unknownContext(asOf), asOf).every(result => result.biasScore === 0)).toBe(true);
  });

  it('returns an explicit prospective four-hour window rather than a timeless label', () => {
    const events = classifyHeadline('USD/JPY rallies')
      .map(row => createEventFromClassification(row, 'Fixture', 'https://example.com/usdjpy', asOf));
    expect(scoreMarketForecast(events, unknownContext(asOf), asOf, 'USDJPY')[0].forecast)
      .toMatchObject({ issuedAt: asOf, expiresAt: '2026-11-11T19:20:00.000Z', horizonHours: 4 });
  });
});
