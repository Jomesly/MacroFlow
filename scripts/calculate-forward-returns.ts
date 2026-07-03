/**
 * Calculate forward returns and MAE for each score snapshot.
 *
 * For each snapshot at time T:
 * - Price at T (entry)
 * - Price at T+4h, T+1d, T+3d (exit)
 * - Forward return = (exit - entry) / entry
 * - MAE = worst adverse move within window
 *
 * Outputs: data/backtest-joined/{symbol}.json
 *
 * Usage: npx tsx scripts/calculate-forward-returns.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { AssetSymbol } from '../src/lib/types';

interface ScoreSnapshot {
  timestamp: string;
  symbol: AssetSymbol;
  score: number;
  biasPercent: number;
  direction: string;
  strength: string;
  conviction: string;
  signal: string;
  eventCount: number;
  confirmationRatio: number;
  categoryBreakdown: Record<string, number>;
}

interface PriceBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface JoinedRecord {
  timestamp: string;
  symbol: AssetSymbol;
  score: number;
  direction: string;
  conviction: string;
  signal: string;
  eventCount: number;
  confirmationRatio: number;
  categoryBreakdown: Record<string, number>;
  entryPrice: number;
  entryTime: string;
  return_4h: number | null;
  return_1d: number | null;
  return_3d: number | null;
  mae_4h: number | null;
  mae_1d: number | null;
  mae_3d: number | null;
  price_4h: number | null;
  price_1d: number | null;
  price_3d: number | null;
  crossedWeekend: boolean;
}

const SYMBOLS: AssetSymbol[] = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];

// Weekend check (for US100/DJ30 which don't trade on weekends)
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isEquityIndex(symbol: AssetSymbol): boolean {
  return symbol === 'US100' || symbol === 'DJ30';
}

function findPriceAtOrAfter(bars: PriceBar[], targetTime: Date): { price: number; time: string } | null {
  const targetMs = targetTime.getTime();

  for (const bar of bars) {
    const barTime = new Date(bar.datetime).getTime();
    if (barTime >= targetMs) {
      return { price: bar.close, time: bar.datetime };
    }
  }

  return null;
}

function calculateMAE(
  bars: PriceBar[],
  startTime: Date,
  endTime: Date,
  direction: string,
  entryPrice: number
): number {
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  let worstAdverse = 0;

  for (const bar of bars) {
    const barTime = new Date(bar.datetime).getTime();
    if (barTime < startMs || barTime > endMs) continue;

    let adverseMove: number;
    if (direction === 'bullish') {
      // For bullish: worst move is the lowest low
      adverseMove = (bar.low - entryPrice) / entryPrice;
    } else if (direction === 'bearish') {
      // For bearish: worst move is the highest high
      adverseMove = (entryPrice - bar.high) / entryPrice;
    } else {
      // Neutral: max drawdown in either direction
      const downMove = (entryPrice - bar.high) / entryPrice;
      const upMove = (bar.low - entryPrice) / entryPrice;
      adverseMove = Math.min(downMove, upMove);
    }

    if (adverseMove < worstAdverse) {
      worstAdverse = adverseMove;
    }
  }

  return worstAdverse;
}

function calculateForwardReturns(): void {
  console.log('Loading data...');

  // Load snapshots and prices for each symbol
  const snapshotsDir = path.join(process.cwd(), 'data', 'backtest-snapshots');
  const pricesDir = path.join(process.cwd(), 'data', 'historical-prices');
  const outDir = path.join(process.cwd(), 'data', 'backtest-joined');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const symbol of SYMBOLS) {
    const snapshotPath = path.join(snapshotsDir, `${symbol}.json`);
    const pricePath = join(pricesDir, `${symbol}.json`);

    if (!fs.existsSync(snapshotPath) || !fs.existsSync(pricePath)) {
      console.log(`Skipping ${symbol} — missing data`);
      continue;
    }

    const snapshots: ScoreSnapshot[] = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const bars: PriceBar[] = JSON.parse(fs.readFileSync(pricePath, 'utf8'));

    console.log(`\n${symbol}: ${snapshots.length} snapshots, ${bars.length} price bars`);

    const joined: JoinedRecord[] = [];

    for (const snap of snapshots) {
      const snapTime = new Date(snap.timestamp);

      // Find entry price (price at or just after snapshot time)
      const entry = findPriceAtOrAfter(bars, snapTime);
      if (!entry) continue;

      // Define forward windows
      const t4h = new Date(snapTime.getTime() + 4 * 60 * 60 * 1000);
      const t1d = new Date(snapTime.getTime() + 24 * 60 * 60 * 1000);
      const t3d = new Date(snapTime.getTime() + 3 * 24 * 60 * 60 * 1000);

      // Find exit prices
      const p4h = findPriceAtOrAfter(bars, t4h);
      const p1d = findPriceAtOrAfter(bars, t1d);
      const p3d = findPriceAtOrAfter(bars, t3d);

      // Calculate returns
      const return_4h = p4h ? (p4h.price - entry.price) / entry.price : null;
      const return_1d = p1d ? (p1d.price - entry.price) / entry.price : null;
      const return_3d = p3d ? (p3d.price - entry.price) / entry.price : null;

      // Calculate MAE
      const mae_4h = calculateMAE(bars, snapTime, t4h, snap.direction, entry.price);
      const mae_1d = calculateMAE(bars, snapTime, t1d, snap.direction, entry.price);
      const mae_3d = calculateMAE(bars, snapTime, t3d, snap.direction, entry.price);

      // Check if forward window crosses weekend (for equity indices)
      const crossedWeekend = isEquityIndex(symbol) && (
        isWeekend(t4h) || isWeekend(t1d) || isWeekend(t3d)
      );

      joined.push({
        timestamp: snap.timestamp,
        symbol,
        score: snap.score,
        direction: snap.direction,
        conviction: snap.conviction,
        signal: snap.signal,
        eventCount: snap.eventCount,
        confirmationRatio: snap.confirmationRatio,
        categoryBreakdown: snap.categoryBreakdown,
        entryPrice: entry.price,
        entryTime: entry.time,
        return_4h,
        return_1d,
        return_3d,
        mae_4h,
        mae_1d,
        mae_3d,
        price_4h: p4h?.price ?? null,
        price_1d: p1d?.price ?? null,
        price_3d: p3d?.price ?? null,
        crossedWeekend,
      });
    }

    const outFile = path.join(outDir, `${symbol}.json`);
    fs.writeFileSync(outFile, JSON.stringify(joined, null, 2));
    console.log(`  Saved ${joined.length} joined records`);
  }

  console.log('\nDone.');
}

// Fix for join path
function join(...parts: string[]): string {
  return path.join(...parts);
}

calculateForwardReturns();
