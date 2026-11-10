import type { FredSnapshot, FredObservation } from '../../macro-context';

export function monthly(values: number[]): FredObservation[] {
  return values.map((value, index) => ({ date: new Date(Date.UTC(2026, 9 - index, 1)).toISOString().slice(0, 10), value: String(value) }));
}
export function contextFixture(): FredSnapshot {
  return { schemaVersion: 1, vintageDate: '2026-11-09', availableAt: '2026-11-10T00:00:00.000Z', failedSeries: [], series: {
    CPIAUCSL: monthly([313, 312, 311, 310, 307, 304, 301]),
    PAYEMS: monthly([160600, 160500, 160400, 160300, 160000, 159700, 159400]),
    UNRATE: monthly([4.3, 4.2, 4.1, 4]),
    GDPC1: [{ date: '2026-07-01', value: '23000' }, { date: '2026-04-01', value: '22900' }],
    RSXFS: monthly([700, 699, 698, 697]),
    DGS2: [{ date: '2026-11-06', value: '3.5' }], DFF: [{ date: '2026-11-08', value: '4.5' }, { date: '2026-11-06', value: '4.5' }],
  } };
}
