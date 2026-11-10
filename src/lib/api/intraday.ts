import { type PriceDataset, type IntradayBar, validBar } from '../market-evidence';

const newYorkClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Cash-index last bars are only 30 minutes; do not label them as full hours. */
export function isFullCashIndexHour(openTime: string): boolean {
  const parts = newYorkClock.formatToParts(new Date(openTime));
  const minutes = Number(parts.find(part => part.type === 'hour')!.value) * 60 + Number(parts.find(part => part.type === 'minute')!.value);
  return minutes >= 570 && minutes + 60 <= 960;
}

export async function fetchYahooHourly(instrument: string, ticker: string, range: '5d' | '60d'): Promise<PriceDataset> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set('range', range);
  url.searchParams.set('interval', '1h');
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'MacroFlow/3' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Hourly prices HTTP ${response.status}`);
  const data = await response.json();
  const result = data.chart?.result?.[0];
  if (!Array.isArray(result?.timestamp) || !result.indicators?.quote?.[0]) throw new Error('Hourly prices unavailable');
  const quote = result.indicators.quote[0];
  const now = Date.now();
  const bars: IntradayBar[] = result.timestamp.map((time: number, i: number) => ({
    openTime: new Date(time * 1000).toISOString(), closeTime: new Date((time + 3600) * 1000).toISOString(),
    open: quote.open[i], high: quote.high[i], low: quote.low[i], close: quote.close[i],
  })).filter((bar: IntradayBar, index: number) => validBar(bar) && Date.parse(bar.closeTime) <= now
    && (!['US100', 'DJ30'].includes(instrument) || (isFullCashIndexHour(bar.openTime)
      && result.timestamp[index + 1] - result.timestamp[index] === 3600)));
  return { schemaVersion: 1, instrument, provider: 'Yahoo Finance', intervalMinutes: 60, fetchedAt: new Date(now).toISOString(), bars };
}
