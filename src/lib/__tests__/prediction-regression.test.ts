import { describe, expect, it } from 'vitest';
import { calculateBias } from '../engine';
import { scoreMacroAlignment } from '../alignment';
import { buildMacroInputs } from '../macro-context';
import { classifyHeadline } from '../api/classifier';
import { contextFixture } from './fixtures/macro';
import type { MacroEvent } from '../types';

const asOf = '2026-11-10T12:00:00.000Z';
const context = buildMacroInputs(contextFixture(), asOf).context;
const event = (category: MacroEvent['category'], value: string, evidenceType: MacroEvent['evidenceType'] = 'surprise'): MacroEvent => ({
  id: `${category}:${value}`, category, value, evidenceType, country: 'US', impact: 'high',
  title: value, description: value, timestamp: asOf,
});

// Constructed boundary cases, not observed market outcomes. Gold's capacity is 260 points.
function gold(sign: number, points: 128 | 130 | 133): MacroEvent[] {
  const positive = sign > 0;
  const events = [
    event('fed_tone', positive ? 'dovish' : 'hawkish', 'headline'),
    event('dollar_strength', positive ? 'weak' : 'strong', 'market'),
    event('yields', positive ? 'falling' : 'rising', 'market'),
    event('inflation', positive ? 'low' : 'high'),
    event('employment', positive ? 'weak' : 'strong'),
    event('gdp', positive ? 'miss' : 'beat'),
    event('retail_sales', positive ? 'miss' : 'beat'),
    event('pmi', positive ? 'miss' : 'beat'),
  ];
  if (points !== 130) {
    events[3] = event('inflation', positive ? 'cooling' : 'accelerating', 'trend'); // 8 instead of 15
    events.push({ ...event('employment', positive ? 'weakening' : 'improving', 'trend'), id: 'labor-trend' }); // +5
  }
  if (points === 133) events.push({ ...event('gdp', positive ? 'contracting' : 'expanding', 'trend'), id: 'gdp-trend' });
  return events;
}

describe('production prediction regression', () => {
  it.each([1, -1])('uses displayed magnitude at 49/50/51 percent for side %s', sign => {
    for (const [points, percent] of [[128, 49], [130, 50], [133, 51]] as const) {
      const inputs = gold(sign, points);
      const raw = calculateBias(inputs, 'XAUUSD', context)[0];
      const aligned = scoreMacroAlignment(inputs, context, asOf, 'XAUUSD')[0];
      for (const result of [raw, aligned]) {
        expect(result.biasPercent).toBe(sign * percent);
        expect(result.conviction === 'high').toBe(percent >= 50);
        expect(result.signal.startsWith('strong_')).toBe(percent >= 50);
      }
      expect(aligned.alignment.status).toBe(percent >= 50 ? 'aligned' : 'conflicted');
    }
  });

  it.each([1, -1])('does not call a 27 percent reading high conviction for side %s', sign => {
    const inputs = gold(sign, 130).filter(e => ['fed_tone', 'dollar_strength', 'inflation'].includes(e.category));
    const result = scoreMacroAlignment(inputs, context, asOf, 'XAUUSD')[0];
    expect(result.biasPercent).toBe(sign * 27);
    expect(result.conviction).not.toBe('high');
    expect(result.signal).toBe('neutral');
  });

  it('updates the label and percentage together when a future CPI surprise becomes available', () => {
    const inputs = gold(1, 130);
    inputs.find(e => e.category === 'inflation')!.timestamp = '2026-11-10T12:30:00.000Z';
    const before = scoreMacroAlignment(inputs, context, asOf, 'XAUUSD')[0];
    expect(before.biasPercent).toBe(44);
    expect(before.conviction).not.toBe('high');
    expect(before.events.some(e => e.category === 'inflation')).toBe(false);
    const after = scoreMacroAlignment(inputs, context, '2026-11-10T12:30:00.000Z', 'XAUUSD')[0];
    expect(after.biasPercent).toBe(50);
    expect(after.conviction).toBe('high');
  });

  it('does not use canceled structured evidence to satisfy the primary-evidence gate', () => {
    const inputs = [event('fed_tone', 'dovish', 'headline'), event('dollar_strength', 'weak', 'market'),
      event('yields', 'falling', 'market'), event('risk_sentiment', 'risk_off', 'headline'),
      event('geopolitical', 'tension', 'headline'), event('inflation', 'low'), event('inflation', 'high')];
    const result = scoreMacroAlignment(inputs, context, asOf, 'XAUUSD')[0];
    expect(result.biasPercent).toBe(50);
    expect(result.alignment.status).toBe('insufficient_evidence');
    expect(result.conviction).toBe('low');
  });

  it('does not let uncapped market points confirm an opposing capped contribution', () => {
    const inputs = [...gold(1, 130).filter(e => !['dollar_strength', 'yields'].includes(e.category)),
      ...Array.from({ length: 3 }, (_, i) => ({ ...event('dollar_strength', 'weak', 'market'), id: `dxy-${i}`, seriesId: `dxy-${i}` })),
      ...Array.from({ length: 2 }, (_, i) => ({ ...event('yields', 'rising', 'market'), id: `yield-${i}`, seriesId: `yield-${i}` }))];
    const result = scoreMacroAlignment(inputs, context, asOf, 'XAUUSD')[0];
    // Dollar +75 caps at +25; yields -40 cap at -30. Net market evidence is -5, not +35.
    expect(result.biasScore).toBeGreaterThan(0);
    expect(result.alignment.marketConfirmation).toBe('opposing');
  });
});

describe('headlines captured from production on 2026-11-10', () => {
  it('reads a recovery rather than the historical sell-off it recovered from', () => {
    expect(classifyHeadline("Stocks extend recovery from Thursday's sell-off. Plus, new trial data from Lilly, J&J")
      .filter(e => e.category === 'risk_sentiment').map(e => e.value)).toEqual(['risk_on']);
  });
  it('does not attribute a Bitcoin decline to the stock market', () => {
    expect(classifyHeadline('Bitcoin breaks with stocks, declines as ETF outflows mount, MARA reduces holdings')
      .filter(e => e.category === 'risk_sentiment')).toEqual([]);
  });
  it.each(['Stocks decline after inflation data', 'Markets are falling sharply', 'Equities plunge on rate fears'])(
    'preserves direct broad-market declines: %s', text => {
      expect(classifyHeadline(text).some(e => e.category === 'risk_sentiment' && e.value === 'risk_off')).toBe(true);
    });
});
