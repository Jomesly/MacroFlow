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

  it('does not classify bare ceasefire mentions as geopolitical easing', () => {
    const results = classifyHeadline('Ceasefire holding in eastern Ukraine');
    expect(results.filter((result) => result.category === 'geopolitical' && result.value === 'easing')).toHaveLength(0);
  });

  it('classifies ceasefire deal as geopolitical easing', () => {
    expect(hasSignal('Ceasefire deal reached between parties', 'geopolitical', 'easing')).toBe(true);
  });

  it('infers country from headline text for sensitive categories', () => {
    const results = classifyHeadline('UK CPI rises 0.3% as BoE holds rates');
    const inflation = results.find((r) => r.category === 'inflation');
    expect(inflation?.country).toBe('GB');
  });

  it('does not infer country for non-sensitive categories', () => {
    const results = classifyHeadline('Nasdaq rallies on tech earnings');
    const risk = results.find((r) => r.category === 'risk_sentiment');
    expect(risk?.country).toBeUndefined();
  });

  it('does not classify standalone "uncertainty" as risk_off', () => {
    const results = classifyHeadline('Fed decision creates some uncertainty ahead of the meeting');
    expect(results.filter((r) => r.category === 'risk_sentiment' && r.value === 'risk_off')).toHaveLength(0);
  });

  it('still classifies "panic selling grips markets amid crisis" as risk_off', () => {
    expect(hasSignal('panic selling grips markets amid crisis', 'risk_sentiment', 'risk_off')).toBe(true);
  });

  it('does not classify "Gold surges to new highs this week" as risk_off', () => {
    const results = classifyHeadline('Gold surges to new highs this week');
    expect(results.filter((r) => r.category === 'risk_sentiment' && r.value === 'risk_off')).toHaveLength(0);
  });

  it('does not classify BoE rate hike mention as fed_tone hawkish', () => {
    const results = classifyHeadline("Bank of England's Mann suggests reduced rate hike bets boost case for action");
    expect(results.filter((r) => r.category === 'fed_tone' && r.value === 'hawkish')).toHaveLength(0);
  });

  it('still classifies Fed rate hike mention as fed_tone hawkish', () => {
    expect(hasSignal('Fed signals rate hike as inflation persists', 'fed_tone', 'hawkish')).toBe(true);
  });

  it('still classifies clear directional headlines', () => {
    expect(hasSignal('USD gains as dollar strength returns', 'dollar_strength', 'strong')).toBe(true);
    expect(hasSignal('Nonfarm payrolls beat expectations', 'employment', 'strong')).toBe(true);
    expect(hasSignal('Treasuries sell off as yield up across curve', 'yields', 'rising')).toBe(true);
    expect(hasSignal('Nasdaq rallies as technology shares gain', 'risk_sentiment', 'risk_on')).toBe(true);
  });
});
