import { describe, expect, it } from 'vitest';
import { resolveSignal } from '../signals/resolve';
import type { IntradayBar } from '../market-evidence';

const bar = (openTime: string, open: number, close: number): IntradayBar => ({
  openTime, closeTime: new Date(Date.parse(openTime) + 3_600_000).toISOString(),
  open, high: Math.max(open, close) + 0.001, low: Math.min(open, close) - 0.001, close,
});
const issuedAt = '2026-11-23T10:05:00.000Z';
const bars = [
  bar('2026-11-23T11:00:00.000Z', 1.2, 1.201), bar('2026-11-23T12:00:00.000Z', 1.201, 1.202),
  bar('2026-11-23T13:00:00.000Z', 1.202, 1.2025), bar('2026-11-23T14:00:00.000Z', 1.2025, 1.203),
];
const later = '2026-11-23T18:00:00.000Z';

describe('resolving a signal after four hours', () => {
  it('scores a long that rose as a win', () => {
    expect(resolveSignal({ issuedAt, side: 'long' }, bars, later)).toEqual({ outcome: 'win', entryAt: '2026-11-23T11:00:00.000Z',
      exitAt: '2026-11-23T15:00:00.000Z', entryPrice: 1.2, exitPrice: 1.203, returnBps: 25 });
  });
  it('scores a short against the same move as a loss', () =>
    expect(resolveSignal({ issuedAt, side: 'short' }, bars, later)).toMatchObject({ outcome: 'loss', returnBps: -25 }));
  it('counts an unchanged price as a loss', () => {
    const flat = bars.map((b, i) => (i === 3 ? { ...b, close: 1.2 } : b));
    expect(resolveSignal({ issuedAt, side: 'long' }, flat, later)).toMatchObject({ outcome: 'loss', returnBps: 0 });
  });
  it('voids a window with a missing hour', () =>
    expect(resolveSignal({ issuedAt, side: 'long' }, bars.filter((_, i) => i !== 2), later)).toMatchObject({ outcome: 'void', returnBps: null }));
  it('stays open until the four hours have closed', () =>
    expect(resolveSignal({ issuedAt, side: 'long' }, bars, '2026-11-23T13:30:00.000Z')).toMatchObject({ outcome: 'open', entryAt: null }));
  it('counts four trading hours across the one-hour daily futures break', () => {
    const futures = [bar('2026-11-23T19:00:00.000Z', 1, 1.002), bar('2026-11-23T20:00:00.000Z', 1.002, 1.004),
      bar('2026-11-23T21:00:00.000Z', 1.004, 1.006), bar('2026-11-23T23:00:00.000Z', 1.006, 1.01)];
    expect(resolveSignal({ issuedAt: '2026-11-23T18:05:00.000Z', side: 'long' }, futures, '2026-11-24T00:30:00.000Z'))
      .toMatchObject({ outcome: 'win', entryAt: '2026-11-23T19:00:00.000Z', exitAt: '2026-11-24T00:00:00.000Z', returnBps: 100 });
  });
  it('still voids a window broken by an overnight close', () => {
    const cash = [bar('2026-11-23T19:30:00.000Z', 1, 1.01), bar('2026-11-23T20:30:00.000Z', 1.01, 1.02),
      bar('2026-11-24T14:30:00.000Z', 1.02, 1.03), bar('2026-11-24T15:30:00.000Z', 1.03, 1.04)];
    expect(resolveSignal({ issuedAt: '2026-11-23T18:35:00.000Z', side: 'long' }, cash, '2026-11-24T18:00:00.000Z')).toMatchObject({ outcome: 'void' });
  });
  it('voids a signal issued while the market is closed, never a loss', () => {
    const weekend = [bar('2026-11-22T22:00:00.000Z', 1.2, 1.21)];
    expect(resolveSignal({ issuedAt: '2026-11-21T10:05:00.000Z', side: 'long' }, weekend, '2026-11-21T17:00:00.000Z')).toMatchObject({ outcome: 'void' });
  });
});
