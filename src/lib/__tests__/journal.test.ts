import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  interface QueryError {
    message: string;
    code?: string;
  }

  interface QueryResult {
    data: unknown;
    error: QueryError | null;
  }

  interface QueryState {
    table: string;
    kind: 'select' | 'insert' | 'update' | 'delete';
    payload: Row | null;
    filters: Array<[string, unknown]>;
    orders: Array<[string, boolean]>;
    single: boolean;
    projection: string | null;
    range?: [number, number];
  }

  const tables = new Map<string, Row[]>();
  let seq = 0;

  function getTable(name: string): Row[] {
    let table = tables.get(name);
    if (!table) {
      table = [];
      tables.set(name, table);
    }
    return table;
  }

  function nextSeq(): string {
    seq += 1;
    return String(seq).padStart(12, '0');
  }

  function cmp(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a) < String(b) ? -1 : 1;
  }

  function project(rows: Row[], projection: string | null): Row[] {
    if (!projection || projection === '*') return rows;
    const cols = projection.split(',').map((c) => c.trim());
    return rows.map((row) => {
      const picked: Row = {};
      for (const col of cols) picked[col] = row[col];
      return picked;
    });
  }

  function run(q: QueryState): QueryResult {
    const rows = getTable(q.table);

    if (q.kind === 'insert') {
      const row: Row = {
        id: crypto.randomUUID(),
        source: 'manual',
        broker_trade_id: null,
        user_id: null,
        pnl_amount: null,
        closed_at: null,
        created_at: nextSeq(),
        updated_at: new Date().toISOString(),
        ...q.payload,
      };
      if (row.broker_trade_id !== null && row.broker_trade_id !== undefined) {
        const duplicate = rows.some(
          (r) => r.source === row.source && r.broker_trade_id === row.broker_trade_id
        );
        if (duplicate) {
          return {
            data: null,
            error: {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "trades_source_broker_trade_id_key"',
            },
          };
        }
      }
      rows.push(row);
      return { data: null, error: null };
    }

    const matches = (row: Row): boolean =>
      q.filters.every(([col, val]) => row[col] === val);

    if (q.kind === 'update') {
      for (const row of rows) {
        if (matches(row)) Object.assign(row, q.payload);
      }
      return { data: null, error: null };
    }

    if (q.kind === 'delete') {
      const removed: Row[] = [];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matches(rows[i])) removed.unshift(...rows.splice(i, 1));
      }
      return { data: project(removed, q.projection), error: null };
    }

    let out = rows.filter(matches);
    if (q.orders.length > 0) {
      out = [...out].sort((a, b) => {
        for (const [col, asc] of q.orders) {
          const c = cmp(a[col], b[col]);
          if (c !== 0) return asc ? c : -c;
        }
        return 0;
      });
    }
    if (q.single) {
      if (out.length > 1) {
        return { data: null, error: { message: 'JSON object requested, multiple rows returned' } };
      }
      return { data: project(out, q.projection)[0] ?? null, error: null };
    }
    return { data: project(q.range ? out.slice(q.range[0], q.range[1] + 1) : out, q.projection), error: null };
  }

  class Builder implements PromiseLike<QueryResult> {
    private readonly q: QueryState;
    private cached: QueryResult | null = null;

    constructor(table: string) {
      this.q = {
        table,
        kind: 'select',
        payload: null,
        filters: [],
        orders: [],
        single: false,
        projection: null,
      };
    }

    select(cols: string): this {
      this.q.projection = cols;
      return this;
    }

    range(from: number, to: number): this { this.q.range = [from, to]; return this; }

    insert(row: Row): this {
      this.q.kind = 'insert';
      this.q.payload = row;
      return this;
    }

    update(row: Row): this {
      this.q.kind = 'update';
      this.q.payload = row;
      return this;
    }

    delete(): this {
      this.q.kind = 'delete';
      return this;
    }

    eq(col: string, val: unknown): this {
      this.q.filters.push([col, val]);
      return this;
    }

    order(col: string, opts?: { ascending?: boolean }): this {
      this.q.orders.push([col, opts?.ascending !== false]);
      return this;
    }

    maybeSingle(): this {
      this.q.single = true;
      return this;
    }

    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
      if (!this.cached) this.cached = run(this.q);
      return Promise.resolve(this.cached).then(onfulfilled, onrejected);
    }
  }

  function createClient(...args: string[]) {
    void args;
    return { from: (table: string) => new Builder(table), rpc: async (name: string, args: { p_user_id: string; p_action?: string; p_trade_id?: string; p_operation?: string; p_arguments?: { p_values?: Row; p_trade_id?: string } }) => {
      if (name === 'run_managed_journal_rpc' && args.p_operation === 'create_journal_trade') {
        return new Builder('trades').insert({ ...args.p_arguments?.p_values, id: args.p_arguments?.p_trade_id, user_id: args.p_user_id });
      }
      if (name === 'write_journal_trade' && args.p_action === 'delete') {
        const query = new Builder('trades').eq('user_id', args.p_user_id).eq('id', args.p_trade_id);
        const result = await query.delete().select('id');
        return { data: (result.data as Row[])[0] ?? null, error: result.error };
      }
      throw new Error('Unexpected RPC: ' + name);
    } };
  }

  function reset(): void {
    tables.clear();
    seq = 0;
  }

  return { createClient, reset, seed: (table: string, rows: Row[]) => tables.set(table, rows) };
});

