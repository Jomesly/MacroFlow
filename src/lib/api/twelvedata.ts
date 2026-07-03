import { MacroEvent } from '../types';
import { getCached, setCache } from './cache';

const CACHE_KEY = 'market_data';
const CACHE_TTL = 120_000;

export async function fetchMarketData(): Promise<MacroEvent[]> {
  const cached = getCached<MacroEvent[]>(CACHE_KEY);
  if (cached) return cached;

  const events: MacroEvent[] = [];

  try {
    // DXY (US Dollar Index) via Yahoo Finance
    const dxyRes = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB',
      {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }
    );
    if (dxyRes.ok) {
      const dxyData = await dxyRes.json();
      const meta = dxyData?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice && meta?.chartPreviousClose) {
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose;
        const change = price - prevClose;
        const percentChange = (change / prevClose) * 100;
        events.push({
          id: `td-dxy-${Date.now()}`,
          category: 'dollar_strength',
          title: `DXY is ${change >= 0 ? 'up' : 'down'} ${Math.abs(percentChange).toFixed(2)}% at ${price.toFixed(2)}`,
          description: `US Dollar Index moved ${change >= 0 ? 'higher' : 'lower'}. Current: ${price.toFixed(2)}, Previous Close: ${prevClose.toFixed(2)} (${percentChange.toFixed(2)}%)`,
          timestamp: new Date().toISOString(),
          impact: 'medium',
          value: percentChange >= 0 ? 'strong' : 'weak',
          sourceName: 'yahoo',
        });
      }
    }
  } catch {
    // non-critical
  }

  try {
    // US 10Y Yield via Alpha Vantage (more reliable for yields)
    const avKey = process.env.AV_API_KEY;
    if (avKey) {
      const tnxRes = await fetch(
        `https://www.alphavantage.co/query?function=TREASURY_YIELD&interval=daily&maturity=10year&apikey=${avKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (tnxRes.ok) {
        const tnxData = await tnxRes.json();
        const data = tnxData?.data;
        if (Array.isArray(data) && data.length >= 2) {
          const latest = parseFloat(data[0].value);
          const prev = parseFloat(data[1].value);
          if (!isNaN(latest) && !isNaN(prev)) {
            const diff = latest - prev;
            events.push({
              id: `td-tnx-${Date.now()}`,
              category: 'yields',
              title: `US 10Y Yield ${diff >= 0 ? 'rises' : 'falls'} ${Math.abs(diff).toFixed(2)}bps to ${latest.toFixed(2)}%`,
              description: `US 10-year Treasury yield moved from ${prev.toFixed(2)}% to ${latest.toFixed(2)}%.`,
              timestamp: new Date().toISOString(),
              impact: 'medium',
              value: diff >= 0 ? 'rising' : 'falling',
              sourceName: 'alphavantage',
            });
          }
        }
      }
    }
  } catch {
    // non-critical
  }

  setCache(CACHE_KEY, events, CACHE_TTL);
  return events;
}
