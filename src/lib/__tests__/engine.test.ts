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
});
