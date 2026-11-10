import { describe, expect, it } from 'vitest';
import { calculateBias } from '../engine';
import { classifyEconomicEvent, classifyHeadline } from '../api/classifier';
import type { MacroEvent } from '../types';

function event(id: string, category: MacroEvent['category'], value: string, impact: MacroEvent['impact'] = 'high'): MacroEvent {
  return { id, category, value, impact, title: id, description: id, country: 'US', timestamp: '2026-11-10T00:00:00Z' };
}

describe('scoring audit regressions', () => {
  it('produces the same score and conviction regardless of feed order', () => {
    const inputs = [event('a', 'fed_tone', 'dovish'), event('b', 'fed_tone', 'dovish'), event('c', 'fed_tone', 'hawkish')];
    const permutations = [inputs, [inputs[0], inputs[2], inputs[1]], [...inputs].reverse()];
    for (const ordered of permutations) {
      const [result] = calculateBias(ordered, 'US100');
      expect(result.biasScore).toBe(40);
      expect(result.confirmationRatio).toBe(67);
      expect(result.conviction).toBe('low');
    }
  });

  it('measures agreement with the score, not with the opposing headline majority', () => {
    const [result] = calculateBias([
      event('fed', 'fed_tone', 'dovish'), event('yields', 'yields', 'falling'), event('cpi', 'inflation', 'low'),
      event('dxy1', 'dollar_strength', 'strong'), event('dxy2', 'dollar_strength', 'strong'), event('dxy3', 'dollar_strength', 'strong'),
      event('retail', 'retail_sales', 'miss'), event('pmi', 'pmi', 'miss'),
    ], 'US100');
    expect(result.biasScore).toBe(50);
    expect(result.confirmationRatio).toBe(38);
    expect(result.conviction).toBe('low');
    expect(result.signal).toBe('neutral');
  });

  it('does not count a repeated event as additional evidence', () => {
    const fed = event('fed', 'fed_tone', 'dovish');
    const [result] = calculateBias([fed, { ...fed }, { ...fed }], 'XAUUSD');
    expect(result.biasScore).toBe(30);
    expect(result.eventCount).toBe(1);
    expect(result.conviction).toBe('low');
  });

  it('deduplicates the same article signal arriving from different sources', () => {
    const fed = { ...event('feed-one', 'fed_tone', 'dovish'), url: 'https://example.com/fed-decision' };
    const [result] = calculateBias([fed, { ...fed, id: 'feed-two' }], 'XAUUSD');
    expect(result.biasScore).toBe(30);
    expect(result.eventCount).toBe(1);
    expect(result.confidenceCount).toBe(1);
    expect(result.confidenceCount).toBeLessThanOrEqual(result.totalPossibleSignals);
  });

  it('reports no directional support when contributions cancel exactly', () => {
    const [result] = calculateBias([event('dovish', 'fed_tone', 'dovish'), event('hawkish', 'fed_tone', 'hawkish')], 'US100');
    expect(result.biasScore).toBe(0);
    expect(result.confirmationRatio).toBe(0);
    expect(result.confidenceCount).toBe(0);
    expect(result.conviction).toBe('low');
  });

  it('keeps distinct dated releases that share a series URL', () => {
    const release = { ...event('release-one', 'employment', 'strong'), url: 'https://fred.stlouisfed.org/series/PAYEMS' };
    const [result] = calculateBias([release, { ...release, id: 'release-two', timestamp: '2026-10-09T00:00:00Z' }], 'US100');
    expect(result.eventCount).toBe(2);
    expect(result.biasScore).toBe(20);
  });

  it('does not use an opposing high-impact event to confirm a signal', () => {
    const [result] = calculateBias([
      event('risk', 'risk_sentiment', 'risk_on', 'medium'),
      event('yield', 'yields', 'falling', 'medium'),
      event('dxy', 'dollar_strength', 'strong', 'high'),
    ], 'US100');
    expect(result.biasScore).toBe(45);
    expect(result.conviction).toBe('low');
  });

  it('retains valid strong signals in both directions', () => {
    for (const [fed, dollar, yieldValue, direction, signal] of [
      ['dovish', 'weak', 'falling', 'bullish', 'strong_buy'],
      ['hawkish', 'strong', 'rising', 'bearish', 'strong_sell'],
    ] as const) {
      const [result] = calculateBias([event('fed', 'fed_tone', fed), event('dollar', 'dollar_strength', dollar), event('yield', 'yields', yieldValue)], 'XAUUSD');
      expect(result.direction).toBe(direction);
      expect(result.signal).toBe(signal);
      expect(result.confirmationRatio).toBe(100);
    }
  });
});

describe('economic surprise classification', () => {
  it.each(['US CPI', 'Nonfarm Payrolls', 'Unemployment Rate', 'GDP', 'Retail Sales', 'Fed Interest Rate Decision'])(
    'does not invent a surprise for %s when consensus is absent or matched', (name) => {
      expect(classifyEconomicEvent(name, 3, null)).toBeNull();
      expect(classifyEconomicEvent(name, 3, 3)).toBeNull();
      expect(classifyEconomicEvent(name, Number.NaN, 3)).toBeNull();
    },
  );
  it('handles higher unemployment and the correct central bank', () => {
    expect(classifyEconomicEvent('US Unemployment Rate', 4.2, 4)).toEqual({ category: 'employment', value: 'weak' });
    expect(classifyEconomicEvent('BoE Interest Rate Decision', 4.5, 4.25)).toEqual({ category: 'boe_tone', value: 'hawkish' });
    expect(classifyEconomicEvent('Fed Interest Rate Decision', 4, 4.25)).toEqual({ category: 'fed_tone', value: 'dovish' });
    expect(classifyEconomicEvent('ECB Interest Rate Decision', 3, 2.75)).toBeNull();
  });
  it('does not classify core retail sales as inflation', () => {
    expect(classifyEconomicEvent('Core Retail Sales', 0.5, 0.2)).toEqual({ category: 'retail_sales', value: 'beat' });
  });
});

describe('headline input safeguards', () => {
  it.each(['Fed holds rates steady', 'Bank of England holds rates unchanged', 'European Central Bank cuts interest rates'])(
    'does not invent a dovish Fed signal from "%s"', (headline) => {
      expect(classifyHeadline(headline).filter(result => result.category === 'fed_tone')).toEqual([]);
    },
  );
  it('does not infer a weak dollar from a bare XAU/USD pair mention', () => {
    expect(classifyHeadline('Gold (XAU/USD) outlook ahead of data').filter(result => result.category === 'dollar_strength')).toEqual([]);
  });
  it('does not classify a bitcoin price move as a regulatory event', () => {
    expect(classifyHeadline('Bitcoin price drops today').filter(result => result.category === 'crypto_regulation')).toEqual([]);
  });
});
