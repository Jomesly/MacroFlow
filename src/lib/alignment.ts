import { calculateBias, cappedCategoryPoints, HIGH_CONVICTION_PERCENT } from './engine';
import { MODEL_VERSION, selectEventsAsOf, unknownContext } from './macro-context';
import type { AssetSymbol, MacroContext, MacroEvent, AlignmentAssessment } from './types';

export function scoreMacroAlignment(events: MacroEvent[], context: MacroContext, asOf: string, symbol?: AssetSymbol) {
  const contextAge = Date.parse(asOf) - Date.parse(context.asOf);
  const safeContext = Number.isFinite(contextAge) && contextAge >= 0 && contextAge < 2 * 86_400_000
    ? context : unknownContext(asOf, 'Regime context is stale or from the future');
  const selected = selectEventsAsOf(events, asOf).filter(event => {
    // Currency-cross and yield headlines are ambiguous proxies and can duplicate
    // the measured observations. Only the price adapter supplies these inputs.
    if (['dollar_strength', 'yields'].includes(event.category) && event.evidenceType !== 'market') return false;
    if (!['inflation', 'employment', 'gdp', 'pmi', 'retail_sales'].includes(event.category)) return true;
    // A news mention is neither a measured trend nor a verified release surprise.
    return (event.evidenceType === 'trend' || event.evidenceType === 'surprise')
      && ['US', 'GB', 'UK', 'EU', 'JP', 'CH', 'AU', 'CA', 'NZ', 'UNITED STATES', 'UNITED KINGDOM'].includes(event.country?.toUpperCase() ?? '');
  });
  return calculateBias(selected, symbol, safeContext).map(result => {
    const reasons: string[] = [];
    const supportive = result.events.filter(event => event.scoreChange * result.biasScore > 0);
    const categoryTotals = cappedCategoryPoints(result.events);
    const categories = new Set([...categoryTotals].filter(([, score]) => score * result.biasScore > 0).map(([category]) => category));
    const marketScore = [...cappedCategoryPoints(result.events.filter(event => event.evidenceType === 'market')).values()]
      .reduce((sum, score) => sum + score, 0);
    const hasMarket = selected.some(event => event.evidenceType === 'market' && ['dollar_strength', 'yields'].includes(event.category));
    const marketConfirmation: NonNullable<AlignmentAssessment['marketConfirmation']> = !hasMarket ? 'missing' : marketScore === 0 ? 'flat'
      : marketScore * result.biasScore > 0 ? 'confirming' : 'opposing';
    const hasPrimary = supportive.some(event => categories.has(event.category)
      && (event.evidenceType === 'surprise' || event.evidenceType === 'trend'));
    if (!safeContext.complete) reasons.push('Fresh macro and rate context is incomplete.');
    if (['US100', 'DJ30', 'US500'].includes(result.symbol) && ['mixed', 'unknown'].includes(safeContext.regime)) reasons.push('The equity growth/rate regime is unresolved.');
    if (!hasPrimary) reasons.push('No structured economic evidence supports the bias.');
    if (!hasMarket) reasons.push('No market observations from the past four hours.');
    const insufficient = reasons.length > 0;
    if (marketConfirmation === 'opposing') reasons.push('Market observations oppose the macro direction.');
    if (marketConfirmation === 'flat') reasons.push('Market observations are neutral; confirmation is pending.');
    if (Math.abs(result.biasPercent) < HIGH_CONVICTION_PERCENT) reasons.push('Displayed bias strength is below 50%.');
    if (result.confirmationRatio < 60 || categories.size < 3) reasons.push('Evidence is mixed or lacks category breadth.');
    const status: AlignmentAssessment['status'] = insufficient ? 'insufficient_evidence'
      : marketConfirmation === 'flat' ? 'unconfirmed' : reasons.length ? 'conflicted' : 'aligned';
    return {
      ...result,
      conviction: status === 'aligned' ? result.conviction : 'low' as const,
      signal: status === 'aligned' ? result.signal : 'neutral' as const,
      lastUpdated: asOf,
      alignment: { modelVersion: MODEL_VERSION, horizonHours: 4 as const, status, marketConfirmation, reasons,
        context: safeContext, probability: null, validation: 'unvalidated' as const },
    };
  });
}
