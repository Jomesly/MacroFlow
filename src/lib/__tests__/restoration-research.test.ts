import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateBias } from '../engine';
import { scoreMacroAlignment } from '../alignment';
import { buildMacroInputs } from '../macro-context';
import { RESEARCH_POLICIES as policies } from '../scoring-policy';
import { contextFixture } from './fixtures/macro';
import { captureEligibility, predictionSlot, writeImmutableJson } from '../../../scripts/lib/prediction-log';
import { evaluateDirectionFourHours } from '../backtest';
import { pairedDirectionDifference, researchSummary } from '../research-evaluation';
import type { MacroEvent } from '../types';
import type { PriceDataset } from '../market-evidence';

const asOf = '2026-11-10T12:00:00.000Z';
const { context, events: trends } = buildMacroInputs(contextFixture(), asOf);
const event = (category: MacroEvent['category'], value: string, evidenceType: MacroEvent['evidenceType'] = 'surprise', id = `${category}:${value}`): MacroEvent => ({
  id, seriesId: id, category, value, evidenceType, country: 'US', impact: 'high', title: value, description: value, timestamp: asOf,
});
const gold = [event('fed_tone', 'dovish', 'headline'), event('dollar_strength', 'weak', 'market'), event('inflation', 'low')];

describe('individual research interventions', () => {
  it('changes scale without changing raw direction or adding points, and keeps the live default isolated', () => {
    const live = scoreMacroAlignment(gold, context, asOf, 'XAUUSD')[0];
    const scale = scoreMacroAlignment(gold, context, asOf, 'XAUUSD', policies.referenceScale)[0];
    expect([live.biasScore, live.biasPercent, live.conviction]).toEqual([70, 27, 'low']);
    expect([scale.biasScore, scale.biasPercent, scale.conviction]).toEqual([70, 70, 'high']);
    expect(scale.direction).toBe(live.direction);
    expect(scoreMacroAlignment(gold, context, asOf, 'XAUUSD')[0]).toEqual(live);
  });
  it('changes activity signs only, preserving the unresolved-context qualification gate', () => {
    const activity = [event('employment', 'strong'), event('pmi', 'beat')];
    for (const regime of ['rates_sensitive', 'growth_sensitive', 'mixed', 'unknown'] as const) {
      const ctx = { ...context, regime };
      const current = calculateBias(activity, 'US100', ctx)[0];
      const fixed = scoreMacroAlignment(activity, ctx, asOf, 'US100', policies.referenceSigns)[0];
      expect(current.biasScore).toBe(regime === 'rates_sensitive' ? -20 : regime === 'growth_sensitive' ? 20 : 0);
      expect(fixed.biasScore).toBe(20);
      expect(fixed.conviction).toBe('low');
    }
  });
  it('tests weight and economic headline admission independently', () => {
    const half = calculateBias(trends, 'XAUUSD', context)[0];
    const full = calculateBias(trends, 'XAUUSD', context, policies.fullTrendWeight)[0];
    expect(full.biasScore).not.toBe(half.biasScore);
    const headline = [event('inflation', 'low', 'headline')];
    expect(scoreMacroAlignment(headline, context, asOf, 'XAUUSD')[0].biasScore).toBe(0);
    const admitted = scoreMacroAlignment(headline, context, asOf, 'XAUUSD', policies.economicHeadlines)[0];
    expect(admitted.biasScore).toBe(15);
    expect(admitted.alignment.reasons).toContain('No structured economic evidence supports the bias.');
  });
});

