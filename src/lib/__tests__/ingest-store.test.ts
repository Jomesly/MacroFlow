import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';
import { hashApiKey, MappedTradeRow } from '../ingest';
import {
  authenticateApiKey,
  checkIngestRateLimit,
  getTradeIdsForLinking,
  linkTradesToSnapshots,
  upsertBrokerAccount,
  upsertEaTrades,
} from '../ingest-store';

type Row = Record<string, unknown>;

// ── Minimal in-memory Supabase fake ─────────────────────────────────────
// Supports exactly the query shapes used by ingest-store.ts.

interface Captured {
  table: string;
  selectCols: string | null;
  eqs: Array<[string, unknown]>;
  inList: Array<[string, unknown[]]>;
  lte: Array<[string, string]>;
  orderBy: Array<[string, boolean]>;
  limitN: number | null;
  updatePayload: Row | null;
  upsertPayload: Row[] | null;
  upsertConflict: string | null;
}

class FakeChain {
  q: Captured;
  private singleOnly = false;
  constructor(
    private tables: Map<string, Row[]>,
    table: string
  ) {
    this.q = {
      table,
      selectCols: null,
      eqs: [],
      inList: [],
      lte: [],
      orderBy: [],
      limitN: null,
      updatePayload: null,
      upsertPayload: null,
      upsertConflict: null,
    };
  }

  select(cols: string): this {
    this.q.selectCols = cols;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.q.eqs.push([col, val]);
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.q.inList.push([col, vals]);
    return this;
  }
  lte(col: string, val: string): this {
    this.q.lte.push([col, val]);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.q.orderBy.push([col, opts?.ascending !== false]);
    return this;
  }
  limit(n: number): this {
    this.q.limitN = n;
    return this;
  }
  update(payload: Row): this {
    this.q.updatePayload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string }): this {
    this.q.upsertPayload = Array.isArray(payload) ? payload : [payload];
    this.q.upsertConflict = opts?.onConflict ?? null;
    return this;
  }
  maybeSingle(): this {
    this.singleOnly = true;
    return this;
  }

  private getTable(): Row[] {
    let t = this.tables.get(this.q.table);
    if (!t) {
      t = [];
      this.tables.set(this.q.table, t);
    }
    return t;
  }

  private project(rows: Row[]): Row[] {
    if (!this.q.selectCols || this.q.selectCols === '*') return rows;
    const cols = this.q.selectCols.split(',').map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }

  private filtered(): Row[] {
    let rows = this.getTable();
    for (const [col, val] of this.q.eqs) rows = rows.filter((r) => r[col] === val);
    for (const [col, vals] of this.q.inList) rows = rows.filter((r) => vals.includes(r[col]));
    for (const [col, val] of this.q.lte) rows = rows.filter((r) => String(r[col]) <= val);
    for (const [col, asc] of this.q.orderBy) {
      rows = [...rows].sort((a, b) =>
        asc ? String(a[col]) < String(b[col]) ? -1 : 1 : String(a[col]) > String(b[col]) ? -1 : 1
      );
    }
    if (this.q.limitN !== null) rows = rows.slice(0, this.q.limitN);
    return rows;
  }

  private execute(): { data: unknown; error: null } {
    if (this.q.upsertPayload) {
      const table = this.getTable();
      const conflictCols = (this.q.upsertConflict ?? '').split(',').map((c) => c.trim());
      for (const incoming of this.q.upsertPayload) {
        const existing = table.find((r) => conflictCols.every((c) => r[c] === incoming[c]));
        if (existing) {
          Object.assign(existing, incoming);
        } else {
          const row: Row = { id: table.length + 1, ...incoming };
          table.push(row);
        }
      }
      if (this.q.selectCols) {
        const last = this.q.upsertPayload[this.q.upsertPayload.length - 1];
        const match = table.find((r) => conflictCols.every((c) => r[c] === last[c]));
        return { data: this.project(match ? [match] : [])[0] ?? null, error: null };
      }
      return { data: null, error: null };
    }
    if (this.q.updatePayload) {
      for (const r of this.filtered()) Object.assign(r, this.q.updatePayload);
      return { data: null, error: null };
    }
    const rows = this.filtered();
    const projected = this.project(rows);
    if (this.singleOnly) return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled as never);
  }
}

