import type { BiasResult, Direction, ScoredEvent } from './types';

export interface MarketFactor {
  id: string;
  /** The macro channel in plain words, e.g. "Fed hawkish" or "US yields rising". */
  reason: string;
  /** The strongest story or data point behind this channel. */
  title: string;
  side: 'bullish' | 'bearish';
  /** News headlines versus slower economic data and market observations. */
  kind: 'news' | 'macro';
  source?: string;
}

const BANKS: Partial<Record<ScoredEvent['category'], string>> = {
  fed_tone: 'Fed', boe_tone: 'BoE', ecb_tone: 'ECB', boj_tone: 'BoJ', snb_tone: 'SNB', rba_tone: 'RBA', boc_tone: 'BoC', rbnz_tone: 'RBNZ',
};
const DATA: Partial<Record<ScoredEvent['category'], string>> = { employment: 'jobs', gdp: 'GDP', pmi: 'PMI', retail_sales: 'retail sales' };
const COUNTRIES: Record<string, string> = { US: 'US', GB: 'UK', UK: 'UK', JP: 'Japan', EU: 'Eurozone', CH: 'Swiss', AU: 'Australia', CA: 'Canada', NZ: 'New Zealand' };

/** Explain why a story matters to the chart, rather than only quoting its headline. */
export function factorReason(event: Pick<ScoredEvent, 'category' | 'value' | 'country'>): string {
  const value = (event.value ?? '').replaceAll('_', ' ');
  if (!value && event.category !== 'asset_sentiment') return 'Other news';
  // Name a country only when the story identifies one; never guess.
  const known = event.country ? COUNTRIES[event.country.toUpperCase()] : undefined;
  const country = known ? `${known} ` : '';
  const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const bank = BANKS[event.category];
  if (bank) return `${bank} ${value}`;
  const data = DATA[event.category];
  if (data) return sentence(`${country}${data} ${value}`);
  switch (event.category) {
    case 'dollar_strength': return event.value === 'strong' ? 'US dollar strengthening' : event.value === 'weak' ? 'US dollar weakening' : `US dollar ${value}`;
    case 'yen_strength': return event.value === 'strong' ? 'Yen strengthening' : event.value === 'weak' ? 'Yen weakening' : `Yen ${value}`;
    case 'yields': return sentence(`${country}yields ${value}`);
    case 'inflation': return sentence(`${country}inflation ${event.value === 'high' ? 'hot' : event.value === 'low' ? 'cooling' : value}`);
    case 'risk_sentiment': return event.value === 'risk_on' ? 'Risk-on mood' : event.value === 'risk_off' ? 'Risk-off mood' : `Risk mood ${value}`;
    case 'geopolitical': return event.value === 'tension' ? 'Geopolitical tension' : event.value === 'easing' ? 'Geopolitical tension easing' : `Geopolitics ${value}`;
    case 'earnings': return `Earnings ${value}`;
    case 'crypto_regulation': return `Crypto regulation ${value}`;
    case 'asset_sentiment': return event.value === 'bullish' ? 'Direct report: price rising' : event.value === 'bearish' ? 'Direct report: price falling' : 'Direct price report';
    default: return 'Other news';
  }
}

/**
 * One factor per driver channel and side, supporting factors first. The bias score counts
 * only the strongest story in each channel, so repeated stories are not listed.
 */
export function marketFactors(item: BiasResult, limit = 3): MarketFactor[] {
  const channels = new Map<string, ScoredEvent>();
  for (const event of item.events) {
    if (!event.scoreChange || event.category === 'price_momentum') continue;
    const kind = !event.evidenceType || event.evidenceType === 'headline' ? 'news' : 'macro';
    const key = `${kind}:${event.category}:${event.scoreChange > 0 ? 'bullish' : 'bearish'}`;
    const current = channels.get(key);
    if (!current || Math.abs(event.scoreChange) > Math.abs(current.scoreChange)) channels.set(key, event);
  }
  // Lead with the factors behind the bias, then the strongest risks against it.
  const supports = (event: ScoredEvent) => (event.scoreChange * item.biasScore > 0 ? 0 : 1);
  return [...channels.values()]
    .sort((a, b) => supports(a) - supports(b) || Math.abs(b.scoreChange) - Math.abs(a.scoreChange) || a.id.localeCompare(b.id))
    .map((event): MarketFactor => ({ id: event.id, reason: factorReason(event), title: event.title,
      side: event.scoreChange > 0 ? 'bullish' : 'bearish',
      kind: !event.evidenceType || event.evidenceType === 'headline' ? 'news' : 'macro', source: event.sourceName }))
    .slice(0, limit);
}

export function factorCounts(item: BiasResult): { bullish: number; bearish: number } {
  const factors = marketFactors(item, Infinity);
  return { bullish: factors.filter(f => f.side === 'bullish').length, bearish: factors.filter(f => f.side === 'bearish').length };
}

export function biasWord(direction: Direction): 'Bullish' | 'Bearish' | 'Neutral' {
  return direction.includes('bullish') ? 'Bullish' : direction.includes('bearish') ? 'Bearish' : 'Neutral';
}

export function convictionLabel(item: BiasResult): string {
  if (item.direction === 'neutral') return item.eventCount ? 'Factors are balanced' : 'No fresh factors';
  return `${item.conviction.charAt(0).toUpperCase()}${item.conviction.slice(1)} conviction`;
}