vi.mock('@supabase/supabase-js', () => ({ createClient: h.createClient }));

async function loadJournal() {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  return import('../journal');
}

describe('journal', () => {
  const USER_A = 'user-a-id';
  const USER_B = 'user-b-id';

  beforeEach(() => {
    h.reset();
  });

  it('saves and lists manual trades within an owned trading account', async () => {
    const id = '10000000-0000-4000-8000-000000000001';
    const other = '10000000-0000-4000-8000-000000000002';
    h.seed('journal_accounts', [{ id, user_id: USER_A }, { id: other, user_id: USER_A }]);
    const { createTrade, listTrades } = await loadJournal();
    await createTrade(USER_A, { journalAccountId: id, symbol: 'XAUUSD', direction: 'long', entryPrice: 2000 });
    await createTrade(USER_A, { journalAccountId: other, symbol: 'GBPUSD', direction: 'short', entryPrice: 1.3 });
    const trades = await listTrades(USER_A, id);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ journalAccountId: id, symbol: 'XAUUSD' });
  });

  it('refuses another owner’s trading account for reads and writes', async () => {
    const id = '10000000-0000-4000-8000-000000000001';
    h.seed('journal_accounts', [{ id, user_id: USER_B }]);
    const { createTrade, listTrades } = await loadJournal();
    await expect(createTrade(USER_A, { journalAccountId: id, symbol: 'XAUUSD', direction: 'long', entryPrice: 2000 })).rejects.toMatchObject({ status: 404 });
    await expect(listTrades(USER_A, id)).rejects.toMatchObject({ status: 404 });
    await expect(listTrades(USER_A, 'invalid')).rejects.toMatchObject({ status: 400 });
    expect(await listTrades(USER_A)).toHaveLength(0);
  });

  it('paginates beyond the API row cap without including another owner', async () => {
    const { createTrade, listTrades } = await loadJournal();
    for (let i = 0; i < 505; i++) await createTrade(USER_A, { symbol: 'US100', direction: 'long', entryPrice: 100 });
    await createTrade(USER_B, { symbol: 'US100', direction: 'long', entryPrice: 100 });
    const rows = await listTrades(USER_A);
    expect(rows).toHaveLength(505);
    expect(new Set(rows.map((r) => r.id)).size).toBe(505);
  });

  it('createTrade returns a trade with open fields nulled out', async () => {
    const { createTrade } = await loadJournal();

    const trade = await createTrade(USER_A, { symbol: 'US100', direction: 'long', entryPrice: 20350 });

    expect(trade.id).toBeTruthy();
    expect(trade.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(trade.symbol).toBe('US100');
    expect(trade.direction).toBe('long');
    expect(trade.entryPrice).toBe(20350);
    expect(trade.exitPrice).toBeNull();
    expect(trade.result).toBeNull();
    expect(trade.pnlPercent).toBeNull();
    expect(trade.setupTags).toEqual([]);
    expect(trade.notes).toBe('');
  });

  it('listTrades returns trades newest first', async () => {
    const { createTrade, listTrades } = await loadJournal();

    const first = await createTrade(USER_A, { symbol: 'XAUUSD', direction: 'long', entryPrice: 2000 });
    const second = await createTrade(USER_A, { symbol: 'DJ30', direction: 'short', entryPrice: 40000 });
    const third = await createTrade(USER_A, { symbol: 'BTCUSD', direction: 'long', entryPrice: 60000 });

    const trades = await listTrades(USER_A);

    expect(trades.map((t) => t.id)).toEqual([third.id, second.id, first.id]);
  });

  it('computes P&L correctly for long and short directions', async () => {
    const { createTrade, updateTrade } = await loadJournal();

    const longWin = await createTrade(USER_A, {
      symbol: 'US100', direction: 'long', entryPrice: 100, exitPrice: 110, result: 'win',
    });
    expect(longWin.pnlPercent).toBe(10);

    const shortWin = await createTrade(USER_A, {
      symbol: 'US100', direction: 'short', entryPrice: 100, exitPrice: 90, result: 'win',
    });
    expect(shortWin.pnlPercent).toBe(10);

    const longLoss = await createTrade(USER_A, {
      symbol: 'US100', direction: 'long', entryPrice: 20350, exitPrice: 20300, result: 'loss',
    });
    expect(longLoss.pnlPercent).toBe(-0.25);

    const open = await createTrade(USER_A, { symbol: 'GBPUSD', direction: 'short', entryPrice: 1.3 });
    const closed = await updateTrade(USER_A, open.id, { exitPrice: 1.29, result: 'win' });
    expect(closed?.pnlPercent).toBe(0.77);
  });

  it('rejects exit price without a result on create and update', async () => {
    const journal = await loadJournal();

    await expect(
      journal.createTrade(USER_A, { symbol: 'US100', direction: 'long', entryPrice: 100, exitPrice: 105 })
    ).rejects.toThrow(journal.JournalValidationError);

    const open = await journal.createTrade(USER_A, { symbol: 'US100', direction: 'long', entryPrice: 100 });

    await expect(
      journal.updateTrade(USER_A, open.id, { exitPrice: 105 })
    ).rejects.toThrow(journal.JournalValidationError);
  });

  it('allows notes-only updates without a result', async () => {
    const { createTrade, updateTrade } = await loadJournal();

    const trade = await createTrade(USER_A, { symbol: 'US100', direction: 'long', entryPrice: 100 });
    const updated = await updateTrade(USER_A, trade.id, { notes: 'sweep into IFVG' });

    expect(updated?.notes).toBe('sweep into IFVG');
    expect(updated?.result).toBeNull();
    expect(updated?.exitPrice).toBeNull();
    expect(updated?.pnlPercent).toBeNull();
  });

  it('returns null when updating a missing trade', async () => {
    const { updateTrade } = await loadJournal();

    await expect(updateTrade(USER_A, 'missing-id', { notes: 'x' })).resolves.toBeNull();
  });

  it('deleteTrade removes the trade row and reports deletion', async () => {
    const { createTrade, deleteTrade, listTrades } = await loadJournal();

    const keep = await createTrade(USER_A, { symbol: 'DJ30', direction: 'long', entryPrice: 40000 });
    const remove = await createTrade(USER_A, { symbol: 'US100', direction: 'short', entryPrice: 20350 });

    await expect(deleteTrade(USER_A, remove.id)).resolves.toBe(true);

    const trades = await listTrades(USER_A);
    expect(trades.map((t) => t.id)).toEqual([keep.id]);
    expect(trades.find((t) => t.id === remove.id)).toBeUndefined();

    await expect(deleteTrade(USER_A, remove.id)).resolves.toBe(false);
  });

  it('stores user_id on create', async () => {
    const { createTrade, listTrades } = await loadJournal();

    const trade = await createTrade(USER_A, { symbol: 'XAUUSD', direction: 'long', entryPrice: 2000 });

    const own = await listTrades(USER_A);
    expect(own.map((t) => t.id)).toEqual([trade.id]);
  });

  it('isolates trades between users on list', async () => {
    const { createTrade, listTrades } = await loadJournal();

    const aTrade = await createTrade(USER_A, { symbol: 'XAUUSD', direction: 'long', entryPrice: 2000 });
    const bTrade = await createTrade(USER_B, { symbol: 'US100', direction: 'short', entryPrice: 20350 });

    expect((await listTrades(USER_A)).map((t) => t.id)).toEqual([aTrade.id]);
    expect((await listTrades(USER_B)).map((t) => t.id)).toEqual([bTrade.id]);
  });

  it('prevents cross-user update and delete', async () => {
    const { createTrade, updateTrade, deleteTrade, listTrades } = await loadJournal();

    const trade = await createTrade(USER_A, { symbol: 'XAUUSD', direction: 'long', entryPrice: 2000 });

    await expect(updateTrade(USER_B, trade.id, { notes: 'hijack' })).resolves.toBeNull();
    await expect(deleteTrade(USER_B, trade.id)).resolves.toBe(false);

    const own = await listTrades(USER_A);
    expect(own.map((t) => t.id)).toEqual([trade.id]);
    expect(own[0].notes).toBe('');
  });

  it('rejects missing user id on every operation', async () => {
    const journal = await loadJournal();

    await expect(
      journal.createTrade('', { symbol: 'US100', direction: 'long', entryPrice: 100 })
    ).rejects.toThrow(journal.JournalValidationError);
    await expect(journal.listTrades('')).rejects.toThrow(journal.JournalValidationError);
    await expect(journal.updateTrade('', 'some-id', { notes: 'x' })).rejects.toThrow(
      journal.JournalValidationError
    );
    await expect(journal.deleteTrade('', 'some-id')).rejects.toThrow(
      journal.JournalValidationError
    );
  });
});