function fakeSb(tables: Map<string, Row[]>): SupabaseClient {
  return { from: (table: string) => new FakeChain(tables, table) } as unknown as SupabaseClient;
}

function fakeRedis(counts: Map<string, number>, fails = false): Redis {
  return {
    incr: async (key: string) => {
      if (fails) throw new Error('redis down');
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    expire: async () => 1,
  } as unknown as Redis;
}

describe('authenticateApiKey', () => {
  it('distinguishes a storage outage from an invalid credential', async () => {
    const unavailable = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'offline' } }) }) }) }) } as unknown as SupabaseClient;
    await expect(authenticateApiKey(unavailable, 'hash')).rejects.toThrow('API key storage unavailable');
  });
  let tables: Map<string, Row[]>;
  beforeEach(() => {
    tables = new Map();
  });

  it('authenticates a valid non-revoked key and touches last_used_at', async () => {
    const hash = hashApiKey('mf_testkey123');
    tables.set('journal_api_keys', [
      { id: 1, user_id: 'u1', key_hash: hash, revoked_at: null, last_used_at: null },
    ]);

    const authed = await authenticateApiKey(fakeSb(tables), hash);
    expect(authed).toEqual({ keyId: 1, userId: 'u1' });
    expect(tables.get('journal_api_keys')?.[0].last_used_at).toBeTruthy();
  });

  it('rejects unknown and revoked keys', async () => {
    tables.set('journal_api_keys', [
      { id: 2, user_id: 'u1', key_hash: 'other', revoked_at: new Date().toISOString(), last_used_at: null },
    ]);

    await expect(authenticateApiKey(fakeSb(tables), 'missing')).resolves.toBeNull();
    await expect(authenticateApiKey(fakeSb(tables), 'other')).resolves.toBeNull();
  });

  it('skips last_used_at write when recently touched', async () => {
    const hash = hashApiKey('mf_recent');
    const now = new Date().toISOString();
    tables.set('journal_api_keys', [
      { id: 3, user_id: 'u1', key_hash: hash, revoked_at: null, last_used_at: now },
    ]);

    await authenticateApiKey(fakeSb(tables), hash);
    expect(tables.get('journal_api_keys')?.[0].last_used_at).toBe(now);
  });
});

describe('checkIngestRateLimit', () => {
  it('allows 30 requests then blocks', async () => {
    const redis = fakeRedis(new Map());
    for (let i = 0; i < 30; i++) {
      await expect(checkIngestRateLimit(redis, 'hash')).resolves.toBe(true);
    }
    await expect(checkIngestRateLimit(redis, 'hash')).resolves.toBe(false);
  });

  it('fails open without redis or on redis errors', async () => {
    await expect(checkIngestRateLimit(null, 'hash')).resolves.toBe(true);
    await expect(checkIngestRateLimit(fakeRedis(new Map(), true), 'hash')).resolves.toBe(true);
  });
});

describe('upsertBrokerAccount', () => {
  let tables: Map<string, Row[]>;
  beforeEach(() => {
    tables = new Map();
  });

  it('inserts then updates the same account on resync', async () => {
    const sb = fakeSb(tables);
    const info = { account_login: '123', server: 'Test-Live', currency: 'USD', ea_version: '1.0' };

    const first = await upsertBrokerAccount(sb, 'u1', info);
    const second = await upsertBrokerAccount(sb, 'u1', { ...info, ea_version: '1.1' });

    expect(first).toBe(second);
    expect(tables.get('broker_accounts')).toHaveLength(1);
    expect(tables.get('broker_accounts')?.[0].ea_version).toBe('1.1');
  });
});

