import type { AssetSymbol } from '../types';

// These are reference-page links, not API identifiers or approved widget entitlements.
export const referenceCharts: Record<
  AssetSymbol,
  { name: string; url: string; note: string; widgetCandidate: string }
> = {
  XAUUSD: {
    name: 'Gold / US dollar',
    url: 'https://www.tradingview.com/symbols/XAUUSD/?exchange=OANDA',
    widgetCandidate: 'OANDA:XAUUSD',
    note: 'Gold quoted in US dollars. Provider quotes can differ from your broker.',
  },
  GBPUSD: {
    name: 'Pound / US dollar',
    url: 'https://www.tradingview.com/symbols/GBPUSD/?exchange=FXCM',
    widgetCandidate: 'FX:GBPUSD',
    note: 'GBP/USD reference. Provider quotes can differ from your broker.',
  },
  US100: {
    name: 'Nasdaq-100 index',
    url: 'https://www.tradingview.com/symbols/NASDAQ-NDX/',
    widgetCandidate: 'NASDAQ:NDX',
    note: 'Nasdaq-100 cash index reference. Your broker’s US100 CFD can trade at a different price.',
  },
  DJ30: {
    name: 'Dow Jones Industrial Average',
    url: 'https://www.tradingview.com/symbols/DJ-DJI/',
    widgetCandidate: 'DJ:DJI',
    note: 'Dow Jones cash index reference. Your broker’s DJ30 CFD can trade at a different price.',
  },
  BTCUSD: {
    name: 'Bitcoin / US dollar',
    url: 'https://www.tradingview.com/symbols/BTCUSD/?exchange=BITSTAMP',
    widgetCandidate: 'BITSTAMP:BTCUSD',
    note: 'BTC/USD spot reference. Exchange prices can differ from your broker.',
  },
  US500: {
    name: 'S&P 500 index',
    url: 'https://www.tradingview.com/symbols/SPX/',
    widgetCandidate: 'SP:SPX',
    note: 'S&P 500 cash index reference. Your broker’s US500 CFD can trade at a different price.',
  },
  EURUSD: {
    name: 'Euro / US dollar',
    url: 'https://www.tradingview.com/symbols/EURUSD/?exchange=FXCM',
    widgetCandidate: 'FX:EURUSD',
    note: 'EUR/USD reference. Provider quotes can differ from your broker.',
  },
  USDJPY: {
    name: 'US dollar / Japanese yen',
    url: 'https://www.tradingview.com/symbols/USDJPY/?exchange=FXCM',
    widgetCandidate: 'FX:USDJPY',
    note: 'USD/JPY reference. Provider quotes can differ from your broker.',
  },
  USDCHF: {
    name: 'US dollar / Swiss franc',
    url: 'https://www.tradingview.com/symbols/USDCHF/?exchange=FXCM',
    widgetCandidate: 'FX:USDCHF',
    note: 'USD/CHF reference. Provider quotes can differ from your broker.',
  },
  AUDUSD: {
    name: 'Australian dollar / US dollar',
    url: 'https://www.tradingview.com/symbols/AUDUSD/?exchange=FXCM',
    widgetCandidate: 'FX:AUDUSD',
    note: 'AUD/USD reference. Provider quotes can differ from your broker.',
  },
  USDCAD: {
    name: 'US dollar / Canadian dollar',
    url: 'https://www.tradingview.com/symbols/USDCAD/?exchange=FXCM',
    widgetCandidate: 'FX:USDCAD',
    note: 'USD/CAD reference. Provider quotes can differ from your broker.',
  },
  NZDUSD: {
    name: 'New Zealand dollar / US dollar',
    url: 'https://www.tradingview.com/symbols/NZDUSD/?exchange=FXCM',
    widgetCandidate: 'FX:NZDUSD',
    note: 'NZD/USD reference. Provider quotes can differ from your broker.',
  },
};
