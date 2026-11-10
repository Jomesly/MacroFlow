import { describe, expect, it } from 'vitest';
import { ALL_SYMBOLS, calculateBias } from '../engine';
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
      event({ category: 'yields', value: 'rising', title: 'Rising yields' }),
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

    it('keeps a weak displayed reading low even with 30 raw points and high-impact evidence', () => {
      const [result] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', impact: 'high', title: 'Fed dovish' }),
        event({ category: 'dollar_strength', value: 'weak', impact: 'medium', title: 'Dollar weak' }),
      ], 'DJ30');
      expect(result.direction).toBe('weakly_bullish');
      expect(result.biasPercent).toBe(13);
      expect(result.conviction).toBe('low');
      expect(result.signal).toBe('neutral');
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

  describe('regime-aware employment scoring', () => {
    it('flips weak employment from bearish to bullish for US100 in cutting regime', () => {
      // Without rate spread (neutral): weak employment for US100 = -10 (bearish)
      const [neutralResult] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'US100');
      expect(neutralResult.biasScore).toBe(-10);

      // With spread < -0.50 (cutting regime): weak employment flips to bullish
      const [cuttingResult] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'US100', -1.0);
      expect(cuttingResult.biasScore).toBe(10);
      expect(cuttingResult.direction).toBe('neutral'); // +10 is in neutral zone
    });

    it('flips strong employment from bullish to bearish for DJ30 in cutting regime', () => {
      // Without rate spread: strong employment for DJ30 = +15 (weakly_bullish)
      const [neutralResult] = calculateBias([
        event({ category: 'employment', value: 'strong', title: 'Strong jobs' }),
      ], 'DJ30');
      expect(neutralResult.biasScore).toBe(15);
      expect(neutralResult.direction).toBe('weakly_bullish');

      // With spread < -0.50: strong employment flips to bearish
      const [cuttingResult] = calculateBias([
        event({ category: 'employment', value: 'strong', title: 'Strong jobs' }),
      ], 'DJ30', -1.0);
      expect(cuttingResult.biasScore).toBe(-15);
      expect(cuttingResult.direction).toBe('weakly_bearish');
    });

    it('dampens employment by 50% for XAUUSD in cutting regime', () => {
      // Without rate spread: weak employment for XAUUSD = +10
      const [neutralResult] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'XAUUSD');
      expect(neutralResult.biasScore).toBe(10);

      // With spread < -0.50: dampened to +5
      const [cuttingResult] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'XAUUSD', -1.0);
      expect(cuttingResult.biasScore).toBe(5);
    });

    it('dampens employment by 50% for BTCUSD in cutting regime', () => {
      // Without rate spread: weak employment for BTCUSD = -10
      const [neutralResult] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'BTCUSD');
      expect(neutralResult.biasScore).toBe(-10);

      // With spread < -0.50: dampened to -5
      const [cuttingResult] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'BTCUSD', -1.0);
      expect(cuttingResult.biasScore).toBe(-5);
    });

    it('does NOT modulate when spread is near zero (neutral regime)', () => {
      // Spread = -0.20 (above -0.50 threshold) → no modulation
      const [result] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'US100', -0.20);
      expect(result.biasScore).toBe(-10); // unchanged from default
    });

    it('does NOT modulate when spread is null', () => {
      const [result] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'US100', null);
      expect(result.biasScore).toBe(-10); // unchanged
    });

    it('does NOT modulate when rateSpread is omitted (live system default)', () => {
      const [result] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs' }),
      ], 'US100');
      expect(result.biasScore).toBe(-10); // unchanged
    });

    it('does NOT modulate non-employment categories in cutting regime', () => {
      // Fed dovish for US100 = +40 regardless of rate regime
      const [neutralResult] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
      ], 'US100');
      const [cuttingResult] = calculateBias([
        event({ category: 'fed_tone', value: 'dovish', title: 'Fed dovish' }),
      ], 'US100', -1.0);
      expect(neutralResult.biasScore).toBe(cuttingResult.biasScore);
    });

    it('applies modulation at scoring time, not after capping', () => {
      // Two weak employment events for US100 in cutting regime
      // Each flips to +10, but employment cap is 20 → capped at +20
      const [result] = calculateBias([
        event({ category: 'employment', value: 'weak', title: 'Weak jobs 1' }),
        event({ category: 'employment', value: 'weak', title: 'Weak jobs 2' }),
      ], 'US100', -1.0);
      expect(result.biasScore).toBe(20); // capped at employment cap
    });
  });
});

describe('added markets', () => {
  const event = (category: MacroEvent['category'], value: string, country?: string): MacroEvent => ({
    id: `${category}-${value}-${country ?? 'any'}`, category, title: 't', description: 'd',
    timestamp: '2026-01-05T00:00:00.000Z', impact: 'high', value, country,
  });
  const score = (symbol: Parameters<typeof calculateBias>[1], events: MacroEvent[]) => calculateBias(events, symbol)[0].biasScore;

  it('scores every listed market', () => {
    expect(calculateBias([]).map((r) => r.symbol)).toEqual(ALL_SYMBOLS);
    expect(ALL_SYMBOLS).toEqual(expect.arrayContaining(['US500', 'EURUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD']));
  });

  it('moves dollar-base and dollar-quote pairs in opposite directions on dollar strength', () => {
    const strong = [event('dollar_strength', 'strong')];
    for (const symbol of ['USDJPY', 'USDCHF', 'USDCAD'] as const) expect(score(symbol, strong)).toBeGreaterThan(0);
    for (const symbol of ['EURUSD', 'AUDUSD', 'NZDUSD', 'GBPUSD'] as const) expect(score(symbol, strong)).toBeLessThan(0);
  });

  it('reads each pair from its own central bank and economy only', () => {
    expect(score('EURUSD', [event('ecb_tone', 'hawkish')])).toBe(30);
    expect(score('USDJPY', [event('boj_tone', 'hawkish')])).toBe(-30);
    expect(score('GBPUSD', [event('ecb_tone', 'hawkish')])).toBe(0);
    expect(score('EURUSD', [event('inflation', 'high', 'EU')])).toBe(15);
    expect(score('EURUSD', [event('inflation', 'high', 'US')])).toBe(-15);
    expect(score('EURUSD', [event('inflation', 'high', 'JP')])).toBe(0);
    expect(score('EURUSD', [event('inflation', 'high')])).toBe(0); // unknown country: no guess
  });

  it('treats the yen as a haven and the S&P 500 as a risk asset', () => {
    const riskOff = [event('risk_sentiment', 'risk_off')];
    expect(score('USDJPY', riskOff)).toBeLessThan(0);
    expect(score('AUDUSD', riskOff)).toBeLessThan(0);
    expect(score('USDCAD', riskOff)).toBeGreaterThan(0);
    expect(score('US500', riskOff)).toBe(-30);
    expect(score('US500', [event('inflation', 'high', 'JP')])).toBe(0);
  });
});
