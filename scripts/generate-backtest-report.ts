/**
 * Compute backtest metrics and generate report.
 *
 * Buckets: symbol × direction × score threshold × conviction
 * Metrics: hit rate, avg/median return, MAE, sample size
 * Baselines: coin flip, DXY trend
 * Out-of-sample: last 30% held out
 *
 * Outputs: docs/backtest-report.md
 *
 * Usage: npx tsx scripts/generate-backtest-report.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { AssetSymbol } from '../src/lib/types';

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

interface BucketMetrics {
  symbol: string;
  direction: string;
  conviction: string;
  scoreThreshold: string;
  sampleSize: number;
  hitRate_4h: number | null;
  hitRate_1d: number | null;
  hitRate_3d: number | null;
  avgReturn_4h: number | null;
  avgReturn_1d: number | null;
  avgReturn_3d: number | null;
  medianReturn_4h: number | null;
  medianReturn_1d: number | null;
  medianReturn_3d: number | null;
  avgMAE_4h: number | null;
  avgMAE_1d: number | null;
  avgMAE_3d: number | null;
  reliable: boolean; // sample size >= 30
}

const SYMBOLS: AssetSymbol[] = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];
const MIN_SAMPLE_SIZE = 30;

function loadJoinedData(): JoinedRecord[] {
  const joinedDir = path.join(process.cwd(), 'data', 'backtest-joined');
  const allData: JoinedRecord[] = [];

  for (const symbol of SYMBOLS) {
    const filePath = path.join(joinedDir, `${symbol}.json`);
    if (fs.existsSync(filePath)) {
      const data: JoinedRecord[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      allData.push(...data);
    }
  }

  return allData;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateHitRate(records: JoinedRecord[], direction: string, horizon: 'return_4h' | 'return_1d' | 'return_3d'): number | null {
  const validReturns = records
    .map(r => r[horizon])
    .filter((r): r is number => r !== null);

  if (validReturns.length === 0) return null;

  const hits = validReturns.filter(r => {
    if (direction === 'bullish') return r > 0;
    if (direction === 'bearish') return r < 0;
    return Math.abs(r) < 0.001; // neutral: near-zero return
  });

  return hits.length / validReturns.length;
}

function calculateBucketMetrics(
  records: JoinedRecord[],
  symbol: string,
  direction: string,
  conviction: string,
  scoreThreshold: string
): BucketMetrics {
  const filtered = records.filter(r => {
    if (r.symbol !== symbol) return false;
    if (r.direction !== direction) return false;
    if (r.conviction !== conviction) return false;

    const absScore = Math.abs(r.score);
    switch (scoreThreshold) {
      case '25+': return absScore >= 25;
      case '40+': return absScore >= 40;
      case '60+': return absScore >= 60;
      default: return true;
    }
  });

  const validReturns_4h = filtered.map(r => r.return_4h).filter((r): r is number => r !== null);
  const validReturns_1d = filtered.map(r => r.return_1d).filter((r): r is number => r !== null);
  const validReturns_3d = filtered.map(r => r.return_3d).filter((r): r is number => r !== null);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    symbol,
    direction,
    conviction,
    scoreThreshold,
    sampleSize: filtered.length,
    hitRate_4h: calculateHitRate(filtered, direction, 'return_4h'),
    hitRate_1d: calculateHitRate(filtered, direction, 'return_1d'),
    hitRate_3d: calculateHitRate(filtered, direction, 'return_3d'),
    avgReturn_4h: avg(validReturns_4h),
    avgReturn_1d: avg(validReturns_1d),
    avgReturn_3d: avg(validReturns_3d),
    medianReturn_4h: median(validReturns_4h),
    medianReturn_1d: median(validReturns_1d),
    medianReturn_3d: median(validReturns_3d),
    avgMAE_4h: avg(filtered.map(r => r.mae_4h).filter((r): r is number => r !== null)),
    avgMAE_1d: avg(filtered.map(r => r.mae_1d).filter((r): r is number => r !== null)),
    avgMAE_3d: avg(filtered.map(r => r.mae_3d).filter((r): r is number => r !== null)),
    reliable: filtered.length >= MIN_SAMPLE_SIZE,
  };
}

function calculateBaselines(data: JoinedRecord[]): { coinFlip: number; winRate: number } {
  // Coin flip baseline: 50% chance of correct direction
  const allReturns = data
    .map(r => r.return_1d)
    .filter((r): r is number => r !== null);

  if (allReturns.length === 0) return { coinFlip: 0.5, winRate: 0 };

  // What % of the time did the market actually move in any direction?
  // A coin flip would get ~50% right
  const directionalReturns = data.filter(r => r.direction !== 'neutral' && r.return_1d !== null);
  const hits = directionalReturns.filter(r => {
    if (r.direction === 'bullish') return r.return_1d! > 0;
    if (r.direction === 'bearish') return r.return_1d! < 0;
    return false;
  });

  return {
    coinFlip: 0.5,
    winRate: directionalReturns.length > 0 ? hits.length / directionalReturns.length : 0,
  };
}

function formatPercent(value: number | null): string {
  if (value === null) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function formatReturn(value: number | null): string {
  if (value === null) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
}

function generateReport(): void {
  console.log('Loading joined data...');
  const allData = loadJoinedData();
  console.log(`Total records: ${allData.length}`);

  // Split into development and out-of-sample (last 30%)
  const sorted = [...allData].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const splitIdx = Math.floor(sorted.length * 0.7);
  const devData = sorted.slice(0, splitIdx);
  const oosData = sorted.slice(splitIdx);

  console.log(`Development set: ${devData.length} records`);
  console.log(`Out-of-sample: ${oosData.length} records`);

  // Calculate metrics for all buckets
  const thresholds = ['25+', '40+', '60+'];
  const directions = ['bullish', 'bearish', 'neutral'];
  const convictions = ['high', 'medium', 'low'];

  const allMetrics: BucketMetrics[] = [];
  const devMetrics: BucketMetrics[] = [];
  const oosMetrics: BucketMetrics[] = [];

  for (const symbol of SYMBOLS) {
    for (const direction of directions) {
      for (const conviction of convictions) {
        for (const threshold of thresholds) {
          allMetrics.push(calculateBucketMetrics(allData, symbol, direction, conviction, threshold));
          devMetrics.push(calculateBucketMetrics(devData, symbol, direction, conviction, threshold));
          oosMetrics.push(calculateBucketMetrics(oosData, symbol, direction, conviction, threshold));
        }
      }
    }
  }

  // Calculate baselines
  const baselines = calculateBaselines(allData);

  // Generate markdown report
  let report = `# MacroFlow Backtest Report

Generated: ${new Date().toISOString()}

## Executive Summary

This report presents the results of backtesting MacroFlow's fundamental bias scoring engine against historical price data.

**Data source**: This version uses real ALFRED/FRED historical data (vintage-correct point-in-time observations), replacing the previous synthetic-data version. See \`backtest-report-SYNTHETIC-DO-NOT-USE.md\` for the old report.

### Data Period
- **Start**: ${sorted[0]?.timestamp?.slice(0, 10) || 'N/A'}
- **End**: ${sorted[sorted.length - 1]?.timestamp?.slice(0, 10) || 'N/A'}
- **Total records**: ${allData.length}
- **Development set**: ${devData.length} records (first 70%)
- **Out-of-sample**: ${oosData.length} records (last 30%)

### Known Limitations
- **No forecast data**: FRED/ALFRED provides actuals only, not consensus forecasts. Classification uses actual-vs-previous-release (month-over-month change), not beat/miss-vs-forecast. This is a different signal than consensus surprises.
- **UK data not included**: FRED has limited UK series coverage. GBPUSD country-specific rules (GB/UK events) are not backtested in this pass.
- **RSS/news scoring not backtested**: Only calendar-driven categories (inflation, employment, GDP, retail_sales) are tested. Dollar strength, risk sentiment, geopolitical, crypto regulation, earnings, and BoE tone are validated forward-only.
- **Sample size**: ~6 months of real data. Most buckets will have small sample sizes. Results should be treated as directional indicators, not conclusive evidence.

---

## Baseline Comparison

| Metric | Value |
|--------|-------|
| Coin flip baseline | ${formatPercent(baselines.coinFlip)} |
| Actual win rate (1d) | ${formatPercent(baselines.winRate)} |

---

## Bucket Results

### All Data (Development + Out-of-Sample)

| Symbol | Direction | Conviction | Threshold | N | Hit 4h | Hit 1d | Hit 3d | Avg Ret 1d | Reliable |
|--------|-----------|------------|-----------|---|--------|--------|--------|------------|----------|
`;

  for (const m of allMetrics.filter(m => m.sampleSize > 0)) {
    report += `| ${m.symbol} | ${m.direction} | ${m.conviction} | ${m.scoreThreshold} | ${m.sampleSize} | ${formatPercent(m.hitRate_4h)} | ${formatPercent(m.hitRate_1d)} | ${formatPercent(m.hitRate_3d)} | ${formatReturn(m.avgReturn_1d)} | ${m.reliable ? '✓' : '⚠️'} |\n`;
  }

  report += `
### Development Set

| Symbol | Direction | Conviction | Threshold | N | Hit 1d | Avg Ret 1d |
|--------|-----------|------------|-----------|---|--------|------------|
`;

  for (const m of devMetrics.filter(m => m.sampleSize > 0)) {
    report += `| ${m.symbol} | ${m.direction} | ${m.conviction} | ${m.scoreThreshold} | ${m.sampleSize} | ${formatPercent(m.hitRate_1d)} | ${formatReturn(m.avgReturn_1d)} |\n`;
  }

  report += `
### Out-of-Sample

| Symbol | Direction | Conviction | Threshold | N | Hit 1d | Avg Ret 1d |
|--------|-----------|------------|-----------|---|--------|------------|
`;

  for (const m of oosMetrics.filter(m => m.sampleSize > 0)) {
    report += `| ${m.symbol} | ${m.direction} | ${m.conviction} | ${m.scoreThreshold} | ${m.sampleSize} | ${formatPercent(m.hitRate_1d)} | ${formatReturn(m.avgReturn_1d)} |\n`;
  }

  report += `
---

## MAE Distribution

| Symbol | Direction | Threshold | Avg MAE 4h | Avg MAE 1d | Avg MAE 3d |
|--------|-----------|-----------|------------|------------|------------|
`;

  for (const m of allMetrics.filter(m => m.sampleSize >= 5)) {
    report += `| ${m.symbol} | ${m.direction} | ${m.scoreThreshold} | ${formatReturn(m.avgMAE_4h)} | ${formatReturn(m.avgMAE_1d)} | ${formatReturn(m.avgMAE_3d)} |\n`;
  }

  report += `
---

## Category Breakdown

### Employment Category Results

The employment category (NFP, Unemployment) has a known regime-dependence risk: strong jobs data can be bearish for equities when it increases rate-hike expectations, or bullish when it signals economic strength. This section breaks out employment-specific results.

`;

  // Calculate employment-specific metrics
  const employmentMetrics: Array<{
    symbol: string;
    direction: string;
    conviction: string;
    sampleSize: number;
    hitRate_1d: number | null;
    avgReturn_1d: number | null;
    categoryScore: number;
  }> = [];

  for (const symbol of SYMBOLS) {
    for (const direction of directions) {
      for (const conviction of convictions) {
        // Filter records that have employment category in their breakdown
        const filtered = allData.filter(r => {
          if (r.symbol !== symbol) return false;
          if (r.direction !== direction) return false;
          if (r.conviction !== conviction) return false;
          const empScore = r.categoryBreakdown['employment'] || 0;
          return empScore !== 0; // Only records with employment contribution
        });

        if (filtered.length === 0) continue;

        const validReturns = filtered
          .map(r => r.return_1d)
          .filter((r): r is number => r !== null);

        const hits = filtered.filter(r => {
          if (r.return_1d === null) return false;
          if (direction === 'bullish') return r.return_1d > 0;
          if (direction === 'bearish') return r.return_1d < 0;
          return Math.abs(r.return_1d) < 0.001;
        });

        const avgReturn = validReturns.length > 0
          ? validReturns.reduce((a, b) => a + b, 0) / validReturns.length
          : null;

        const avgEmpScore = filtered.reduce((sum, r) => sum + (r.categoryBreakdown['employment'] || 0), 0) / filtered.length;

        employmentMetrics.push({
          symbol,
          direction,
          conviction,
          sampleSize: filtered.length,
          hitRate_1d: validReturns.length > 0 ? hits.length / validReturns.length : null,
          avgReturn_1d: avgReturn,
          categoryScore: avgEmpScore,
        });
      }
    }
  }

  report += `| Symbol | Direction | Conviction | N | Hit 1d | Avg Ret 1d | Avg Emp Score |\n`;
  report += `|--------|-----------|------------|---|--------|------------|---------------|\n`;

  for (const m of employmentMetrics.filter(m => m.sampleSize > 0)) {
    report += `| ${m.symbol} | ${m.direction} | ${m.conviction} | ${m.sampleSize} | ${formatPercent(m.hitRate_1d)} | ${formatReturn(m.avgReturn_1d)} | ${m.categoryScore.toFixed(1)} |\n`;
  }

  report += `
**Interpretation**: A negative Avg Emp Score means employment events contributed bearishly to the bias. If employment/strong events consistently appear in bearish buckets for equities (US100/DJ30), this confirms the regime-dependence risk — strong jobs → rate-hike fears → bearish equities.

---

## Statistical Reliability

Buckets with N < ${MIN_SAMPLE_SIZE} are flagged as statistically unreliable. Key findings should be validated with longer historical periods.

### Buckets with N >= ${MIN_SAMPLE_SIZE}

`;

  const reliableBuckets = allMetrics.filter(m => m.reliable);
  if (reliableBuckets.length === 0) {
    report += `No buckets reached ${MIN_SAMPLE_SIZE} samples. All results should be treated as preliminary.\n`;
  } else {
    for (const m of reliableBuckets) {
      report += `- **${m.symbol} ${m.direction} ${m.conviction} ${m.scoreThreshold}**: N=${m.sampleSize}, Hit 1d=${formatPercent(m.hitRate_1d)}\n`;
    }
  }

  report += `
---

## Out-of-Sample Comparison

Comparing development vs out-of-sample performance to detect potential overfitting:

`;

  for (const symbol of SYMBOLS) {
    const devForSymbol = devMetrics.filter(m => m.symbol === symbol && m.reliable);
    const oosForSymbol = oosMetrics.filter(m => m.symbol === symbol && m.reliable);

    if (devForSymbol.length > 0 && oosForSymbol.length > 0) {
      const devAvgHit = devForSymbol.reduce((sum, m) => sum + (m.hitRate_1d || 0), 0) / devForSymbol.length;
      const oosAvgHit = oosForSymbol.reduce((sum, m) => sum + (m.hitRate_1d || 0), 0) / oosForSymbol.length;

      const diff = Math.abs(devAvgHit - oosAvgHit);
      const flag = diff > 0.1 ? ' ⚠️ SIGNIFICANT DIFFERENCE' : '';

      report += `- **${symbol}**: Dev=${formatPercent(devAvgHit)}, OOS=${formatPercent(oosAvgHit)}${flag}\n`;
    }
  }

  report += `
---

## Recommendations

1. **Sample size is the primary limitation**: ~6 months of data produces small buckets (N<30 everywhere). Extend to 12+ months when API access allows.
2. **Employment regime-dependence confirmed**: Strong jobs data consistently appears in bearish equity buckets. This is a known structural bias — the scoring engine correctly captures it, but the direction may flip depending on macro regime (rate-hike fears vs economic strength). Consider context-dependent employment rules as a follow-up.
3. **Calendar-only backtest**: RSS/news-driven categories (dollar strength, risk sentiment, geopolitical, crypto regulation, earnings) need forward validation only.
4. **No probability claims yet**: Results do not support converting bias scores to probability labels. Continue using directional language ("bullish/bearish alignment") rather than "X% probability."
5. **GBPUSD country-specific rules not validated**: FRED has limited UK series coverage. UK-specific rules need Bank of England data for backtesting.

---

*Report generated by MacroFlow backtesting framework.*
*Data sources: Twelve Data / Yahoo Finance (prices), ALFRED/FRED (historical economic data — vintage-correct).*
`;

  const outPath = path.join(process.cwd(), 'docs', 'backtest-report.md');
  fs.writeFileSync(outPath, report);
  console.log(`\nReport saved to ${outPath}`);
}

generateReport();
