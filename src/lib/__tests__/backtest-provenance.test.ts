import { describe, expect, it } from 'vitest';
import { changedPriceInputs, coverageLines, describePriceInput, sourceStatement, type InputProvenance } from '../../../scripts/lib/provenance';

const file = (provider: string, bars: number) => JSON.stringify({ schemaVersion: 1, instrument: 'X', provider, intervalMinutes: 60,
  fetchedAt: '2026-11-10T05:00:00.000Z', bars: Array.from({ length: bars }, () => ({})) });

function provenance(prices: InputProvenance['prices']): InputProvenance {
  return { schemaVersion: 1, prices, availabilityFetchedAt: null, availability: { XAUUSD: 'failed data-quality checks' },
    fredSnapshots: 1, fredFirstAvailableAt: null, fredLastAvailableAt: null, archivedEvents: 0 };
}

describe('backtest input provenance', () => {
  it('derives exclusions and providers from the inputs recorded at replay time', () => {
    const recorded = provenance([describePriceInput('XAUUSD', null), describePriceInput('GBPUSD', file('Yahoo Finance', 3))]);
    expect(coverageLines(recorded)).toEqual(['- XAUUSD: excluded (failed data-quality checks)',
      '- GBPUSD: 3 hourly bars from Yahoo Finance, fetched 2026-11-10T05:00:00.000Z']);
    expect(sourceStatement(recorded)).toBe('Excluded at replay time: XAUUSD. Providers: GBPUSD Yahoo Finance.');
    const gold = provenance([describePriceInput('XAUUSD', file('Twelve Data', 2)), describePriceInput('GBPUSD', file('Twelve Data', 2))]);
    expect(sourceStatement(gold)).toBe('No instrument was excluded at replay time. Providers: XAUUSD Twelve Data; GBPUSD Twelve Data.');
  });
  it('detects price files that changed after replay', () => {
    const recorded = [describePriceInput('GBPUSD', file('Yahoo Finance', 3)), describePriceInput('XAUUSD', null)];
    expect(changedPriceInputs(recorded, recorded)).toEqual([]);
    const reacquired = [describePriceInput('GBPUSD', file('Twelve Data', 3)), describePriceInput('XAUUSD', file('Twelve Data', 2))];
    expect(changedPriceInputs(recorded, reacquired)).toEqual(['GBPUSD', 'XAUUSD']);
  });
});
