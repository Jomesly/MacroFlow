import { describe, expect, it } from 'vitest';
import { classifyHeadline, createEventFromClassification } from '../api/classifier';
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