describe('combined restoration candidate', () => {
  it.each([1, -1])('respects displayed 49/50/51 boundaries for side %s', sign => {
    const positive = sign > 0;
    const inflation = (id: string) => event('inflation', positive ? 'cooling' : 'accelerating', 'trend', id);
    const cases = [
      [49, [event('yields', positive ? 'falling' : 'rising', 'market'), inflation('i1'), inflation('i2'), inflation('i3'), event('employment', positive ? 'weakening' : 'improving', 'trend')]],
      [50, [event('dollar_strength', positive ? 'weak' : 'strong', 'market'), event('inflation', positive ? 'low' : 'high'), event('employment', positive ? 'weak' : 'strong')]],
      [51, [event('dollar_strength', positive ? 'weak' : 'strong', 'market'), inflation('i1'), inflation('i2'), event('employment', positive ? 'weak' : 'strong')]],
    ] as const;
    for (const [points, inputs] of cases) {
      const result = scoreMacroAlignment([...inputs], context, asOf, 'XAUUSD', policies.restoration)[0];
      expect(result.biasPercent).toBe(points * sign);
      expect(result.conviction === 'high').toBe(points >= 50);
      expect(result.alignment.status === 'aligned').toBe(points >= 50);
    }
  });
  it('retains as-of filtering, country rules and category-net aggregation', () => {
    const future = { ...gold[2], timestamp: '2026-11-10T12:30:00.000Z' };
    const result = scoreMacroAlignment([...gold.slice(0, 2), future], context, asOf, 'XAUUSD', policies.restoration)[0];
    expect(result.biasScore).toBe(55);
    expect(result.conviction).toBe('low');
    expect(result.events.some(row => row.category === 'inflation')).toBe(false);
    expect(scoreMacroAlignment([{ ...gold[2], country: 'JP' }], context, asOf, 'XAUUSD', policies.restoration)[0].biasScore).toBe(0);
    const conflict = [gold[0], { ...gold[0], id: 'second' }, event('fed_tone', 'hawkish', 'headline')];
    expect(calculateBias(conflict, 'XAUUSD', context, policies.restoration)[0].biasScore).toBe(30);
    expect(calculateBias([...conflict].reverse(), 'XAUUSD', context, policies.restoration)[0].biasScore).toBe(30);
  });
});

describe('prospective logging', () => {
  const bundle = { events: [gold[0]], context, cachedAt: asOf, source: 'live' as const, sourceHealth: { fred: 'ok' as const } };
  it('rejects stale, failed, future and undocumented consensus captures without dropping their logs', () => {
    expect(captureEligibility(bundle, asOf).eligible).toBe(true);
    expect(captureEligibility(bundle, '2026-11-10T12:06:00.000Z').eligible).toBe(false);
    expect(captureEligibility({ ...bundle, sourceHealth: { fred: 'failed' } }, asOf).eligible).toBe(false);
    expect(captureEligibility({ ...bundle, events: [{ ...gold[0], timestamp: '2026-11-11T00:00:00.000Z' }] }, asOf).eligible).toBe(false);
    expect(captureEligibility({ ...bundle, events: [gold[2]] }, asOf).eligible).toBe(false);
    expect(captureEligibility({ ...bundle, events: [{ ...gold[2], releaseEvidence: { actual: 0.2, estimate: 0.3, releasedAt: asOf, consensusFirstSeenAt: '2026-11-09T00:00:00.000Z' } }] }, asOf).eligible).toBe(true);
  });
  it('publishes complete create-only JSON and never replaces the first hourly prediction', () => {
    expect(predictionSlot('2026-11-10T12:59:59.999Z')).toBe('2026-11-10T12');
    expect(predictionSlot('2026-11-10T13:00:00.001Z')).toBe('2026-11-10T13');
    expect(() => predictionSlot('invalid')).toThrow();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-research-'));
    try {
      const file = path.join(dir, 'prediction.json');
      expect(writeImmutableJson(file, { first: true })).toBe(true);
      expect(writeImmutableJson(file, { first: false })).toBe(false);
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ first: true });
      expect(fs.readdirSync(dir)).toEqual(['prediction.json']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('direction versus profitability', () => {
  it('counts a correct direction separately from a loss after costs and uses a matched baseline', () => {
    const result = scoreMacroAlignment(gold, context, asOf, 'XAUUSD', policies.restoration)[0];
    const prices: PriceDataset = { schemaVersion: 1, instrument: 'XAUUSD', provider: 'fixture', intervalMinutes: 60, fetchedAt: '2026-11-10T18:00:00.000Z',
      bars: [13, 14, 15, 16].map(hour => ({ openTime: `2026-11-10T${hour}:00:00.000Z`, closeTime: `2026-11-10T${hour + 1}:00:00.000Z`, open: 100, close: 100.01, high: 100.02, low: 99.99 })) };
    const outcome = evaluateDirectionFourHours(asOf, result, prices);
    const rows = [{ result, outcome }];
    const report = researchSummary(rows, 10, 4);
    expect(report.directionalAccuracy).toBe(1);
    expect(report.meanNetBps).toBeCloseTo(-4);
    expect(report.alwaysLongAccuracy).toBe(1);
    expect(report.priceCoverage).toBe(0.4);
    expect(pairedDirectionDifference(rows, rows).difference).toBe(0);
    const gap = { ...prices, bars: prices.bars.slice(1) };
    expect(evaluateDirectionFourHours(asOf, result, gap).rejection).toBeTruthy();
  });
});
