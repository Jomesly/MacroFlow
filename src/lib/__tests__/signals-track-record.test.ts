import { describe, expect, it } from 'vitest';
import { gradeLabel, summarizeTrackRecord } from '../signals/track-record';
import type { SignalRow } from '../signals/types';

const VERSION = 'v4';
/** `n` resolved A signals with `wins` wins, entries spread over `days` distinct days. */
function rows(n: number, wins: number, days: number, patch: Partial<SignalRow> = {}): SignalRow[] {
  return Array.from({ length: n }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, 1 + (i % days), 10)).toISOString();
    return { id: `GBPUSD:${i}`, symbol: 'GBPUSD', side: 'long', grade: 'A', forecastVersion: VERSION, biasScore: 55, issuedAt: day,
      checks: [], outcome: i < wins ? 'win' : 'loss', entryAt: day, exitAt: day, entryPrice: 1, exitPrice: 1, returnBps: i < wins ? 10 : -10, ...patch };
  });
}

describe('track record', () => {
  it('starts empty and unproven', () => {
    expect(summarizeTrackRecord([], VERSION).overall.A).toEqual({ n: 0, wins: 0, hitRate: null, interval95: null, days: 0, avgReturnBps: null, proven: false });
  });
  it('proves a grade with 70 wins of 100 over 30 days', () => {
    const stats = summarizeTrackRecord(rows(100, 70, 30), VERSION).overall.A;
    expect(stats).toMatchObject({ n: 100, wins: 70, hitRate: 0.7, days: 30, avgReturnBps: 4, proven: true });
    expect(stats.interval95?.[0]).toBeCloseTo(0.604, 3);
  });
  it('does not prove 60 of 100: the 95% range still reaches 50%', () =>
    expect(summarizeTrackRecord(rows(100, 60, 30), VERSION).overall.A.proven).toBe(false));
  it('does not prove a strong record from too few days', () =>
    expect(summarizeTrackRecord(rows(120, 80, 29), VERSION).overall.A.proven).toBe(false));
  it('counts only resolved signals of the current version', () => {
    const mixed = [...rows(3, 2, 3), ...rows(2, 2, 2, { forecastVersion: 'v3' }), ...rows(1, 0, 1, { outcome: 'open' }), ...rows(1, 0, 1, { outcome: 'void' })];
    expect(summarizeTrackRecord(mixed, VERSION).overall.A).toMatchObject({ n: 3, wins: 2 });
  });
  it('keeps each market’s own record', () => {
    const record = summarizeTrackRecord([...rows(2, 1, 2), ...rows(1, 1, 1, { symbol: 'USDJPY', grade: 'B' })], VERSION);
    expect(record.bySymbol.GBPUSD?.A.n).toBe(2);
    expect(record.bySymbol.USDJPY?.B).toMatchObject({ n: 1, wins: 1 });
    expect(record.overall.B.n).toBe(1);
  });
});

describe('grade label', () => {
  const a = { grade: 'A' as const, side: 'long' as const, checks: [] };
  it('says High probability only for a proven grade', () => {
    const stats = { n: 180, wins: 115, hitRate: 115 / 180, interval95: [0.57, 0.71] as [number, number], days: 40, avgReturnBps: 3, proven: true };
    expect(gradeLabel(a, stats)).toEqual({ badge: 'A signal · Long', detail: 'High probability · right 64% of the time over 4 h (all markets, n=180)' });
  });
  it('shows progress toward proof otherwise', () => {
    const stats = { n: 23, wins: 15, hitRate: 15 / 23, interval95: [0.45, 0.81] as [number, number], days: 9, avgReturnBps: 2, proven: false };
    expect(gradeLabel(a, stats).detail).toBe('Unproven · 23/100 results');
    expect(gradeLabel(a, undefined).detail).toBe('Unproven · 0/100 results');
  });
  it('gives a lean no detail', () => expect(gradeLabel({ grade: 'none', side: null, checks: [] }, undefined)).toEqual({ badge: 'Lean only', detail: '' }));
});
