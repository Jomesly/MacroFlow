import { describe, expect, it } from 'vitest';
import { ageLabel, weightLeftPercent } from '../freshness';

const now = '2026-11-23T09:30:00.000Z';

describe('freshness labels', () => {
  it.each([
    ['2026-11-23T09:29:40.000Z', 'just now'], ['2026-11-23T08:45:00.000Z', '45 min ago'],
    ['2026-11-23T08:00:00.000Z', '1 h ago'], ['2026-11-22T09:30:00.000Z', '24 h ago'],
    ['2026-11-20T09:30:00.000Z', '3 d ago'], ['not-a-date', 'time unknown'], [undefined, 'time unknown'],
  ])('%s -> %s', (ts, label) => expect(ageLabel(ts, now)).toBe(label));

  it('halves every six hours', () => expect([0, 6, 12, 18].map(weightLeftPercent)).toEqual([100, 50, 25, 13]));
});
