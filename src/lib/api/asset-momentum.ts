import { z } from 'zod';
import { MARKET_REFERENCES, momentumEvent } from '../asset-momentum';
import type { AssetSymbol, MacroEvent } from '../types';
import { getCached, setCache } from './cache';

const chartSchema = z.object({ chart: z.object({ result: z.array(z.object({
  meta: z.object({ regularMarketTime: z.number().finite().positive(), regularMarketPrice: z.number().finite().positive(),
    previousClose: z.number().finite().positive().optional(), chartPreviousClose: z.number().finite().positive().optional() }),
  timestamp: z.array(z.number().finite()).optional(),
  indicators: z.object({ quote: z.array(z.object({ close: z.array(z.number().finite().nullable()) })) }).optional(),
})) }) });

/** Called only with a one-day chart: chartPreviousClose is then the prior session, never a five-day baseline. */
export function parseAssetMomentum(raw: unknown, symbol: AssetSymbol, asOf: string): MacroEvent | null {
  const parsed = chartSchema.safeParse(raw);
  const result = parsed.success ? parsed.data.chart.result[0] : undefined;
  if (!result) return null;
  const meta = result.meta;
  const quotedAt = meta.regularMarketTime * 1000;
  const age = Date.parse(asOf) - quotedAt;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose;
  if (!Number.isFinite(age) || age < 0 || age >= 30 * 60_000 || !previousClose) return null;
  const closes = result.indicators?.quote[0]?.close ?? [];
  const referenceTime = quotedAt - 3_600_000;
  const prior = (result.timestamp ?? []).map((time, i) => ({ time: time * 1000, close: closes[i] }))
    // A five-minute bar's close must already exist at the one-hour comparison point.
    .filter((point): point is { time: number; close: number } => typeof point.close === 'number' && point.close > 0
      && point.time + 300_000 <= referenceTime && referenceTime - point.time <= 25 * 60_000)
    .sort((a, b) => b.time - a.time)[0];
  const reference = MARKET_REFERENCES[symbol];
  return momentumEvent(symbol, { ticker: reference.ticker, proxy: reference.proxy, price: meta.regularMarketPrice, previousClose,
    sessionChangePercent: (meta.regularMarketPrice / previousClose - 1) * 100,
    recentChangePercent: prior ? (meta.regularMarketPrice / prior.close - 1) * 100 : null,
  }, new Date(quotedAt).toISOString());
}

export async function fetchAssetMomentum(): Promise<MacroEvent[]> {
  const cacheKey = 'asset_momentum_v1';
  const cached = await getCached<MacroEvent[]>(cacheKey);
  if (cached) return cached;
  const symbols = Object.keys(MARKET_REFERENCES) as AssetSymbol[];
  const events: MacroEvent[] = [];
  // Bound provider concurrency, and keep healthy markets when any individual quote fails.
  for (let offset = 0; offset < symbols.length; offset += 4) {
    const results = await Promise.allSettled(symbols.slice(offset, offset + 4).map(async symbol => {
      const ticker = MARKET_REFERENCES[symbol].ticker;
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=5m&range=1d`, {
        signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'MacroFlow/4' }, cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Asset prices HTTP ${response.status}`);
      return parseAssetMomentum(await response.json(), symbol, new Date().toISOString());
    }));
    for (const result of results) if (result.status === 'fulfilled' && result.value) events.push(result.value);
  }
  if (events.length) await setCache(cacheKey, events, 60_000);
  return events;
}
