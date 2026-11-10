import { describe, expect, it } from 'vitest';
import type { AssetSymbol, BiasResult, Conviction } from '@/lib/types';
import { leadDriver, orderMarkets, packBoard, tileSize, type BoardTile } from '@/lib/market-board';

function mk(symbol: AssetSymbol, conviction: Conviction, biasPercent: number): BiasResult {
  return {
    symbol,
    name: symbol,
    biasScore: biasPercent,
    biasPercent,
    direction: 'neutral',
    strength: 'weak',
    conviction,
    signal: 'neutral',
    dailyLabel: '',
    drivers: [],
    events: [],
    confirmationRatio: 0,
    eventCount: 0,
    confidenceCount: 0,
    totalPossibleSignals: 0,
    history: [],
    lastUpdated: '2026-11-10T00:00:00Z',
  };
}

const SYMBOLS: AssetSymbol[] = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];

function assertPacked(tiles: BoardTile[], columns: number) {
  const occupied = new Set<string>();
  let maxRow = 0;
  for (const t of tiles) {
    expect(t.col).toBeGreaterThanOrEqual(1);
    expect(t.col + t.colSpan - 1).toBeLessThanOrEqual(columns);
    for (let r = t.row; r < t.row + t.rowSpan; r++) {
      for (let c = t.col; c < t.col + t.colSpan; c++) {
        const key = `${r},${c}`;
        expect(occupied.has(key), `overlap at ${key}`).toBe(false);
        occupied.add(key);
      }
    }
    maxRow = Math.max(maxRow, t.row + t.rowSpan - 1);
  }
  expect(occupied.size, 'board has holes').toBe(maxRow * columns);
}

describe('tileSize', () => {
  it('maps conviction to tile size', () => {
    expect(tileSize('high')).toBe('lg');
    expect(tileSize('medium')).toBe('md');
    expect(tileSize('low')).toBe('sm');
  });
});

describe('orderMarkets', () => {
  it('orders by conviction tier, then absolute bias, then symbol', () => {
    const ordered = orderMarkets([
      mk('XAUUSD', 'low', 80),
      mk('GBPUSD', 'high', 10),
      mk('US100', 'medium', 50),
      mk('DJ30', 'high', -40),
    ]);
    expect(ordered.map((m) => m.symbol)).toEqual(['DJ30', 'GBPUSD', 'US100', 'XAUUSD']);
  });

  it('breaks ties alphabetically by symbol', () => {
    const ordered = orderMarkets([mk('US100', 'low', 5), mk('BTCUSD', 'low', -5)]);
    expect(ordered.map((m) => m.symbol)).toEqual(['BTCUSD', 'US100']);
  });
});

