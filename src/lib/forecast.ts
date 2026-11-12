import { scoreMacroAlignment } from './alignment';
import { calculateBias } from './engine';
import { selectEventsAsOf } from './macro-context';
import type { AssetSymbol, BiasResult, Direction, MacroContext, MacroEvent, ScoredEvent } from './types';

export const FORECAST_VERSION = 'macro-factors-v3-4h-2026-11-12';

function articleKey(event: MacroEvent): string {
  if (event.url) {
    try {
      const url = new URL(event.url);
      return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
    } catch { /* Fall back to the headline when a provider supplies an invalid URL. */ }
  }
  return event.description.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function forecastDirection(score: number): Direction {
  if (score >= 50) return 'bullish';
  if (score > 0) return 'weakly_bullish';
  if (score <= -50) return 'bearish';
  if (score < 0) return 'weakly_bearish';
  return 'neutral';
}

/**
 * Four-hour macro and news bias. Price action is deliberately not scored: the
 * dashboard lists the fundamental factors, and traders confirm with technicals.
 */
export function scoreMarketForecast(events: MacroEvent[], context: MacroContext, asOf: string, symbol?: AssetSymbol): BiasResult[] {
  const selected = selectEventsAsOf(events, asOf);
  return scoreMacroAlignment(events, context, asOf, symbol).map(macro => {
    const price = selected.find(event => event.category === 'price_momentum' && event.symbol === macro.symbol && event.marketMove);
    const stories = new Map<string, { event: MacroEvent; scored: ScoredEvent }[]>();
    const titles = new Map<string, string>();
    for (const event of selected) {
      if (event.category === 'price_momentum') continue;
      const [result] = calculateBias([event], macro.symbol, macro.alignment?.context ?? context);
      const localYields: Partial<Record<AssetSymbol, string>> = { GBPUSD: 'GB', USDJPY: 'JP' };
      const localYieldSign = macro.symbol === 'USDJPY' ? -1 : 1;
      const narrativeScore = event.symbol && event.symbol !== macro.symbol ? null
        : event.category === 'asset_sentiment' && event.symbol === macro.symbol ? (event.value === 'bullish' ? 30 : event.value === 'bearish' ? -30 : null)
        : event.category === 'yen_strength' && macro.symbol === 'USDJPY' ? (event.value === 'weak' ? 25 : event.value === 'strong' ? -25 : null)
        : event.category === 'yields' && event.country && event.country === localYields[macro.symbol] ? (event.value === 'rising' ? 20 : event.value === 'falling' ? -20 : 0) * localYieldSign
        : null;
      const scored: ScoredEvent | undefined = narrativeScore !== null ? { ...event, scoreChange: narrativeScore } : result.events[0];
      if (!scored) continue;
      const headline = !event.evidenceType || event.evidenceType === 'headline';
      const ageHours = (Date.parse(asOf) - Date.parse(event.timestamp)) / 3_600_000;
      // News has a six-hour half-life. Slow economic trends serve as a weak prior.
      const weight = headline ? (event.category === 'asset_sentiment' ? 1 : 0.8) * Math.pow(0.5, ageHours / 6)
        : event.evidenceType === 'trend' ? 0.35 : 1;
      const scoreChange = Math.sign(scored.scoreChange) * Math.round(Math.abs(scored.scoreChange) * weight);
      if (!scoreChange) continue;
      const title = event.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = headline ? titles.get(title) ?? articleKey(event) : event.id;
      if (headline) titles.set(title, key);
      stories.set(key, [...(stories.get(key) ?? []), { event, scored: { ...scored, scoreChange } }]);
    }

    // One story gets one net vote, even when the classifier finds several channels.
    const contributions = [...stories.values()].flatMap(rows => {
      // Direct reporting about this asset takes precedence over generic causal
      // mappings from the same article. Other articles can still oppose it.
      const direct = rows.filter(row => row.event.category === 'asset_sentiment');
      const votes = direct.length ? direct : rows;
      const positive = votes.filter(row => row.scored.scoreChange > 0).sort((a, b) => b.scored.scoreChange - a.scored.scoreChange)[0];
      const negative = votes.filter(row => row.scored.scoreChange < 0).sort((a, b) => a.scored.scoreChange - b.scored.scoreChange)[0];
      const net = (positive?.scored.scoreChange ?? 0) + (negative?.scored.scoreChange ?? 0);
      const representative = net > 0 ? positive : negative;
      return net && representative ? [{ event: representative.event, scored: { ...representative.scored, scoreChange: net } }] : [];
    });
    // Keep macro background in one bounded channel so several slow economic series
    // cannot overwhelm the current asset trend merely by being counted separately.
    const categoryScore = (rows: typeof contributions) => {
      const totals = new Map<string, number[]>();
      for (const { scored } of rows) totals.set(scored.category, [...(totals.get(scored.category) ?? []), scored.scoreChange]);
      return Math.max(-100, Math.min(100, [...totals.values()].reduce((sum, values) => sum + Math.max(0, ...values) + Math.min(0, ...values), 0)));
    };
    const news = contributions.filter(({ event }) => !event.evidenceType || event.evidenceType === 'headline');
    // Every headline is a news factor (asset moves, central banks, risk, geopolitics).
    // Structured releases and economic trends form the slower macro backdrop.
    const newsRows = news;
    const macroRows = contributions.filter(row => !newsRows.includes(row));
    const components = {
      news: newsRows.length ? { score: Math.max(-100, Math.min(100, Math.round(categoryScore(newsRows) * 1.5))), weight: 0 } : null,
      macro: macroRows.length ? { score: categoryScore(macroRows), weight: 0 } : null,
    };
    // Fresh news leads; slower macro data and policy background set the backdrop.
    if (components.news && components.macro) {
      components.news.weight = 0.7; components.macro.weight = 0.3;
    } else {
      for (const component of Object.values(components)) if (component) component.weight = 1;
    }
    const score = Math.round(Object.values(components).reduce((sum, component) => sum + (component ? component.score * component.weight : 0), 0));
    const direction = forecastDirection(score);
    const sourceCount = new Set(newsRows.map(({ event }) => event.sourceName).filter(Boolean)).size;
    const allContributions = contributions;
    const supporting = allContributions.filter(({ scored }) => scored.scoreChange * score > 0);
    const confirmationRatio = score && allContributions.length ? Math.round(supporting.length / allContributions.length * 100) : 0;
    const basis = !allContributions.length ? 'unavailable' : !news.length ? 'macro' : news.length === contributions.length ? 'news' : 'mixed';
    const limitations = ['Price action is not scored. Confirm the bias with your own technical analysis.'];
    if (basis === 'news') limitations.push('Based on news narratives without structured economic data.');
    if (news.length && sourceCount < 2) limitations.push('Fewer than two identified news sources.');
    if (macro.alignment?.status !== 'aligned') limitations.push('Macro alignment is unconfirmed.');
    if (!allContributions.length) limitations.push('No fresh directional inputs are available.');
    if (allContributions.some(({ scored }) => scored.scoreChange * score < 0) || (!score && allContributions.length)) limitations.push('Fresh inputs disagree on direction.');
    // A trader's conviction: a strong lean, backed by more than one outlet, that
    // the slower macro backdrop does not contradict.
    const macroAgrees = !components.macro || components.macro.score * score >= 0;
    const macroSupports = !!components.macro && components.macro.score * score > 0;
    const conviction = Math.abs(score) >= 60 && sourceCount >= 2 && macroAgrees ? 'high'
      : Math.abs(score) >= 30 && (sourceCount >= 2 || macroSupports) ? 'medium' : 'low';
    const label = direction === 'neutral' ? 'No directional forecast' : `${direction.includes('bullish') ? 'Bullish' : 'Bearish'} lean for the next 4 hours`;
    const scoredEvents = allContributions.map(({ scored }) => scored).sort((a, b) => Math.abs(b.scoreChange) - Math.abs(a.scoreChange) || a.id.localeCompare(b.id));
    return {
      ...macro, scoring: undefined, probability: { status: 'unavailable', target: 'macro-direction-close-4h', horizonHours: 4, direction: score > 0 ? 'up' : score < 0 ? 'down' : null, value: null, interval95: null, calibrationSamples: 0, validationSamples: 0, modelId: null, validUntil: null, reason: 'Experimental narrative forecast has no calibrated probability.' }, biasScore: score, biasPercent: score, direction,
      strength: Math.abs(score) > 50 ? 'strong' : Math.abs(score) > 25 ? 'moderate' : 'weak',
      conviction, signal: score > 0 ? (conviction === 'high' ? 'strong_buy' : 'buy') : score < 0 ? (conviction === 'high' ? 'strong_sell' : 'sell') : 'neutral', dailyLabel: label,
      events: scoredEvents, eventCount: scoredEvents.length, confirmationRatio,
      confidenceCount: Object.values(components).filter(component => component && component.score !== 0).length, totalPossibleSignals: 2,
      drivers: scoredEvents.map(event => `${event.scoreChange > 0 ? 'Bullish' : event.scoreChange < 0 ? 'Bearish' : 'Neutral'}: ${event.title}`),
      forecast: { modelVersion: FORECAST_VERSION, horizonHours: 4, issuedAt: asOf,
        expiresAt: new Date(Date.parse(asOf) + 4 * 3_600_000).toISOString(), basis, summary: label, limitations, sourceCount,
        components, marketMove: price?.marketMove, macroSignal: macro.signal,
        latestEvidenceAt: allContributions.map(({ event }) => event.timestamp).sort().at(-1) ?? null,
        macroBiasScore: macro.biasScore, probability: null },
    };
  });
}
