import { describe, expect, it } from 'vitest';
import { classifyHeadline } from '../api/classifier';
import { calculateBias } from '../engine';
import { upsertDailySnapshot } from '../redis';
import { MacroEvent } from '../types';

const has = (text: string, category: string, value?: string) =>
  classifyHeadline(text).some((r) => r.category === category && (value === undefined || r.value === value));

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

describe('headline classifier does not misread macro', () => {
  it('does not read words containing a keyword as that keyword', () => {
    expect(has('Boeing cuts 737 output target after strike', 'boe_tone')).toBe(false);
    expect(has('Second quarter sector rotation allowed investors to rotate', 'crypto_regulation')).toBe(false);
    expect(has('Shipping costs rise on Red Sea delays', 'inflation')).toBe(false);
    expect(has('Workers down tools as factory orders drop', 'risk_sentiment', 'risk_off')).toBe(false);
  });

  it('does not read denied or fading policy moves as that move', () => {
    expect(has('Fed unlikely to cut rates this year, officials say', 'fed_tone', 'dovish')).toBe(false);
    expect(has('No rate cut expected until 2027', 'fed_tone', 'dovish')).toBe(false);
    expect(has('Traders scale back Fed cut bets after hot data', 'fed_tone', 'dovish')).toBe(false);
  });

  it('treats a hold as neither dovish nor hawkish', () => {
    expect(has('Fed holds rates steady and signals higher for longer', 'fed_tone', 'dovish')).toBe(false);
    expect(has('Bank of England holds rates at 4%', 'boe_tone', 'dovish')).toBe(false);
  });

  it('reads easing inflation as easing, not as high inflation', () => {
    expect(has('Softer oil prices ease inflation worries', 'inflation', 'high')).toBe(false);
  });

  it('drops a category when one text points both ways', () => {
    expect(has('Dollar climbs early, then dollar falls after data', 'dollar_strength')).toBe(false);
  });

  it('ignores technical price-forecast articles', () => {
    expect(classifyHeadline('EUR/USD Price Forecast: Gains ground above 1.1150, while retaining bearish bias')).toEqual([]);
  });

  it('does not score price moves as crypto regulation', () => {
    expect(has('Bitcoin drops, then pops as traders react', 'crypto_regulation')).toBe(false);
    expect(has('Bitcoin rally extends to a third week', 'crypto_regulation')).toBe(false);
    expect(has('Bitcoin ETF outflows extend for a fourth session', 'crypto_regulation', 'positive')).toBe(false);
    expect(has('SEC approves spot Bitcoin ETF', 'crypto_regulation', 'positive')).toBe(true);
  });

  it('does not infer the dollar from gold, euro or pound headlines', () => {
    expect(has('Gold holds near record as dollar traders wait', 'dollar_strength')).toBe(false);
    expect(has('Euro gains after ECB comments', 'dollar_strength')).toBe(false);
    expect(has('Pound rises on UK wage data', 'dollar_strength')).toBe(false);
  });

  it('does not treat foreign equity moves as global risk appetite', () => {
    expect(has('Chinese 6G stocks rally as Beijing pushes network upgrade', 'risk_sentiment')).toBe(false);
    expect(has('Asian stocks rebound after AI sell-off', 'risk_sentiment')).toBe(false);
    expect(has('Wall Street higher as global stocks rally', 'risk_sentiment', 'risk_on')).toBe(true);
  });

  it('does not treat fading fear as new stress', () => {
    expect(has('Recession fears ease as hiring holds up', 'gdp', 'miss')).toBe(false);
  });

  it('labels foreign and mixed-country data so it cannot score as US or UK', () => {
    expect(classifyHeadline('Japan inflation rises to 3%').find((r) => r.category === 'inflation')?.country).toBe('JP');
    expect(classifyHeadline('Eurozone CPI climbs in October').find((r) => r.category === 'inflation')?.country).toBe('EU');
    expect(classifyHeadline('UK CPI rises while US data looms').find((r) => r.category === 'inflation')?.country).toBe('MIXED');
  });
});

describe('engine scoring', () => {
  it('gives the same score whatever order events arrive in', () => {
    const dovish = (id: string) => event({ id, category: 'fed_tone', value: 'dovish' });
    const hawkish = (id: string) => event({ id, category: 'fed_tone', value: 'hawkish' });
    const first = calculateBias([dovish('a'), dovish('b'), hawkish('c')], 'XAUUSD')[0];
    const second = calculateBias([hawkish('c'), dovish('a'), dovish('b')], 'XAUUSD')[0];
    expect(first.biasScore).toBe(second.biasScore);
    expect(first.biasScore).toBe(30);
    expect(first.events.reduce((sum, e) => sum + e.scoreChange, 0)).toBe(30);
  });

  it('caps the net of a category, not the running total', () => {
    const [result] = calculateBias([
      event({ id: 'a', category: 'dollar_strength', value: 'weak' }),
      event({ id: 'b', category: 'dollar_strength', value: 'weak' }),
      event({ id: 'c', category: 'dollar_strength', value: 'strong' }),
    ], 'XAUUSD');
    expect(result.biasScore).toBe(25);
  });

  it('does not treat data with no country as UK data for GBPUSD', () => {
    expect(calculateBias([event({ category: 'inflation', value: 'high', country: undefined })], 'GBPUSD')[0].biasScore).toBe(0);
  });

  it('scores UK-labelled data the same as GB-labelled data, once', () => {
    expect(calculateBias([event({ category: 'inflation', value: 'high', country: 'UK' })], 'GBPUSD')[0].biasScore).toBe(15);
  });

  it('ignores foreign and mixed-country data for US assets and GBPUSD', () => {
    for (const country of ['JP', 'EU', 'MIXED']) {
      expect(calculateBias([event({ category: 'inflation', value: 'high', country })], 'US100')[0].biasScore).toBe(0);
      expect(calculateBias([event({ category: 'inflation', value: 'high', country })], 'GBPUSD')[0].biasScore).toBe(0);
    }
  });

  it('measures agreement with the score direction, not the larger headcount', () => {
    const [result] = calculateBias([
      event({ category: 'fed_tone', value: 'hawkish' }),
      event({ category: 'dollar_strength', value: 'strong' }),
      event({ category: 'gdp', value: 'miss', country: 'US' }),
      event({ category: 'pmi', value: 'miss', country: 'US' }),
      event({ category: 'retail_sales', value: 'miss', country: 'US' }),
    ], 'XAUUSD');
    expect(result.biasScore).toBe(-25);
    expect(result.confirmationRatio).toBe(40);
  });
});

describe('daily history snapshot', () => {
  const entry = (date: string, biasScore: number) => ({ date, direction: 'neutral' as const, biasScore });

  it('updates today instead of freezing the first read', () => {
    expect(upsertDailySnapshot([entry('2026-11-08', 5), entry('2026-11-09', -20)], entry('2026-11-09', -40), 7)).toEqual([entry('2026-11-08', 5), entry('2026-11-09', -40)]);
  });

  it('appends a new day and keeps only the newest entries', () => {
    const result = upsertDailySnapshot([entry('2026-11-08', 5), entry('2026-11-09', 6)], entry('2026-11-10', 7), 2);
    expect(result.map((e) => e.date)).toEqual(['2026-11-09', '2026-11-10']);
  });
});
