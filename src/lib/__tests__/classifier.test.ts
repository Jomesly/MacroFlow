import { describe, expect, it } from 'vitest';
import { classifyHeadline } from '../api/classifier';

function hasSignal(text: string, category: string, value: string): boolean {
  return classifyHeadline(text).some((result) => result.category === category && result.value === value);
}

describe('classifyHeadline', () => {
  it('does not classify bare USD mentions as dollar strength or weakness', () => {
    const results = classifyHeadline('USD steady ahead of Fed decision');

    expect(results.filter((result) => result.category === 'dollar_strength')).toHaveLength(0);
  });

  it('does not classify bare NFP mentions as both strong and weak employment', () => {
    const results = classifyHeadline('NFP due Friday as traders await jobs data');

    expect(results.filter((result) => result.category === 'employment')).toHaveLength(0);
  });

  it('does not classify bare treasuries mentions as yield direction', () => {
    const results = classifyHeadline('Treasuries steady before inflation report');

    expect(results.filter((result) => result.category === 'yields')).toHaveLength(0);
  });

  it('does not classify bare Nasdaq mentions as risk-on or risk-off', () => {
    const results = classifyHeadline('Nasdaq awaits earnings from major technology names');

    expect(results.filter((result) => result.category === 'risk_sentiment')).toHaveLength(0);
  });

  it('still classifies clear directional headlines', () => {
    expect(hasSignal('USD gains as dollar strength returns', 'dollar_strength', 'strong')).toBe(true);
    expect(hasSignal('Nonfarm payrolls beat expectations', 'employment', 'strong')).toBe(true);
    expect(hasSignal('Treasuries sell off as yield up across curve', 'yields', 'rising')).toBe(true);
    expect(hasSignal('Nasdaq rallies as technology shares gain', 'risk_sentiment', 'risk_on')).toBe(true);
  });
});
