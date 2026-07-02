import { MacroEvent } from './types';
import { fetchAllEvents } from './api';

export const baselineEvents: MacroEvent[] = [
  {
    id: 'base-fed-dovish',
    category: 'central_bank',
    title: 'Fed Signals Dovish Stance',
    description: 'Federal Reserve officials indicate willingness to cut rates if inflation continues to moderate, weakening the USD.',
    timestamp: new Date().toISOString(),
    impact: 'high',
    value: 'dovish',
  },
  {
    id: 'base-usd-mixed',
    category: 'dollar_strength',
    title: 'USD Shows Mixed Momentum',
    description: 'The US Dollar Index shows mixed momentum as markets balance Fed expectations with economic resilience.',
    timestamp: new Date().toISOString(),
    impact: 'medium',
    value: 'weak',
  },
  {
    id: 'base-yields-stable',
    category: 'yields',
    title: 'US 10Y Yield Holds Steady',
    description: 'US 10-year Treasury yield remains relatively stable as markets digest economic data.',
    timestamp: new Date().toISOString(),
    impact: 'medium',
    value: 'falling',
  },
  {
    id: 'base-risk-cautious',
    category: 'risk_sentiment',
    title: 'Cautious Risk Sentiment Prevails',
    description: 'Markets remain cautiously positioned amid mixed economic signals and geopolitical watch.',
    timestamp: new Date().toISOString(),
    impact: 'medium',
    value: 'risk_off',
  },
  {
    id: 'base-inflation-mod',
    category: 'inflation',
    title: 'Inflation Moderates Gradually',
    description: 'Inflation shows gradual moderation, supporting expectations of eventual policy easing by major central banks.',
    timestamp: new Date().toISOString(),
    impact: 'medium',
    value: 'low',
  },
  {
    id: 'base-gbp-support',
    category: 'central_bank',
    title: 'BoE Maintains Cautious Stance',
    description: 'Bank of England maintains cautious monetary policy stance, providing some support for GBP.',
    timestamp: new Date().toISOString(),
    impact: 'medium',
    value: 'dovish',
  },
];

function mergeEvents(baseline: MacroEvent[], live: MacroEvent[]): MacroEvent[] {
  const liveCategories = new Set(live.map((e) => `${e.category}:${e.value}`));
  const filtered = baseline.filter(
    (e) => !liveCategories.has(`${e.category}:${e.value}`)
  );
  return [...filtered, ...live];
}

export async function getEvents(): Promise<{
  events: MacroEvent[];
  source: 'live' | 'hybrid' | 'mock';
}> {
  try {
    const liveEvents = await fetchAllEvents();

    if (liveEvents.length > 0) {
      const merged = mergeEvents(baselineEvents, liveEvents);
      return { events: merged, source: 'hybrid' };
    }
  } catch {
    // fall through
  }

  return {
    events: baselineEvents.map((e) => ({ ...e, timestamp: new Date().toISOString() })),
    source: 'mock',
  };
}
