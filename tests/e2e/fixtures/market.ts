import type { BiasApiResponse, BiasResult } from '../../../src/lib/types';

// Synthetic market fixtures keep visual checks deterministic and independent of providers.
const now = '2026-10-31T12:00:00.000Z';
const assets: [
  BiasResult['symbol'],
  string,
  number,
  BiasResult['direction'],
][] = [
  ['XAUUSD', 'Gold', 42, 'bullish'],
  ['GBPUSD', 'British Pound / US Dollar', -28, 'weakly_bearish'],
  ['US100', 'Nasdaq 100', 65, 'bullish'],
  ['DJ30', 'Dow Jones 30', 0, 'neutral'],
  ['BTCUSD', 'Bitcoin', -55, 'bearish'],
];
export const fixture: BiasApiResponse = {
  timestamp: now,
  source: 'live',
  disclaimer: 'Test fixture',
  sourceHealth: { fred: 'ok', finnhub: 'ok', rss: 'empty', market_data: 'ok' },
  dxy: {
    price: '103.42',
    percentChange: -0.18,
    status: 'weakening',
    summary: 'A softer dollar provides context for dollar-denominated markets.',
  },
  nextEvent: {
    name: 'US employment report',
    country: 'US',
    date: '2026-11-06T13:30:00Z',
    impact: 'high',
    affects: ['XAUUSD', 'GBPUSD', 'US100'],
  },
  data: assets.map(([symbol, name, score, direction], i) => ({
    symbol,
    name,
    biasScore: score,
    biasPercent: score,
    direction,
    strength: 'moderate',
    conviction: i % 2 === 0 ? 'high' : 'medium',
    signal: score > 0 ? 'buy' : score < 0 ? 'sell' : 'neutral',
    dailyLabel: direction.replaceAll('_', ' '),
    drivers: ['Macro context'],
    confirmationRatio: 64 + i * 3,
    eventCount: 9 + i,
    confidenceCount: 7,
    totalPossibleSignals: 12,
    lastUpdated: now,
    history: [12, 20, 8, 25, 17, 31, score].map((biasScore, day) => ({
      date: `2026-10-${24 + day}`,
      biasScore: score < 0 ? -Math.abs(biasScore) : biasScore,
      direction,
    })),
    events: [
      {
        id: `event-${i}`,
        title: [
          'Federal Reserve policy outlook in focus',
          'Dollar softens as markets assess economic data',
          'US earnings shape the equity outlook',
          'Markets weigh growth and inflation',
          'Digital asset markets react to macro conditions',
        ][i],
        description: 'Deterministic browser-test event. No live market claim.',
        category: 'fed_tone',
        impact: 'high',
        scoreChange: score,
        sourceName: 'Test market feed',
      },
    ],
  })),
};
export const contextMeta = {
  provider: 'Fixture source', instrumentId: 'fixture', sourceUrl: 'https://example.com',
  observedAt: '2026-11-05T00:00:00.000Z', fetchedAt: new Date().toISOString(),
  freshUntil: new Date(Date.now() + 3_600_000).toISOString(),
  staleUntil: new Date(Date.now() + 86_400_000).toISOString(), status: 'fresh', delayed: true,
};
export const calendarFixture = {
  meta: { ...contextMeta, observedAt: null, delayed: false },
  data: {
    windowStart: '2026-11-08T00:00:00.000Z', windowEnd: '2026-11-14T23:00:00.000Z',
    events: [
      { id: 'cpi', title: 'US CPI fixture', currency: 'USD', date: '2026-11-10T13:30:00.000Z', impact: 'high', forecast: '2.4%', previous: '2.5%', actual: null, affects: ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'] },
      { id: 'gdp', title: 'UK GDP fixture', currency: 'GBP', date: '2026-11-11T07:00:00.000Z', impact: 'medium', forecast: null, previous: '0.1%', actual: null, affects: ['GBPUSD'] },
    ],
  },
};
export const macroFixture = Object.fromEntries([
  ['dxy', 103.42, 'index'], ['treasury2y', 4.46, 'percent'], ['treasury10y', 4.84, 'percent'],
  ['spread', 38, 'basis-points'], ['vix', 28.18, 'index'],
].map(([key, value, unit]) => [key, { meta: contextMeta, data: { value, unit } }]));