describe('packBoard', () => {
  it('packs a mixed board: lead 6x2, mediums stacked beside it, smalls split the last row', () => {
    const tiles = packBoard([
      mk('XAUUSD', 'high', 46),
      mk('US100', 'medium', 22),
      mk('GBPUSD', 'medium', -31),
      mk('DJ30', 'low', 4),
      mk('BTCUSD', 'low', -2),
    ]);
    const by = Object.fromEntries(tiles.map((t) => [t.item.symbol, t]));
    expect(by.XAUUSD).toMatchObject({ size: 'lg', col: 1, row: 1, colSpan: 6, rowSpan: 2 });
    expect(by.GBPUSD).toMatchObject({ size: 'md', col: 7, row: 1, colSpan: 6, rowSpan: 1 });
    expect(by.US100).toMatchObject({ size: 'md', col: 7, row: 2, colSpan: 6, rowSpan: 1 });
    expect(by.DJ30).toMatchObject({ size: 'sm', col: 1, row: 3, colSpan: 6 });
    expect(by.BTCUSD).toMatchObject({ size: 'sm', col: 7, row: 3, colSpan: 6 });
    assertPacked(tiles, 12);
  });

  it('all low conviction: the strongest two lead wider, the weakest three share the last row', () => {
    const tiles = packBoard(SYMBOLS.map((s, i) => mk(s, 'low', 10 - i)));
    expect(tiles.filter((t) => t.row === 1).map((t) => t.colSpan)).toEqual([6, 6]);
    expect(tiles.filter((t) => t.row === 2).map((t) => t.colSpan)).toEqual([4, 4, 4]);
    const reading = [...tiles].sort((a, b) => a.row - b.row || a.col - b.col).map((t) => t.item.symbol);
    expect(reading).toEqual(SYMBOLS);
    assertPacked(tiles, 12);
  });

  it('never makes a market bigger than a higher-conviction market, for any mix of five', () => {
    const levels: Conviction[] = ['high', 'medium', 'low'];
    const rank: Record<Conviction, number> = { high: 0, medium: 1, low: 2 };
    for (let n = 0; n < 3 ** 5; n++) {
      let k = n;
      const items = SYMBOLS.map((s, i) => {
        const c = levels[k % 3];
        k = Math.floor(k / 3);
        return mk(s, c, 10 * (i + 1));
      });
      const tiles = packBoard(items);
      for (const a of tiles) {
        for (const b of tiles) {
          if (rank[a.item.conviction] < rank[b.item.conviction]) {
            expect(b.colSpan * b.rowSpan, `${b.item.conviction} ${b.item.symbol} outgrows ${a.item.conviction} ${a.item.symbol} in mix ${n}`)
              .toBeLessThanOrEqual(a.colSpan * a.rowSpan);
          }
        }
      }
    }
  });

  it('all high conviction: the fifth tile widens to the full width', () => {
    const tiles = packBoard(SYMBOLS.map((s, i) => mk(s, 'high', 50 - i)));
    expect(tiles[4]).toMatchObject({ row: 5, col: 1, colSpan: 12, rowSpan: 2 });
    assertPacked(tiles, 12);
  });

  it('never leaves holes or overlaps for any conviction mix of five markets', () => {
    const levels: Conviction[] = ['high', 'medium', 'low'];
    for (let n = 0; n < 3 ** 5; n++) {
      let k = n;
      const items = SYMBOLS.map((s, i) => {
        const c = levels[k % 3];
        k = Math.floor(k / 3);
        return mk(s, c, 10 * (i + 1));
      });
      assertPacked(packBoard(items), 12);
    }
  });

  it('collapses spans to one column when columns is 1', () => {
    const tiles = packBoard([mk('XAUUSD', 'high', 40), mk('DJ30', 'low', 1)], 1);
    expect(tiles.every((t) => t.colSpan === 1)).toBe(true);
    assertPacked(tiles, 1);
  });

  it('treats an unknown conviction as low instead of crashing the dashboard', () => {
    const stale = { ...mk('XAUUSD', 'low', 10), conviction: undefined } as unknown as BiasResult;
    const tiles = packBoard([mk('DJ30', 'high', 5), stale]);
    expect(tiles.map((t) => [t.item.symbol, t.size])).toEqual([['DJ30', 'lg'], ['XAUUSD', 'sm']]);
    assertPacked(tiles, 12);
  });

  it('packs a twelve-market watchlist without holes for every tier mix of up to twelve', () => {
    const levels: Conviction[] = ['high', 'medium', 'low'];
    for (let n = 0; n < 3000; n++) {
      let seed = n * 2654435761;
      const count = 1 + (n % 12);
      const items = Array.from({ length: count }, (_, i) => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        return mk(`M${i}` as AssetSymbol, levels[seed % 3], seed % 100);
      });
      assertPacked(packBoard(items), 12);
    }
  }, 30_000);

  it('in the trailing rows that hold one tier only, a weaker market is never wider than a stronger one', () => {
    const levels: Conviction[] = ['high', 'medium', 'low'];
    for (let n = 0; n < 3000; n++) {
      let seed = n * 2654435761;
      const count = 1 + (n % 12);
      const items = Array.from({ length: count }, (_, i) => {
        seed = (seed * 1103515245 + 12345) >>> 0;
        return mk(`M${i}` as AssetSymbol, levels[seed % 3], seed % 100);
      });
      const tiles = packBoard(items);
      const bottom = Math.max(...tiles.map((t) => t.row + t.rowSpan - 1));
      const lastSize = tiles[tiles.length - 1].size;
      const trailing: BoardTile[] = [];
      for (let i = tiles.length - 1; i >= 0; i--) {
        const t = tiles[i];
        const rowMates = tiles.filter((o) => o.row <= t.row && o.row + o.rowSpan - 1 >= t.row);
        if (rowMates.some((o) => o.size !== lastSize || o.rowSpan !== 1)) break;
        trailing.unshift(t);
      }
      for (let i = 1; i < trailing.length; i++) {
        expect(trailing[i].colSpan, `mix ${n}: ${trailing[i].item.symbol} wider than ${trailing[i - 1].item.symbol} (bottom ${bottom})`)
          .toBeLessThanOrEqual(trailing[i - 1].colSpan);
      }
    }
  }, 30_000);

  it('returns an empty board for no markets', () => {
    expect(packBoard([])).toEqual([]);
  });
});

describe('leadDriver', () => {
  const withDrivers = (direction: BiasResult['direction'], drivers: string[]) => ({ ...mk('XAUUSD', 'high', 30), direction, drivers });

  it('shows the first driver that agrees with the market direction, without its label', () => {
    expect(leadDriver(withDrivers('bullish', ['Bearish: Stocks recover', 'Bullish: Yields fall']))).toBe('Yields fall');
    expect(leadDriver(withDrivers('weakly_bearish', ['Bearish: ETF outflows extend']))).toBe('ETF outflows extend');
  });

  it('shows nothing when no driver agrees, or the market is neutral', () => {
    expect(leadDriver(withDrivers('bullish', ['Bearish: Stocks recover']))).toBeUndefined();
    expect(leadDriver(withDrivers('neutral', ['Bullish: Yields fall']))).toBeUndefined();
    expect(leadDriver(withDrivers('bearish', []))).toBeUndefined();
  });
});
