import { describe, expect, it } from 'vitest';
import { assessSignalInputs } from '../signal-inputs';
import { unknownContext } from '../macro-context';
import type { AssetSymbol, CalendarEvent, SourceHealth } from '../types';

const asOf = '2026-11-24T12:00:00.000Z';
const pairs = [
  ['GBPUSD', 'GB'], ['EURUSD', 'EU'], ['USDJPY', 'JP'], ['USDCHF', 'CH'],
  ['AUDUSD', 'AU'], ['USDCAD', 'CA'], ['NZDUSD', 'NZ'],
] as const;

function inputs(sourceHealth: SourceHealth = {}) {
  return {
    asOf, cachedAt: asOf, source: 'live' as const,
    context: { ...unknownContext(asOf), complete: true },
    sourceHealth: { finnhub: 'ok', rss: 'ok', market_data: 'ok', fred: 'ok',
      calendar_archive: 'ok', economic_calendar: 'empty', ...sourceHealth } as SourceHealth,
    calendarEvidence: { fetchedAt: asOf, archiveStatus: 'ok' as const, events: [
      { id: 'later', title: 'Later release', currency: 'USD', time: '2026-11-24T17:00:00.000Z',
        impact: 'low', forecast: null, previous: null, actual: null, affects: ['XAUUSD'] },
    ] as CalendarEvent[] },
  };
}

describe('market-scoped input health', () => {
  it.each(pairs)('requires verified %s domestic health for %s', (symbol, country) => {
    expect(assessSignalInputs({ ...inputs({ [`domestic_${country}`]: 'ok' }), symbol }).inputsHealthy).toBe(true);
    for (const status of [undefined, 'empty', 'failed'] as const) {
      const health = status ? { [`domestic_${country}`]: status } : {};
      const result = assessSignalInputs({ ...inputs(health), symbol });
      expect(result.inputsHealthy).toBe(false);
      expect(result.inputIssue).toContain('economic data');
    }
  });

  it.each(pairs)('does not pause unrelated markets when %s domestic data fails (%s)', (affected, country) => {
    const sourceHealth: SourceHealth = Object.fromEntries(pairs.map(([, key]) => [`domestic_${key}`, key === country ? 'failed' : 'ok']));
    for (const symbol of ['XAUUSD', 'US100', 'US500', 'DJ30', 'BTCUSD', ...pairs.map(([pair]) => pair)] as AssetSymbol[]) {
      expect(assessSignalInputs({ ...inputs(sourceHealth), symbol }).inputsHealthy).toBe(symbol !== affected);
    }
    // The recorder's shared gate remains open; failed pairs are blocked by their own grade.
    expect(assessSignalInputs(inputs(sourceHealth)).inputsHealthy).toBe(true);
  });

  it('keeps common provider failures global even when domestic data is healthy', () => {
    const sourceHealth: SourceHealth = { ...Object.fromEntries(pairs.map(([, country]) => [`domestic_${country}`, 'ok'])), fred: 'failed' };
    expect(assessSignalInputs(inputs(sourceHealth)).inputsHealthy).toBe(false);
    for (const symbol of ['XAUUSD', ...pairs.map(([pair]) => pair)] as AssetSymbol[]) {
      expect(assessSignalInputs({ ...inputs(sourceHealth), symbol }).inputsHealthy).toBe(false);
    }
  });

  it('does not let an unrecognized domestic key hide a configured provider failure', () => {
    const sourceHealth: SourceHealth = { domestic_GB: 'ok', domestic_UNKNOWN: 'failed' };
    expect(assessSignalInputs(inputs(sourceHealth)).inputsHealthy).toBe(false);
    expect(assessSignalInputs({ ...inputs(sourceHealth), symbol: 'GBPUSD' }).inputsHealthy).toBe(false);
    expect(assessSignalInputs({ ...inputs(sourceHealth), symbol: 'US100' }).inputsHealthy).toBe(false);
  });
});
