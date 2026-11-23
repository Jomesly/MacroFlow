import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SignalDbRow } from '../signals/types';

const state = vi.hoisted(() => ({
  openRows: [] as unknown[], upserts: [] as unknown[][], updates: [] as Record<string, unknown>[], openQueries: 0,
}));
vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      select: (columns: string) => columns === '*'
        ? { eq: () => ({ lt: async () => { state.openQueries++; return { data: state.openRows, error: null }; } }) }
        : { gt: async () => ({ data: [], error: null }) },
      upsert: async (rows: unknown[]) => { state.upserts.push(rows); return { error: null }; },
      update: (values: Record<string, unknown>) => ({ eq: () => ({ eq: async () => { state.updates.push(values); return { error: null }; } }) }),
    }),
  },
}));
vi.mock('../bias-snapshot', () => ({ buildBiasSnapshot: vi.fn() }));
vi.mock('../api/intraday', () => ({ fetchYahooHourly: vi.fn(async () => ({ bars: [] })) }));

import { buildBiasSnapshot } from '../bias-snapshot';
import { fetchYahooHourly } from '../api/intraday';
import { POST } from '../../app/api/signals/run/route';

const SECRET = 'a'.repeat(64);
const asOf = '2026-11-23T09:05:00.000Z';
const request = (authorization?: string) => new NextRequest('http://localhost/api/signals/run',
  { method: 'POST', headers: authorization ? { authorization } : {} });
const snapshot = (inputsHealthy: boolean) => ({
  asOf, meta: { inputsHealthy, source: 'live', cachedAt: asOf, sourceHealth: {}, nextEvent: null },
  results: [{ symbol: 'GBPUSD', biasScore: 55, grade: { grade: 'A', side: 'long', checks: [] } }],
});
const openRow: SignalDbRow = { id: 'GBPUSD:2026-11-23T02', symbol: 'GBPUSD', side: 'long', grade: 'A', forecast_version: 'v4',
  bias_score: 55, issued_at: '2026-11-23T02:05:00.000Z', checks: [], outcome: 'open', entry_at: null, exit_at: null,
  entry_price: null, exit_price: null, return_bps: null };

describe('hourly signal job', () => {
  beforeEach(() => {
    vi.stubEnv('SIGNALS_CRON_SECRET', SECRET);
    Object.assign(state, { openRows: [], upserts: [], updates: [], openQueries: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects a call without the secret', async () => expect((await POST(request())).status).toBe(401));
  it('rejects a wrong secret', async () => expect((await POST(request(`Bearer ${'b'.repeat(64)}`))).status).toBe(401));
  it('refuses to run with a short configured secret', async () => {
    vi.stubEnv('SIGNALS_CRON_SECRET', 'short');
    expect((await POST(request('Bearer short'))).status).toBe(401);
  });

  it('records an A signal from healthy inputs', async () => {
    vi.mocked(buildBiasSnapshot).mockResolvedValue(snapshot(true) as never);
    const response = await POST(request(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(state.upserts).toEqual([[expect.objectContaining({ id: 'GBPUSD:2026-11-23T09', grade: 'A', side: 'long', outcome: 'open' })]]);
    expect(await response.json()).toMatchObject({ recorded: 1 });
  });

  it('resolves stock index signals on near-24-hour futures, not the cash index', async () => {
    vi.mocked(buildBiasSnapshot).mockResolvedValue(snapshot(false) as never);
    state.openRows = [{ ...openRow, id: 'US500:2026-11-23T02', symbol: 'US500' }];
    await POST(request(`Bearer ${SECRET}`));
    expect(vi.mocked(fetchYahooHourly)).toHaveBeenCalledWith('ES=F', 'ES=F', '5d');
  });

  it('records nothing during a feed outage but still resolves older signals', async () => {
    vi.mocked(buildBiasSnapshot).mockResolvedValue(snapshot(false) as never);
    state.openRows = [openRow];
    const body = await (await POST(request(`Bearer ${SECRET}`))).json();
    expect(state.upserts).toEqual([]);
    expect(state.openQueries).toBe(1);
    expect(state.updates).toEqual([expect.objectContaining({ outcome: 'void' })]);
    expect(body).toMatchObject({ recorded: 0, voided: 1 });
  });
});
