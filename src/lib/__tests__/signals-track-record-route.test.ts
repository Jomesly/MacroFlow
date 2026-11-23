import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ result: { data: [] as unknown[] | null, error: null as { message: string } | null } }));
vi.mock('../supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ range: async () => state.result }) }) }) }) },
}));

import { GET } from '../../app/api/signals/track-record/route';
import { FORECAST_VERSION } from '../forecast';

describe('track record endpoint', () => {
  it('summarizes resolved signals for the current version', async () => {
    state.result = { data: [{ id: 'GBPUSD:1', symbol: 'GBPUSD', side: 'long', grade: 'A', forecast_version: FORECAST_VERSION, bias_score: 55,
      issued_at: '2026-11-23T09:05:00Z', checks: [], outcome: 'win', entry_at: '2026-11-23T10:00:00Z', exit_at: '2026-11-23T14:00:00Z',
      entry_price: 1, exit_price: 1.01, return_bps: 100 }], error: null };
    const response = await GET();
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    expect(await response.json()).toMatchObject({ available: true, version: FORECAST_VERSION, overall: { A: { n: 1, wins: 1, proven: false } } });
  });

  it('reports an empty, unproven record when the table cannot be read', async () => {
    state.result = { data: null, error: { message: 'relation "signal_outcomes" does not exist' } };
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ available: false, overall: { A: { n: 0, proven: false }, B: { n: 0, proven: false } } });
  });
});
