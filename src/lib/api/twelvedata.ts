import { MacroEvent } from '../types';
import { getCached, setCache } from './cache';

const BASE_URL = 'https://api.twelvedata.com';
const CACHE_KEY = 'twelvedata_quotes';
const CACHE_TTL = 120_000;

interface TwelveDataQuote {
  symbol: string;
  name: string;
  price: string;
  change: string;
  percent_change: string;
  previous_close: string;
}

export async function fetchMarketData(): Promise<MacroEvent[]> {
  const cached = getCached<MacroEvent[]>(CACHE_KEY);
  if (cached) return cached;

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return [];

  const events: MacroEvent[] = [];

  try {
    // DXY (US Dollar Index)
    const dxyRes = await fetch(
      `${BASE_URL}/quote?symbol=DX-Y.NYB&apikey=${apiKey}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (dxyRes.ok) {
      const dxy: TwelveDataQuote = await dxyRes.json();
      if (dxy.price) {
        const change = parseFloat(dxy.percent_change);
        if (!isNaN(change)) {
          events.push({
            id: `td-dxy-${Date.now()}`,
            category: 'dollar_strength',
            title: `DXY is ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(2)}% at ${dxy.price}`,
            description: `US Dollar Index moved ${change >= 0 ? 'higher' : 'lower'}. Current: ${dxy.price}, Change: ${dxy.change} (${dxy.percent_change}%)`,
            timestamp: new Date().toISOString(),
            impact: 'medium',
            value: change >= 0 ? 'strong' : 'weak',
            sourceName: 'twelvedata',
          });
        }
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
