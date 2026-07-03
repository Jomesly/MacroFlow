/**
 * Fetch historical OHLC data for backtesting.
 *
 * Uses Twelve Data API (free tier: ~60 days lookback for intraday).
 * Outputs: data/historical-prices/{symbol}.json
 *
 * Usage: npx tsx scripts/fetch-historical-prices.ts [days_back]
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = value;
    }
  }
}

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const API_KEY = process.env.TWELVE_DATA_API_KEY || '';

const SYMBOLS = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'] as const;

// Map our symbols to Twelve Data ticker symbols
const TICKER_MAP: Record<string, string> = {
  XAUUSD: 'XAU/USD',
  GBPUSD: 'GBP/USD',
  US100: 'US100',    // Nasdaq 100
  DJ30: 'DJI',       // Dow Jones
  BTCUSD: 'BTC/USD',
};

interface OhlcvBar {
  datetime: string;  // ISO format
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchTwelveData(
  symbol: string,
  interval: string,
  startDate: string,
  endDate: string
): Promise<OhlcvBar[]> {
  const ticker = TICKER_MAP[symbol] || symbol;
  const url = `${TWELVE_DATA_BASE}/time_series?symbol=${ticker}&interval=${interval}&start_date=${startDate}&end_date=${endDate}&apikey=${API_KEY}&outputsize=5000`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    console.error(`  Twelve Data error for ${symbol}: ${res.status}`);
    return [];
  }

  const data = await res.json();
  if (data.status === 'error' || !data.values) {
    console.error(`  Twelve Data API error for ${symbol}: ${data.message || 'unknown'}`);
    return [];
  }

  return data.values.map((bar: { datetime: string; open: string; high: string; low: string; close: string; volume: string }) => ({
    datetime: new Date(bar.datetime).toISOString(),
    open: parseFloat(bar.open),
    high: parseFloat(bar.high),
    low: parseFloat(bar.low),
    close: parseFloat(bar.close),
    volume: parseInt(bar.volume || '0', 10),
  }));
}

async function fetchYahooFinance(symbol: string, range: string, interval: string): Promise<OhlcvBar[]> {
  const tickerMap: Record<string, string> = {
    XAUUSD: 'GC=F',
    GBPUSD: 'GBPUSD=X',
    US100: '^NDX',
    DJ30: '^DJI',
    BTCUSD: 'BTC-USD',
  };
  const ticker = tickerMap[symbol] || symbol;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) {
    console.error(`  Yahoo error for ${symbol}: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp) {
    console.error(`  Yahoo no data for ${symbol}`);
    return [];
  }

  const { timestamp, indicators } = result;
  const quote = indicators.quote[0];
  const bars: OhlcvBar[] = [];

  for (let i = 0; i < timestamp.length; i++) {
    if (quote.open[i] !== null && quote.close[i] !== null) {
      bars.push({
        datetime: new Date(timestamp[i] * 1000).toISOString(),
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i] || 0,
      });
    }
  }

  return bars;
}

async function main() {
  if (!API_KEY) {
    console.error('TWELVE_DATA_API_KEY not set');
    process.exit(1);
  }

  const daysBack = parseInt(process.argv[2] || '30', 10);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  console.log(`Fetching ${daysBack} days of data: ${startStr} to ${endStr}`);
  console.log(`Symbols: ${SYMBOLS.join(', ')}`);

  const outDir = path.join(process.cwd(), 'data', 'historical-prices');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const symbol of SYMBOLS) {
    console.log(`\nFetching ${symbol}...`);

    // Try Twelve Data first (15min intervals for backtesting)
    let bars = await fetchTwelveData(symbol, '15min', startStr, endStr);

    // Fallback to Yahoo if Twelve Data fails (for BTCUSD especially)
    if (bars.length === 0) {
      console.log(`  Falling back to Yahoo Finance for ${symbol}...`);
      bars = await fetchYahooFinance(symbol, `${daysBack}d`, '15m');
    }

    // Sort chronologically
    bars.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    const outFile = path.join(outDir, `${symbol}.json`);
    fs.writeFileSync(outFile, JSON.stringify(bars, null, 2));
    console.log(`  Saved ${bars.length} bars to ${outFile}`);
  }

  console.log('\nDone.');
}

main().catch(console.error);