describe('upsertEaTrades', () => {
  let tables: Map<string, Row[]>;
  beforeEach(() => {
    tables = new Map();
  });

  function row(ticket: string, profit = 10): MappedTradeRow {
    return {
      broker_trade_id: ticket,
      symbol: 'XAUUSD',
      direction: 'long',
      entry_price: 100,
      exit_price: 110,
      result: 'win',
      pnl_amount: profit,
      commission: 0,
      swap: 0,
      sl: null,
      tp: null,
      volume: 0.1,
      risk_amount: null,
      r_multiple: null,
      logged_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      source: 'ea',
    };
  }

  it('inserts new trades and counts resends as updates', async () => {
    const sb = fakeSb(tables);

    const first = await upsertEaTrades(sb, 'u1', 7, [row('t1'), row('t2')]);
    expect(first).toEqual({ inserted: 2, updated: 0 });

    const second = await upsertEaTrades(sb, 'u1', 7, [row('t1'), row('t2', 99)]);
    expect(second).toEqual({ inserted: 0, updated: 2 });
    expect(tables.get('trades')).toHaveLength(2);
    expect(tables.get('trades')?.find((r) => r.broker_trade_id === 't2')?.pnl_amount).toBe(99);
  });

  it('scopes dedupe per user and account', async () => {
    const sb = fakeSb(tables);

    await upsertEaTrades(sb, 'u1', 7, [row('t1')]);
    const other = await upsertEaTrades(sb, 'u2', 7, [row('t1')]);
    expect(other).toEqual({ inserted: 1, updated: 0 });
    expect(tables.get('trades')).toHaveLength(2);
  });
});

describe('linkTradesToSnapshots', () => {
  let tables: Map<string, Row[]>;
  beforeEach(() => {
    tables = new Map();
  });

  it('links to the latest snapshot at or before entry and flags stale gaps', async () => {
    const sb = fakeSb(tables);
    tables.set('bias_snapshots', [
      { id: 1, symbol: 'XAUUSD', ts: '2026-01-01T10:00:00.000Z' },
      { id: 2, symbol: 'XAUUSD', ts: '2026-01-01T10:05:00.000Z' },
    ]);
    tables.set('trades', [
      { id: 'a', symbol: 'XAUUSD', logged_at: '2026-01-01T10:06:00.000Z', snapshot_id: null, stale_link: false },
      { id: 'b', symbol: 'XAUUSD', logged_at: '2026-01-01T12:00:00.000Z', snapshot_id: null, stale_link: false },
      { id: 'c', symbol: 'GBPUSD', logged_at: '2026-01-01T10:06:00.000Z', snapshot_id: null, stale_link: false },
    ]);

    const result = await linkTradesToSnapshots(sb, [
      { id: 'a', symbol: 'XAUUSD', logged_at: '2026-01-01T10:06:00.000Z' },
      { id: 'b', symbol: 'XAUUSD', logged_at: '2026-01-01T12:00:00.000Z' },
      { id: 'c', symbol: 'GBPUSD', logged_at: '2026-01-01T10:06:00.000Z' },
    ]);

    expect(result).toEqual({ linked: 2, stale: 1 });
    const rows = tables.get('trades')!;
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ snapshot_id: 2, stale_link: false });
    expect(rows.find((r) => r.id === 'b')).toMatchObject({ snapshot_id: 2, stale_link: true });
    expect(rows.find((r) => r.id === 'c')?.snapshot_id).toBeNull();
  });
});

describe('getTradeIdsForLinking', () => {
  it('returns ids scoped to user and account', async () => {
    const tables = new Map<string, Row[]>();
    tables.set('trades', [
      { id: 'a', symbol: 'XAUUSD', logged_at: '2026-01-01T10:00:00.000Z', user_id: 'u1', broker_account_id: 7, broker_trade_id: 't1' },
      { id: 'b', symbol: 'XAUUSD', logged_at: '2026-01-01T10:00:00.000Z', user_id: 'u2', broker_account_id: 7, broker_trade_id: 't1' },
    ]);

    const rows = await getTradeIdsForLinking(fakeSb(tables), 'u1', 7, ['t1', 'missing']);
    expect(rows).toEqual([{ id: 'a', symbol: 'XAUUSD', logged_at: '2026-01-01T10:00:00.000Z' }]);
  });
});
