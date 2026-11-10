import { calculateBias } from './engine';
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
    return !['inflation', 'employment', 'gdp', 'pmi', 'retail_sales'].includes(event.category)
      || ['US', 'GB', 'UK', 'UNITED STATES', 'UNITED KINGDOM'].includes(event.country?.toUpperCase() ?? '');
  });
  return calculateBias(selected, symbol, safeContext).map(result => {
    const reasons: string[] = [];
    const supportive = result.events.filter(event => event.scoreChange * result.biasScore > 0);
    const categoryTotals = new Map<string, number>();
    for (const event of result.events) categoryTotals.set(event.category, (categoryTotals.get(event.category) ?? 0) + event.scoreChange);
    const categories = new Set([...categoryTotals].filter(([, score]) => score * result.biasScore > 0).map(([category]) => category));
    const marketScore = result.events.filter(event => event.evidenceType === 'market').reduce((sum, event) => sum + event.scoreChange, 0);
    const hasPrimary = supportive.some(event => event.evidenceType === 'surprise' || event.evidenceType === 'trend');
    if (!safeContext.complete) reasons.push('Fresh macro and rate context is incomplete.');
    if (['US100', 'DJ30'].includes(result.symbol) && ['mixed', 'unknown'].includes(safeContext.regime)) reasons.push('The equity growth/rate regime is unresolved.');
    if (!hasPrimary) reasons.push('No structured economic evidence supports the bias.');
    if (!selected.some(event => event.evidenceType === 'market' && ['dollar_strength', 'yields'].includes(event.category))) reasons.push('No market observations from the past four hours.');
    const insufficient = reasons.length > 0;
    if (marketScore * result.biasScore <= 0) reasons.push('Market evidence does not confirm the bias.');
    if (Math.abs(result.biasScore) < 50) reasons.push('Bias strength is below 50.');
    if (result.confirmationRatio < 60 || categories.size < 3) reasons.push('Evidence is mixed or lacks category breadth.');
    const status: AlignmentAssessment['status'] = insufficient ? 'insufficient_evidence' : reasons.length ? 'conflicted' : 'aligned';
    return {
      ...result,
      conviction: status === 'aligned' ? result.conviction : 'low' as const,
      signal: status === 'aligned' ? result.signal : 'neutral' as const,
      lastUpdated: asOf,
      alignment: { modelVersion: MODEL_VERSION, horizonHours: 4 as const, status, reasons,
        context: safeContext, probability: null, validation: 'unvalidated' as const },
    };
  });
}
