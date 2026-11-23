import { describe, expect, it } from 'vitest';
import { selectNewSignals } from '../signals/record';
import type { GradedResult } from '../bias-snapshot';

const asOf = '2026-11-23T09:05:00.000Z';
const graded = (symbol: string, grade: 'A' | 'B' | 'none', side: 'long' | 'short' | null = 'long') =>
  ({ symbol, biasScore: side === 'short' ? -55 : 55, grade: { grade, side, checks: [{ id: 'fresh_news', passed: true, label: 'x' }] } }) as unknown as GradedResult;

describe('recording signals', () => {
  it('records only A and B signals, one row per symbol and hour', () => {
    const rows = selectNewSignals([graded('GBPUSD', 'A'), graded('USDJPY', 'B', 'short'), graded('XAUUSD', 'none', null)], [], asOf, 'v4');
    expect(rows.map(row => [row.id, row.grade, row.side, row.outcome, row.forecastVersion, row.issuedAt])).toEqual([
      ['GBPUSD:2026-11-23T09', 'A', 'long', 'open', 'v4', asOf],
      ['USDJPY:2026-11-23T09', 'B', 'short', 'open', 'v4', asOf],
    ]);
  });
  it('skips a market whose last signal is under 5 hours old', () => {
    const recent = [{ symbol: 'GBPUSD' as const, issuedAt: '2026-11-23T05:00:00.000Z' }];
    expect(selectNewSignals([graded('GBPUSD', 'A')], recent, asOf, 'v4')).toEqual([]);
  });
  it('records again once 5 hours have passed', () => {
    const recent = [{ symbol: 'GBPUSD' as const, issuedAt: '2026-11-23T04:05:00.000Z' }];
    expect(selectNewSignals([graded('GBPUSD', 'A')], recent, asOf, 'v4')).toHaveLength(1);
  });
  it('gives a repeated run in the same hour the same id', () => {
    const later = '2026-11-23T09:40:00.000Z';
    expect(selectNewSignals([graded('GBPUSD', 'A')], [], later, 'v4')[0].id).toBe(selectNewSignals([graded('GBPUSD', 'A')], [], asOf, 'v4')[0].id);
  });
});
