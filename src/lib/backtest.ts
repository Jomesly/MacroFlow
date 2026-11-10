import { scoreMacroAlignment } from './alignment';
import { buildMacroInputs, MODEL_VERSION, type FredSnapshot } from './macro-context';
import { buildMarketEvents, validBar, priceDatasetIssues, type PriceDataset } from './market-evidence';
import type { AssetSymbol, BiasResult, Direction, MacroEvent } from './types';

export interface ReplaySnapshot {
  schemaVersion: 1;
  modelVersion: string;
  timestamp: string;
  inputProfile: 'trend-market-only' | 'full-archive';
  result: BiasResult;
}

export function replayAt(asOf: string, fred: FredSnapshot | null, markets: Partial<Record<'DXY' | 'US10Y', PriceDataset>>, archivedEvents: MacroEvent[] = []): ReplaySnapshot[] {
  const { context, events } = buildMacroInputs(fred, asOf);
  const inputs = [...events, ...buildMarketEvents(markets, asOf), ...archivedEvents];
  return scoreMacroAlignment(inputs, context, asOf).map(result => ({
    schemaVersion: 1, modelVersion: MODEL_VERSION, timestamp: asOf,
    inputProfile: 'trend-market-only', result,
  }));
}

export interface EvaluationRecord {
  timestamp: string;
  symbol: AssetSymbol;
  direction: Direction;
  score: number;
  regime: string;
  qualified: boolean;
  entryTime: string | null;
  exitTime: string | null;
  grossReturn: number | null;
  netReturn: number | null;
  longNetReturn: number | null;
  shortNetReturn: number | null;
  mae: number | null;
  rejection: string | null;
}

export function directionSign(direction: Direction): -1 | 0 | 1 {
  if (direction === 'bullish' || direction === 'weakly_bullish') return 1;
  if (direction === 'bearish' || direction === 'weakly_bearish') return -1;
  return 0;
}

/** Enter strictly after prediction at the next bar OPEN, then hold four contiguous hours. */
export function evaluateFourHours(snapshot: ReplaySnapshot, prices: PriceDataset | null, costBps = 5): EvaluationRecord {
  const record = evaluateDirectionFourHours(snapshot.timestamp, snapshot.result, prices, costBps);
  return snapshot.schemaVersion === 1 && snapshot.modelVersion === MODEL_VERSION ? record
    : { ...record, entryTime: null, exitTime: null, grossReturn: null, netReturn: null, longNetReturn: null, shortNetReturn: null, mae: null, rejection: 'Wrong model/schema version' };
}

