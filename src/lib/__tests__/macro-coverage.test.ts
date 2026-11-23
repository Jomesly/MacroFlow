import { describe, expect, it } from 'vitest';
import { assessMacroCoverage, COUNTRY_NAMES } from '../macro-coverage';
import type { AssetSymbol, ScoredEvent } from '../types';

const asOf = '2026-11-23T12:00:00.000Z';
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString();
const evidence = (country: string, scoreChange = 10, patch: Partial<ScoredEvent> = {}): ScoredEvent => ({
  id: `${country}:${patch.category ?? 'inflation'}:${scoreChange}`,
  category: 'inflation', title: 'Measured macro evidence', description: 'A structured observation',
  impact: 'high', country, scoreChange, evidenceType: 'trend', timestamp: at(3), ...patch,
});

describe('country-specific structured macro coverage', () => {
  it('does not call US-only evidence a complete GBPUSD backdrop', () => {
    expect(assessMacroCoverage('GBPUSD', [evidence('US')], asOf, 50)).toEqual({
      requiredCountries: ['US', 'GB'], coveredCountries: ['US'], missingCountries: ['GB'],
      supportingCountries: ['US'], opposingCountries: [],
    });
  });

  it('does not qualify domestic-only evidence without the US economy', () => {
    const coverage = assessMacroCoverage('EURUSD', [evidence('EU')], asOf, 50);
    expect(coverage.coveredCountries).toEqual(['EU']);
    expect(coverage.missingCountries).toEqual(['US']);
  });

  it.each<[AssetSymbol, string]>([
    ['GBPUSD', 'GB'], ['EURUSD', 'EU'], ['USDJPY', 'JP'], ['USDCHF', 'CH'],
    ['AUDUSD', 'AU'], ['USDCAD', 'CA'], ['NZDUSD', 'NZ'],
  ])('requires the two relevant economies for %s', (symbol, domestic) => {
    const coverage = assessMacroCoverage(symbol, [evidence('US'), evidence(domestic)], asOf, 50);
    expect(coverage.requiredCountries).toEqual(['US', domestic]);
    expect(coverage.coveredCountries).toEqual(['US', domestic]);
    expect(coverage.missingCountries).toEqual([]);
    expect(coverage.supportingCountries).toEqual(['US', domestic]);
    expect(COUNTRY_NAMES[domestic]).toBeTruthy();
  });

  it.each<AssetSymbol>(['XAUUSD', 'US100', 'US500', 'DJ30', 'BTCUSD'])(
    'keeps %s eligible with US structured support', symbol => {
      expect(assessMacroCoverage(symbol, [evidence('US')], asOf, 50)).toEqual({
        requiredCountries: ['US'], coveredCountries: ['US'], missingCountries: [],
        supportingCountries: ['US'], opposingCountries: [],
      });
    },
  );

  it.each([1, -1])('preserves pair-direction scores for a %s lean without reinverting domestic evidence', sign => {
    const coverage = assessMacroCoverage('USDJPY', [evidence('US', 12 * sign), evidence('JP', 8 * sign)], asOf, 50 * sign);
    expect(coverage.supportingCountries).toEqual(['US', 'JP']);
    expect(coverage.opposingCountries).toEqual([]);
  });

  it('retains domestic opposition instead of hiding it behind a supportive US score', () => {
    const coverage = assessMacroCoverage('GBPUSD', [evidence('US', 25), evidence('GB', -5)], asOf, 50);
    expect(coverage.missingCountries).toEqual([]);
    expect(coverage.supportingCountries).toEqual(['US']);
    expect(coverage.opposingCountries).toEqual(['GB']);
  });

  it('nets conflicting observations within each economy; a balanced country is not supporting', () => {
    const coverage = assessMacroCoverage('GBPUSD', [evidence('US'), evidence('GB', 10), evidence('GB', -10, { category: 'gdp' })], asOf, 50);
    expect(coverage.coveredCountries).toEqual(['US', 'GB']);
    expect(coverage.supportingCountries).toEqual(['US']);
    expect(coverage.opposingCountries).toEqual([]);
  });

  it('accepts explicitly country-tagged structured policy observations', () => {
    const coverage = assessMacroCoverage('GBPUSD', [evidence('US'), evidence('GB', 10, { category: 'boe_tone', evidenceType: 'surprise' })], asOf, 50);
    expect(coverage.supportingCountries).toEqual(['US', 'GB']);
  });

  it('rejects a central-bank observation tagged as the wrong economy', () => {
    const coverage = assessMacroCoverage('GBPUSD', [evidence('US'), evidence('GB', 10, { category: 'fed_tone', evidenceType: 'surprise' })], asOf, 50);
    expect(coverage.missingCountries).toEqual(['GB']);
  });

  it('does not fill domestic coverage with another country, a headline, or market data', () => {
    const coverage = assessMacroCoverage('GBPUSD', [
      evidence('US'), evidence('JP'), evidence('GB', 10, { evidenceType: 'headline' }),
      evidence('GB', 10, { evidenceType: undefined }),
      evidence('GB', 10, { evidenceType: 'market', category: 'yields' }),
      evidence('GB', 10, { category: 'dollar_strength' }),
      evidence('GB', 10, { category: 'risk_sentiment' }),
    ], asOf, 50);
    expect(coverage.coveredCountries).toEqual(['US']);
    expect(coverage.missingCountries).toEqual(['GB']);
  });

  it('normalizes country names and aliases without assuming a missing country', () => {
    const coverage = assessMacroCoverage('GBPUSD', [evidence(' United States '), evidence('UK')], asOf, 50);
    expect(coverage.supportingCountries).toEqual(['US', 'GB']);
    const unknown = assessMacroCoverage('GBPUSD', [evidence('US'), evidence('GB', 10, { country: undefined }), evidence('Atlantis')], asOf, 50);
    expect(unknown.missingCountries).toEqual(['GB']);
  });

  it.each([
    { timestamp: undefined }, { timestamp: 'invalid' }, { timestamp: at(-1) },
    { timestamp: at(48) }, { evidenceType: 'surprise' as const, timestamp: at(24) },
    { scoreChange: 0 }, { scoreChange: Number.NaN }, { scoreChange: Number.POSITIVE_INFINITY },
  ])('rejects unavailable, expired or nondirectional observations: %j', patch => {
    const coverage = assessMacroCoverage('GBPUSD', [evidence('US'), evidence('GB', 10, patch)], asOf, 50);
    expect(coverage.missingCountries).toEqual(['GB']);
  });

  it('accepts observations just inside their existing selection windows', () => {
    const coverage = assessMacroCoverage('GBPUSD', [
      evidence('US', 10, { timestamp: at(47.99) }),
      evidence('GB', 10, { evidenceType: 'surprise', timestamp: at(23.99) }),
    ], asOf, 50);
    expect(coverage.supportingCountries).toEqual(['US', 'GB']);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('has no supporting or opposing country without a finite directional lean (%s)', biasScore => {
    const coverage = assessMacroCoverage('GBPUSD', [evidence('US'), evidence('GB', -10)], asOf, biasScore);
    expect(coverage.coveredCountries).toEqual(['US', 'GB']);
    expect(coverage.supportingCountries).toEqual([]);
    expect(coverage.opposingCountries).toEqual([]);
  });

  it('treats an invalid assessment time as unavailable coverage', () => {
    expect(assessMacroCoverage('GBPUSD', [evidence('US'), evidence('GB')], 'invalid', 50)).toEqual({
      requiredCountries: ['US', 'GB'], coveredCountries: [], missingCountries: ['US', 'GB'],
      supportingCountries: [], opposingCountries: [],
    });
  });
});
