import type { MacroEvent } from './types';

export interface IntradayBar {
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PriceDataset {
  schemaVersion: 1;
  instrument: string;
  provider: string;
  intervalMinutes: number;
  fetchedAt: string;
  bars: IntradayBar[];
}

export function validBar(bar: IntradayBar): boolean {
  return Number.isFinite(Date.parse(bar.openTime)) && Number.isFinite(Date.parse(bar.closeTime))
    && Date.parse(bar.closeTime) > Date.parse(bar.openTime)
    && [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0)
    && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close);
}

/** Reject datasets whose timing cannot support executable intraday validation. */
export function priceDatasetIssues(dataset: PriceDataset): string[] {
  const issues: string[] = [];
  if (dataset.schemaVersion !== 1 || !Number.isFinite(dataset.intervalMinutes) || dataset.intervalMinutes <= 0 || dataset.intervalMinutes > 60) issues.push('Invalid intraday schema or interval');
  if (!dataset.bars.length || dataset.bars.some(bar => !validBar(bar))) issues.push('Missing or invalid OHLC bars');
  if (new Set(dataset.bars.map(bar => Date.parse(bar.openTime))).size !== dataset.bars.length) issues.push('Duplicate bar timestamps');
  if (['GBPUSD', 'USDJPY', 'XAUUSD'].includes(dataset.instrument) && dataset.bars.some(bar => {
    const time = new Date(bar.openTime);
    return time.getUTCDay() === 6 && time.getUTCHours() >= 6 && time.getUTCHours() < 18;
  })) issues.push('Weekend FX/metal quotes have no verified executable session');
  return issues;
}

/** Single source of the market-confirmation thresholds used by live and replay scoring. */
export function classifyDxyMove(change: number): 'strong' | 'weak' | null {
  return change >= 0.2 ? 'strong' : change <= -0.2 ? 'weak' : null;
}
export function classifyYieldMove(change: number): 'rising' | 'falling' | null {
  return change >= 0.03 ? 'rising' : change <= -0.03 ? 'falling' : null;
}

/** Same completed-bar and previous-UTC-session comparison in live and replay. */
export function buildMarketEvents(datasets: Partial<Record<'DXY' | 'US10Y', PriceDataset>>, asOf: string): MacroEvent[] {
  const events: MacroEvent[] = [];
  for (const instrument of ['DXY', 'US10Y'] as const) {
    const dataset = datasets[instrument];
    if (!dataset || dataset.instrument !== instrument) continue;
    // Integrity is judged only on bars known at asOf, so later archive rows cannot change an earlier prediction.
    const known = dataset.bars.filter(bar => Date.parse(bar.closeTime) <= Date.parse(asOf));
    if (priceDatasetIssues({ ...dataset, bars: known }).length) continue;
    const bars = known.slice().sort((a, b) => a.closeTime.localeCompare(b.closeTime));
    const latest = bars.at(-1);
    if (!latest || Date.parse(asOf) - Date.parse(latest.closeTime) >= 4 * 3_600_000) continue;
    const prior = bars.findLast(bar => bar.openTime.slice(0, 10) < latest.openTime.slice(0, 10));
    if (!prior || Date.parse(latest.closeTime) - Date.parse(prior.closeTime) > 4 * 86_400_000) continue;
    // Round away float noise (3.97 - 4 = -0.0299...) so moves exactly at a threshold classify as that move.
    const change = Math.round((instrument === 'DXY' ? (latest.close / prior.close - 1) * 100 : latest.close - prior.close) * 1e6) / 1e6;
    const value = (instrument === 'DXY' ? classifyDxyMove(change) : classifyYieldMove(change)) ?? 'neutral';
    events.push({ id: `market:${instrument}:${latest.closeTime}`, seriesId: instrument,
      category: instrument === 'DXY' ? 'dollar_strength' : 'yields', value,
      title: `${instrument}: ${change >= 0 ? '+' : ''}${change.toFixed(2)}${instrument === 'DXY' ? '%' : ' pp'} versus prior UTC session`,
      description: `Completed hourly observation ${latest.closeTime}. Current: ${latest.close.toFixed(2)}, Previous Close: ${prior.close.toFixed(2)} (${change.toFixed(2)}${instrument === 'DXY' ? '%' : ' pp'})`,
      timestamp: latest.closeTime, impact: 'medium', country: 'US', sourceName: dataset.provider, evidenceType: 'market',
      expiresAt: new Date(Date.parse(latest.closeTime) + 4 * 3_600_000).toISOString() });
  }
  return events;
}
