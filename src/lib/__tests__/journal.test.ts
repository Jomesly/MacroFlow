import { beforeEach, describe, expect, it, vi } from 'vitest';

const kv = new Map<string, unknown>();
const lists = new Map<string, string[]>();

vi.mock('@upstash/redis', () => ({
  Redis: class Redis {
    async get<T>(key: string): Promise<T | null> {
      return (kv.get(key) as T | undefined) ?? null;
    }

    async set(key: string, value: unknown): Promise<void> {
      kv.set(key, value);
    }

    async del(key: string): Promise<void> {
      kv.delete(key);
      lists.delete(key);
    }

    async mget(...keys: string[]): Promise<unknown[]> {
      return keys.map((k) => kv.get(k) ?? null);
    }

    async lpush(key: string, ...elements: string[]): Promise<number> {
      const list = lists.get(key) ?? [];
      list.unshift(...[...elements].reverse());
      lists.set(key, list);
      return list.length;
    }

    async lrange<TResult = string>(key: string, start: number, stop: number): Promise<TResult[]> {
      const list = lists.get(key) ?? [];
      const end = stop === -1 ? list.length : stop + 1;
      return list.slice(start, end) as TResult[];
    }

    async lrem(key: string, count: number, value: string): Promise<number> {
      const list = lists.get(key) ?? [];
      const next: string[] = [];
      let removed = 0;
      for (const item of list) {
        if (item === value && (count === 0 || removed < count)) {
          removed++;
          continue;
        }
        next.push(item);
      }
      lists.set(key, next);
      return removed;
    }
  },
}));

async function loadJournal() {
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.com';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
  return import('../journal');
}

describe('journal', () => {
  beforeEach(() => {
    kv.clear();
    lists.clear();
  });

  it('createTrade returns a trade with open fields nulled out', async () => {
    const { createTrade } = await loadJournal();

    const trade = await createTrade({ symbol: 'US100', direction: 'long', entryPrice: 20350 });

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

    const first = await createTrade({ symbol: 'XAUUSD', direction: 'long', entryPrice: 2000 });
    const second = await createTrade({ symbol: 'DJ30', direction: 'short', entryPrice: 40000 });
    const third = await createTrade({ symbol: 'BTCUSD', direction: 'long', entryPrice: 60000 });

    const trades = await listTrades();

    expect(trades.map((t) => t.id)).toEqual([third.id, second.id, first.id]);
  });

  it('computes P&L correctly for long and short directions', async () => {
    const { createTrade, updateTrade } = await loadJournal();

    const longWin = await createTrade({
      symbol: 'US100', direction: 'long', entryPrice: 100, exitPrice: 110, result: 'win',
    });
    expect(longWin.pnlPercent).toBe(10);

    const shortWin = await createTrade({
      symbol: 'US100', direction: 'short', entryPrice: 100, exitPrice: 90, result: 'win',
    });
    expect(shortWin.pnlPercent).toBe(10);

    const longLoss = await createTrade({
      symbol: 'US100', direction: 'long', entryPrice: 20350, exitPrice: 20300, result: 'loss',
    });
    expect(longLoss.pnlPercent).toBe(-0.25);

    const open = await createTrade({ symbol: 'GBPUSD', direction: 'short', entryPrice: 1.3 });
    const closed = await updateTrade(open.id, { exitPrice: 1.29, result: 'win' });
    expect(closed?.pnlPercent).toBe(0.77);
  });

  it('rejects exit price without a result on create and update', async () => {
    const journal = await loadJournal();

    await expect(
      journal.createTrade({ symbol: 'US100', direction: 'long', entryPrice: 100, exitPrice: 105 })
    ).rejects.toThrow(journal.JournalValidationError);

    const open = await journal.createTrade({ symbol: 'US100', direction: 'long', entryPrice: 100 });

    await expect(
      journal.updateTrade(open.id, { exitPrice: 105 })
    ).rejects.toThrow(journal.JournalValidationError);
  });

  it('allows notes-only updates without a result', async () => {
    const { createTrade, updateTrade } = await loadJournal();

    const trade = await createTrade({ symbol: 'US100', direction: 'long', entryPrice: 100 });
    const updated = await updateTrade(trade.id, { notes: 'sweep into IFVG' });

    expect(updated?.notes).toBe('sweep into IFVG');
    expect(updated?.result).toBeNull();
    expect(updated?.exitPrice).toBeNull();
    expect(updated?.pnlPercent).toBeNull();
  });

  it('returns null when updating a missing trade', async () => {
    const { updateTrade } = await loadJournal();

    await expect(updateTrade('missing-id', { notes: 'x' })).resolves.toBeNull();
  });

  it('deleteTrade removes the trade key and its id from the list', async () => {
    const { createTrade, deleteTrade, listTrades } = await loadJournal();

    const keep = await createTrade({ symbol: 'DJ30', direction: 'long', entryPrice: 40000 });
    const remove = await createTrade({ symbol: 'US100', direction: 'short', entryPrice: 20350 });

    await expect(deleteTrade(remove.id)).resolves.toBe(true);

    const trades = await listTrades();
    expect(trades.map((t) => t.id)).toEqual([keep.id]);
    expect(trades.find((t) => t.id === remove.id)).toBeUndefined();

    await expect(deleteTrade(remove.id)).resolves.toBe(false);
  });
});
