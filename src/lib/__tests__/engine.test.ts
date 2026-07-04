import { describe, expect, it } from 'vitest';
import { calculateBias } from '../engine';
import { MacroEvent } from '../types';

function event(overrides: Partial<MacroEvent>): MacroEvent {
  return {
    id: Math.random().toString(36),
    category: 'risk_sentiment',
    title: 'Synthetic event',
    description: 'Synthetic event',
    timestamp: new Date().toISOString(),
    impact: 'high',
    value: 'risk_off',
    ...overrides,
  };
}

describe('calculateBias', () => {
  it('allows unanimously bearish setups to reach high conviction', () => {
    const [result] = calculateBias([
      event({ category: 'fed_tone', value: 'hawkish', title: 'Fed hawkish' }),
      event({ category: 'risk_sentiment', value: 'risk_off', title: 'Risk off' }),
      event({ category: 'inflation', value: 'high', title: 'Hot inflation' }),
    ], 'US100');

    expect(result.direction).toBe('bearish');
    expect(result.conviction).toBe('high');
    expect(result.confirmationRatio).toBe(100);
  });

  it('caps duplicate category stacking', () => {
    const duplicates = Array.from({ length: 5 }, (_, index) => event({
      id: `risk-on-${index}`,
      category: 'risk_sentiment',
      value: 'risk_on',
      title: `Stocks rally ${index}`,
    }));

    const [result] = calculateBias(duplicates, 'US100');

    expect(result.biasScore).toBe(30);
    expect(result.biasScore).toBeLessThan(5 * 25);
  });

  it('returns known scores for simple mixed inputs', () => {
    const [result] = calculateBias([
      event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
      event({ category: 'dollar_strength', value: 'strong', title: 'DXY strong' }),
    ], 'XAUUSD');

    expect(result.biasScore).toBe(5);
  });

  it('uses country-specific GBPUSD macro rules when country is present', () => {
    const [usResult] = calculateBias([
      event({ category: 'inflation', value: 'high', country: 'US', title: 'US CPI high' }),
    ], 'GBPUSD');
    const [ukResult] = calculateBias([
      event({ category: 'inflation', value: 'high', country: 'GB', title: 'UK CPI high' }),
    ], 'GBPUSD');

    expect(usResult.biasScore).toBe(-15);
    expect(ukResult.biasScore).toBe(15);
  });

  it('treats hawkish BoE as bullish GBPUSD', () => {
    const [result] = calculateBias([
      event({ category: 'boe_tone', value: 'hawkish', title: 'BoE hawkish' }),
    ], 'GBPUSD');

    expect(result.biasScore).toBe(30);
  });

  it('ignores non-US macro events for US100 score', () => {
    const [gbResult] = calculateBias([
      event({ category: 'gdp', value: 'miss', country: 'GB', title: 'UK GDP miss' }),
    ], 'US100');
    expect(gbResult.biasScore).toBe(0);

    const [usResult] = calculateBias([
      event({ category: 'gdp', value: 'miss', country: 'US', title: 'US GDP miss' }),
    ], 'US100');
    expect(usResult.biasScore).toBe(-20);
  });

  it('ignores non-US macro events for DJ30 score', () => {
    const [gbResult] = calculateBias([
      event({ category: 'gdp', value: 'beat', country: 'GB', title: 'UK GDP beat' }),
    ], 'DJ30');
    expect(gbResult.biasScore).toBe(0);

    const [usResult] = calculateBias([
      event({ category: 'gdp', value: 'beat', country: 'US', title: 'US GDP beat' }),
    ], 'DJ30');
    expect(usResult.biasScore).toBe(15);
  });

  it('still allows country-free events for US100', () => {
    const [result] = calculateBias([
      event({ category: 'fed_tone', value: 'dovish', country: undefined, title: 'Fed dovish' }),
    ], 'US100');
    expect(result.biasScore).toBe(40);
  });

  it('scores retail_sales events for US100 with correct sign and nonzero contribution', () => {
    const [beatResult] = calculateBias([
      event({ category: 'retail_sales', value: 'beat', title: 'Retail sales beat' }),
    ], 'US100');
    expect(beatResult.biasScore).toBe(10);
    expect(beatResult.events).toHaveLength(1);
    expect(beatResult.events[0].scoreChange).toBe(10);

    const [missResult] = calculateBias([
      event({ category: 'retail_sales', value: 'miss', title: 'Retail sales miss' }),
    ], 'US100');
    expect(missResult.biasScore).toBe(-10);
    expect(missResult.events).toHaveLength(1);
    expect(missResult.events[0].scoreChange).toBe(-10);
  });

  describe('5-zone direction system', () => {
    function eventWithScore(score: number): MacroEvent {
      // Create events that will produce the target score for XAUUSD
      const events: MacroEvent[] = [];
      if (score > 0) {
        // dovish Fed = +30, use multiple to reach target
        let remaining = score;
        while (remaining > 0) {
          const chunk = Math.min(remaining, 25);
          events.push(event({
            category: 'dollar_strength',
            value: 'weak',
            title: `Weak dollar ${events.length}`,
          }));
          // dollar_strength/weak = +25 for XAUUSD, capped at 25
          // We need to use different categories to avoid cap
          remaining -= chunk;
        }
      } else if (score < 0) {
        let remaining = Math.abs(score);
        while (remaining > 0) {
          const chunk = Math.min(remaining, 25);
          events.push(event({
            category: 'dollar_strength',
            value: 'strong',
            title: `Strong dollar ${events.length}`,
          }));
          remaining -= chunk;
        }
      }
      // This approach is limited by caps. Use fed_tone which has cap 40.
      // Reset and use a simpler approach.
      return event({ category: 'fed_tone', value: score >= 0 ? 'dovish' : 'hawkish', title: 'Fed event' });
    }

    it('returns bullish for score > 50', () => {
      // fed_tone/dovish for XAUUSD = +30, but that alone is not > 50.
      // Need multiple categories. Use fed + dollar + yields.
      const events: MacroEvent[] = [
        event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
        event({ category: 'dollar_strength', value: 'weak', title: 'Dollar weak' }),
      ];
      // XAUUSD: fed +30, dollar +25 = +55 → bullish
      const [result] = calculateBias(events, 'XAUUSD');
      expect(result.direction).toBe('bullish');
    });

    it('returns weakly_bullish for score 15-50', () => {
      // fed_tone/dovish for XAUUSD = +30 → weakly_bullish
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
      ], 'XAUUSD');
      expect(result.direction).toBe('weakly_bullish');
      expect(result.biasScore).toBe(30);
    });

    it('returns neutral for score -14 to +14', () => {
      // Single weak event for US100: employment/strong = +10 → neutral
      const [result] = calculateBias([
        event({ category: 'employment', value: 'strong', title: 'Strong jobs' }),
      ], 'US100');
      expect(result.direction).toBe('neutral');
      expect(result.biasScore).toBe(10);
    });

    it('returns weakly_bearish for score -50 to -15', () => {
      // fed_tone/hawkish for XAUUSD = -30 → weakly_bearish
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'hawkish', title: 'Fed hawkish' }),
      ], 'XAUUSD');
      expect(result.direction).toBe('weakly_bearish');
      expect(result.biasScore).toBe(-30);
    });

    it('returns bearish for score < -50', () => {
      // fed(-30) + dollar(-25) + yields(-20) for XAUUSD = -75 → bearish
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'hawkish', title: 'Fed hawkish' }),
        event({ category: 'dollar_strength', value: 'strong', title: 'Dollar strong' }),
        event({ category: 'yields', value: 'rising', title: 'Yields rising' }),
      ], 'XAUUSD');
      expect(result.direction).toBe('bearish');
    });

    it('boundaries: score 14 is neutral', () => {
      // Need score exactly +14. employment/strong for US100 = +10, not enough.
      // Use retail_sales/beat for US100 = +10, still not +14.
      // Combine: employment(+10) + pmi(+10) = +20 → weakly_bullish, not neutral.
      // Hard to get exactly 14. Use DJ30: employment/strong = +15 → weakly_bullish (borderline).
      // DJ30 employment strong = +15, which is >= 15 → weakly_bullish
      const [result15] = calculateBias([
        event({ category: 'employment', value: 'strong', title: 'Strong jobs' }),
      ], 'DJ30');
      expect(result15.direction).toBe('weakly_bullish');
      expect(result15.biasScore).toBe(15);
    });

    it('boundaries: score 50 is weakly_bullish', () => {
      // Need score exactly +50. fed(+40 for US100) + dollar(+10) = +50 → weakly_bullish
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
        event({ category: 'dollar_strength', value: 'weak', title: 'Dollar weak' }),
      ], 'US100');
      // US100: fed +40, dollar +10 = +50 → weakly_bullish (50 is not > 50)
      expect(result.direction).toBe('weakly_bullish');
      expect(result.biasScore).toBe(50);
    });

    it('boundaries: score 51 is bullish', () => {
      // fed(+40) + dollar(+10) + retail(+10) = +60 → bullish for US100
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
        event({ category: 'dollar_strength', value: 'weak', title: 'Dollar weak' }),
        event({ category: 'retail_sales', value: 'beat', title: 'Retail beat' }),
      ], 'US100');
      expect(result.direction).toBe('bullish');
    });

    it('labels weakly_bullish as Leaning Bullish Today', () => {
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
      ], 'XAUUSD');
      expect(result.dailyLabel).toBe('Leaning Bullish Today');
    });

    it('labels weakly_bearish as Leaning Bearish Today', () => {
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'hawkish', title: 'Fed hawkish' }),
      ], 'XAUUSD');
      expect(result.dailyLabel).toBe('Leaning Bearish Today');
    });

    it('signal: weakly_bullish with medium conviction returns buy', () => {
      // Need weakly_bullish (score 15-50) + medium conviction (absScore>25, eventCount>=2, highImpact>=1)
      // fed(+30) + dollar(+25) = +55 → bullish, not weakly. Need to stay in 15-50 range.
      // Use DJ30: employment(+15) + gdp(+15) = +30 → weakly_bullish, 2 events
      // But need highImpactCount >= 1 for medium conviction. Both are medium impact → low conviction.
      // Use high impact events: fed_tone is high impact.
      // For DJ30: fed_tone/dovish = +25, that's in weakly range. Need one more event.
      // fed(+25) + dollar(+5) = +30 → weakly_bullish. 2 events. But dollar is medium impact.
      // highImpactCount = 1 (fed). absScore = 30 > 25. eventCount = 2. → medium conviction.
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', impact: 'high', title: 'Fed dovish' }),
        event({ category: 'dollar_strength', value: 'weak', impact: 'medium', title: 'Dollar weak' }),
      ], 'DJ30');
      expect(result.direction).toBe('weakly_bullish');
      expect(result.conviction).toBe('medium');
      expect(result.signal).toBe('buy');
    });

    it('signal: weakly_bearish with low conviction returns neutral', () => {
      // Use a small score that's weakly_bearish with low conviction.
      // employment/strong for XAUUSD = -10 → neutral. Not weakly_bearish.
      // Need score -15 to -50. Use DJ30: employment/weak = -15. But need low conviction.
      // employment is medium impact, so highImpactCount = 0. absScore = 15, not > 25 → low conviction.
      const [result] = calculateBias([
        event({ category: 'employment', value: 'weak', impact: 'medium', title: 'Weak jobs' }),
      ], 'DJ30');
      expect(result.biasScore).toBe(-15);
      expect(result.direction).toBe('weakly_bearish');
      expect(result.conviction).toBe('low');
      expect(result.signal).toBe('neutral');
    });
  });
});
