import type { AssetSymbol, MacroEvent } from './types';

export interface MarketMove {
  ticker: string;
  proxy: boolean;
  price: number;
  previousClose: number;
  sessionChangePercent: number;
  recentChangePercent: number | null;
}

export const MARKET_REFERENCES: Record<AssetSymbol, { ticker: string; proxy: boolean; sessionScale: number; recentScale: number }> = {
  US100: { ticker: '^NDX', proxy: false, sessionScale: 1, recentScale: 0.5 },
  US500: { ticker: '^GSPC', proxy: false, sessionScale: 1, recentScale: 0.5 },
  DJ30: { ticker: '^DJI', proxy: false, sessionScale: 1, recentScale: 0.5 },
  XAUUSD: { ticker: 'GC=F', proxy: true, sessionScale: 1, recentScale: 0.5 },
  BTCUSD: { ticker: 'BTC-USD', proxy: false, sessionScale: 2, recentScale: 1 },
  GBPUSD: { ticker: 'GBPUSD=X', proxy: false, sessionScale: 0.4, recentScale: 0.2 },
  EURUSD: { ticker: 'EURUSD=X', proxy: false, sessionScale: 0.4, recentScale: 0.2 },
  USDJPY: { ticker: 'JPY=X', proxy: false, sessionScale: 0.4, recentScale: 0.2 },
  USDCHF: { ticker: 'CHF=X', proxy: false, sessionScale: 0.4, recentScale: 0.2 },
  AUDUSD: { ticker: 'AUDUSD=X', proxy: false, sessionScale: 0.4, recentScale: 0.2 },
  USDCAD: { ticker: 'CAD=X', proxy: false, sessionScale: 0.4, recentScale: 0.2 },
  NZDUSD: { ticker: 'NZDUSD=X', proxy: false, sessionScale: 0.4, recentScale: 0.2 },
};

/** A continuation hypothesis, with the latest hour able to pull against the session move. */
export function momentumScore(symbol: AssetSymbol, move: MarketMove): number {
  const scale = MARKET_REFERENCES[symbol];
  const session = Math.tanh(move.sessionChangePercent / scale.sessionScale);
  const recent = move.recentChangePercent === null ? session : Math.tanh(move.recentChangePercent / scale.recentScale);
  return Math.round(100 * (0.6 * session + 0.4 * recent));
}

export function momentumEvent(symbol: AssetSymbol, move: MarketMove, timestamp: string): MacroEvent {
  const score = momentumScore(symbol, move);
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const reference = MARKET_REFERENCES[symbol];
  return {
    id: `momentum:${symbol}:${timestamp}`, category: 'price_momentum', symbol,
    seriesId: `price:${symbol}`, evidenceType: 'market', value: score > 0 ? 'bullish' : score < 0 ? 'bearish' : 'neutral',
    title: `${symbol}: ${signed(move.sessionChangePercent)} this session${move.recentChangePercent === null ? '' : `, ${signed(move.recentChangePercent)} over the latest hour`}`,
    description: `${reference.ticker}${move.proxy ? ' futures proxy for spot gold' : ' market reference'}: ${move.price}; previous close ${move.previousClose}. Observed quote at ${timestamp}. The forecast extrapolates this trend; the future move is not observed.`,
    impact: 'high', sourceName: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encodeURIComponent(reference.ticker)}/`,
    timestamp, expiresAt: new Date(Date.parse(timestamp) + 30 * 60_000).toISOString(), marketMove: move,
  };
}