/** Model-independent outcome math for explicitly versioned comparative research. */
export function evaluateDirectionFourHours(timestamp: string, result: BiasResult, prices: PriceDataset | null, costBps = 5): EvaluationRecord {
  const snapshot = { timestamp };
  const record: EvaluationRecord = { timestamp: snapshot.timestamp, symbol: result.symbol,
    direction: result.direction, score: result.biasScore, regime: result.alignment?.context.regime ?? 'unknown',
    qualified: result.alignment?.status === 'aligned' && result.conviction === 'high',
    entryTime: null, exitTime: null, grossReturn: null, netReturn: null, longNetReturn: null, shortNetReturn: null, mae: null, rejection: null };
  const reject = (reason: string) => ({ ...record, rejection: reason });
  if (!Number.isFinite(costBps) || costBps < 0) throw new Error('Invalid round-trip cost');
  const side = directionSign(result.direction);
  if (!side) return reject('Neutral prediction');
  if (!prices || prices.schemaVersion !== 1 || prices.instrument !== result.symbol || prices.intervalMinutes > 60 || prices.intervalMinutes <= 0) return reject('Intraday prices unavailable');
  if (priceDatasetIssues(prices).length) return reject('Price dataset failed quality checks');
  const duration = prices.intervalMinutes * 60_000;
  const bars = prices.bars.filter(validBar).sort((a, b) => a.openTime.localeCompare(b.openTime));
  const entryIndex = bars.findIndex(bar => Date.parse(bar.openTime) > Date.parse(snapshot.timestamp));
  const entry = bars[entryIndex];
  if (!entry || Date.parse(entry.openTime) - Date.parse(snapshot.timestamp) > duration) return reject('No timely entry bar');
  const target = Date.parse(entry.openTime) + 4 * 3_600_000;
  let cursor = Date.parse(entry.openTime);
  let exitPrice = entry.open;
  let mae = 0;
  for (let i = entryIndex; i < bars.length && cursor < target; i++) {
    const bar = bars[i];
    if (Date.parse(bar.openTime) !== cursor || Date.parse(bar.closeTime) - cursor !== duration || Date.parse(bar.closeTime) > target) return reject('Incomplete four-hour window or session gap');
    mae = Math.min(mae, side === 1 ? bar.low / entry.open - 1 : 1 - bar.high / entry.open);
    cursor = Date.parse(bar.closeTime);
    exitPrice = bar.close;
  }
  if (cursor !== target) return reject('Incomplete four-hour window');
  const raw = exitPrice / entry.open - 1;
  const cost = costBps / 10_000;
  return { ...record, entryTime: entry.openTime, exitTime: new Date(target).toISOString(),
    grossReturn: side * raw, netReturn: side * raw - cost, longNetReturn: raw - cost, shortNetReturn: -raw - cost, mae };
}

/** Split timestamps together and purge training labels that reach into the holdout. */
export function temporalSplit(records: EvaluationRecord[], developmentFraction = 0.7) {
  if (developmentFraction <= 0 || developmentFraction >= 1) throw new Error('Invalid split');
  const times = [...new Set(records.map(record => record.timestamp))].sort();
  const cutoff = times[Math.floor(times.length * developmentFraction)];
  if (!cutoff) return { cutoff: null, development: [] as EvaluationRecord[], holdout: [] as EvaluationRecord[], purged: records.length };
  const development = records.filter(record => record.timestamp < cutoff && record.exitTime !== null && record.exitTime < cutoff);
  const holdout = records.filter(record => record.timestamp >= cutoff);
  return { cutoff, development, holdout, purged: records.length - development.length - holdout.length };
}

export function nonOverlapping(records: EvaluationRecord[]): EvaluationRecord[] {
  const ends = new Map<string, string>();
  return [...records].sort((a, b) => (a.entryTime ?? a.timestamp).localeCompare(b.entryTime ?? b.timestamp)).filter(record => {
    if (!record.entryTime || !record.exitTime || record.netReturn === null || record.rejection) return false;
    if (record.entryTime < (ends.get(record.symbol) ?? '')) return false;
    ends.set(record.symbol, record.exitTime);
    return true;
  });
}

export function wilsonInterval(wins: number, n: number): [number, number] | null {
  if (!n) return null;
  const z = 1.96, p = wins / n, denominator = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denominator;
  const spread = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}

export function summarizeRecords(records: EvaluationRecord[]) {
  const valid = nonOverlapping(records);
  const wins = valid.filter(record => record.netReturn! > 0).length;
  return { n: valid.length, days: new Set(valid.map(record => record.entryTime!.slice(0, 10))).size,
    wins, hitRate: valid.length ? wins / valid.length : null, confidence95: wilsonInterval(wins, valid.length),
    meanNetReturn: valid.length ? valid.reduce((sum, record) => sum + record.netReturn!, 0) / valid.length : null,
    meanMAE: valid.length ? valid.reduce((sum, record) => sum + record.mae!, 0) / valid.length : null,
    longBaseline: valid.length ? valid.filter(record => record.longNetReturn! > 0).length / valid.length : null,
    shortBaseline: valid.length ? valid.filter(record => record.shortNetReturn! > 0).length / valid.length : null };
}
