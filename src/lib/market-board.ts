import type { BiasResult, Conviction } from '@/lib/types';

export type TileSize = 'lg' | 'md' | 'sm';

/** One market placed on the board; col/row are 1-based CSS grid lines. */
export interface BoardTile {
  item: BiasResult;
  size: TileSize;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

const SIZE_BY_CONVICTION: Record<Conviction, TileSize> = { high: 'lg', medium: 'md', low: 'sm' };
const CONVICTION_RANK: Record<Conviction, number> = { high: 0, medium: 1, low: 2 };
/** Widths in quarters of the board: lg and md take half, sm a quarter. */
const SPANS: Record<TileSize, { quarters: number; rowSpan: number }> = {
  lg: { quarters: 2, rowSpan: 2 },
  md: { quarters: 2, rowSpan: 1 },
  sm: { quarters: 1, rowSpan: 1 },
};

/** Unknown convictions (e.g. a stale cached payload) fall back to the lowest tier. */
export function tileSize(conviction: Conviction): TileSize {
  return SIZE_BY_CONVICTION[conviction] ?? 'sm';
}

function rank(conviction: Conviction): number {
  return CONVICTION_RANK[conviction] ?? CONVICTION_RANK.low;
}

/** Conviction tier first, then the stronger bias, then symbol for a stable order. */
export function orderMarkets(items: BiasResult[]): BiasResult[] {
  return [...items].sort((a, b) =>
    rank(a.conviction) - rank(b.conviction)
    || Math.abs(b.biasPercent) - Math.abs(a.biasPercent)
    || a.symbol.localeCompare(b.symbol));
}

/**
 * Places markets on a grid: first-fit in reading order; rows of same-size
 * tiles are then balanced and split evenly; finally every empty cell is
 * absorbed by a neighbouring tile so the board never shows a hole.
 */
export function packBoard(items: BiasResult[], columns = 12): BoardTile[] {
  let grid: (BoardTile | null)[][] = [];
  const cell = (r: number, c: number) => grid[r]?.[c] ?? null;
  const claim = (t: BoardTile) => {
    for (let r = t.row - 1; r < t.row - 1 + t.rowSpan; r++) {
      grid[r] ??= Array(columns).fill(null);
      for (let c = t.col - 1; c < t.col - 1 + t.colSpan; c++) grid[r][c] = t;
    }
  };
  const fits = (r: number, c: number, w: number, h: number) => {
    if (c + w > columns) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (cell(y, x)) return false;
    return true;
  };

  const tiles = orderMarkets(items).map((item) => {
    const size = tileSize(item.conviction);
    const colSpan = Math.min(columns, Math.max(1, Math.round((SPANS[size].quarters * columns) / 4)));
    const rowSpan = SPANS[size].rowSpan;
    let r = 0;
    for (;;) {
      for (let c = 0; c < columns; c++) {
        if (fits(r, c, colSpan, rowSpan)) {
          const tile: BoardTile = { item, size, col: c + 1, row: r + 1, colSpan, rowSpan };
          claim(tile);
          return tile;
        }
      }
      r++;
    }
  });

  balanceRows(tiles, columns);
  grid = [];
  tiles.forEach(claim);

  const height = grid.length;
  const columnFree = (t: BoardTile, c: number) => {
    for (let r = t.row - 1; r < t.row - 1 + t.rowSpan; r++) if (cell(r, c)) return false;
    return true;
  };
  const rowFree = (t: BoardTile, r: number) => {
    if (r >= height) return false;
    for (let c = t.col - 1; c < t.col - 1 + t.colSpan; c++) if (cell(r, c)) return false;
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < columns; c++) {
        if (cell(r, c)) continue;
        const left = c > 0 ? cell(r, c - 1) : null;
        const above = r > 0 ? cell(r - 1, c) : null;
        const right = c < columns - 1 ? cell(r, c + 1) : null;
        const below = cell(r + 1, c);
        // The higher-conviction neighbour absorbs the gap, so a weak market never outgrows a strong one.
        const growers = [
          left && left.col + left.colSpan - 1 === c && columnFree(left, c) && { tile: left, grow: () => { left.colSpan++; } },
          above && above.row + above.rowSpan - 1 === r && rowFree(above, r) && { tile: above, grow: () => { above.rowSpan++; } },
          right && right.col - 1 === c + 1 && columnFree(right, c) && { tile: right, grow: () => { right.col--; right.colSpan++; } },
          below && below.row - 1 === r + 1 && rowFree(below, r) && { tile: below, grow: () => { below.row--; below.rowSpan++; } },
        ].filter((g): g is { tile: BoardTile; grow: () => void } => Boolean(g));
        if (growers.length === 0) continue;
        const best = growers.reduce((a, b) =>
          rank(b.tile.item.conviction) < rank(a.tile.item.conviction) ? b : a);
        best.grow();
        claim(best.tile);
        changed = true;
      }
    }
  }

  return tiles;
}

/**
 * Tidies the rows of single-row tiles below everything taller. A short last
 * row under a mixed row first pulls its same-size neighbours down. Then the
 * trailing run of one size is spread so row widths only narrow down the board:
 * the strongest of the run get the wider tiles and nobody is left alone in a
 * stretched last row.
 */
function balanceRows(tiles: BoardTile[], columns: number) {
  const height = Math.max(0, ...tiles.map((t) => t.row + t.rowSpan - 1));
  const isPlain = (row: number) =>
    !tiles.some((t) => t.rowSpan > 1 && row >= t.row && row < t.row + t.rowSpan);
  const rowTiles = (row: number) => tiles.filter((t) => t.row === row && t.rowSpan === 1);
  const sameSize = (list: BoardTile[]) => list.length > 0 && list.every((t) => t.size === list[0].size);

  // Rows wholly of the last row's size are left to the run below.
  const upperInRun = isPlain(height - 1) && sameSize([...rowTiles(height - 1), ...rowTiles(height)]);
  if (height >= 2 && isPlain(height) && !upperInRun) {
    const lower = rowTiles(height);
    const upper = rowTiles(height - 1).filter((t) => sameSize([...lower, t]));
    if (sameSize(lower) && lower.length < upper.length) {
      const all = [...upper, ...lower];
      const upperCount = Math.floor(all.length / 2);
      all.forEach((t, i) => { t.row = i < upperCount ? height - 1 : height; });
    }
  }

  let first = height + 1;
  while (first - 1 >= 1 && isPlain(first - 1) && sameSize([...rowTiles(first - 1), ...rowTiles(height)])) first--;
  if (first > height) return;
  const run = tiles.filter((t) => t.row >= first && t.rowSpan === 1);
  const perRow = Math.max(1, Math.floor(columns / run[0].colSpan));
  const rows = Math.ceil(run.length / perRow);
  const base = Math.floor(run.length / rows);
  const extra = run.length % rows;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const count = base + (r >= rows - extra ? 1 : 0);
    const row = run.slice(i, i + count);
    i += count;
    const width = count > 1 && columns % count === 0 ? columns / count : row[0].colSpan;
    row.forEach((t, k) => {
      t.row = first + r;
      t.col = 1 + k * width;
      t.colSpan = width;
    });
  }
}
