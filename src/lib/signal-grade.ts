import { FRESH_NEWS_HOURS } from './freshness';
import { assessMacroCoverage, COUNTRY_NAMES } from './macro-coverage';
import type { BiasResult, CalendarEvent, ScoredEvent, TradeSignal } from './types';

export type GradeCheckId = 'fresh_news' | 'macro_match' | 'two_sources' | 'agreement' | 'market_confirms' | 'no_event_risk' | 'healthy_inputs';
export interface GradeCheck { id: GradeCheckId; passed: boolean; label: string; detail?: string }
export interface SignalGradeResult { grade: 'A' | 'B' | 'none'; side: 'long' | 'short' | null; checks: GradeCheck[] }

/**
 * Thresholds fixed before any outcomes were recorded (docs/plans/2026-11-23-macro-matched-signals.md).
 * Changing one changes what a signal is: bump FORECAST_VERSION so the track record restarts.
 */
export const MIN_SIGNAL_SCORE = 30;
const MIN_MACRO_SCORE = 10;
const MIN_AGREEMENT = 0.7;
const EVENT_WINDOW_HOURS = 4;

const LABELS: Record<GradeCheckId, string> = {
  fresh_news: 'Fresh news (under 6 h) supports it',
  macro_match: 'Macro backdrop points the same way',
  two_sources: 'Two or more news sources agree',
  agreement: 'At least 70% of the evidence agrees',
  market_confirms: 'Dollar and yield moves confirm',
  no_event_risk: 'Verified calendar: no high-impact release in the next 4 h',
  healthy_inputs: 'Required data is fresh and healthy',
};
/** Every signal needs these; an A signal also needs both of the others, a B signal one of them. */
const REQUIRED: GradeCheckId[] = ['fresh_news', 'macro_match', 'agreement', 'no_event_risk', 'healthy_inputs'];
const CONFIRMING: GradeCheckId[] = ['two_sources', 'market_confirms'];

const isHeadline = (event: ScoredEvent) => !event.evidenceType || event.evidenceType === 'headline';

/** True when `timestamp` is at most `hours` old at `asOf`, and never in the future. */
function freshAt(timestamp: string | null | undefined, asOf: string, hours: number): boolean {
  const age = Date.parse(asOf) - Date.parse(timestamp ?? '');
  return Number.isFinite(age) && age >= 0 && age <= hours * 3_600_000;
}

/** A buy/sell signal only where fresh news and the macro backdrop point the same way. */
export function gradeSignal(result: BiasResult, ctx: { asOf: string; calendar: CalendarEvent[]; inputsHealthy: boolean;
  calendarVerified?: boolean; inputIssue?: string; calendarIssue?: string }): SignalGradeResult {
  const sign = Math.sign(result.biasScore);
  const supports = (score: number) => score * sign > 0;
  const supportingNews = result.events.filter(event => isHeadline(event) && supports(event.scoreChange));
  const macro = result.forecast?.components?.macro;
  const coverage = assessMacroCoverage(result.symbol, result.events, ctx.asOf, result.biasScore);
  const countryNames = (countries: string[]) => countries.map(country => COUNTRY_NAMES[country] ?? country).join(', ');
  const total = result.events.reduce((sum, event) => sum + Math.abs(event.scoreChange), 0);
  const agreeing = result.events.filter(event => supports(event.scoreChange)).reduce((sum, event) => sum + Math.abs(event.scoreChange), 0);
  const start = Date.parse(ctx.asOf), end = start + EVENT_WINDOW_HOURS * 3_600_000;
  const passed: Record<GradeCheckId, boolean> = {
    fresh_news: freshAt(result.forecast?.latestNewsAt, ctx.asOf, FRESH_NEWS_HOURS)
      && supportingNews.some(event => freshAt(event.timestamp, ctx.asOf, FRESH_NEWS_HOURS)),
    macro_match: !!macro && supports(macro.score) && Math.abs(macro.score) >= MIN_MACRO_SCORE
      && result.alignment?.context.complete === true && coverage.missingCountries.length === 0
      && coverage.supportingCountries.length === coverage.requiredCountries.length,
    two_sources: new Set(supportingNews.map(event => event.sourceName).filter(Boolean)).size >= 2,
    agreement: total > 0 && agreeing / total >= MIN_AGREEMENT,
    market_confirms: result.alignment?.marketConfirmation === 'confirming' && supports(result.forecast?.macroBiasScore ?? 0)
      && ['dollar_strength', 'yields'].every(category => result.events.some(event => event.category === category
        && event.evidenceType === 'market' && event.country === 'US' && supports(event.scoreChange)
        && freshAt(event.timestamp, ctx.asOf, 4))),
    no_event_risk: ctx.calendarVerified === true && !ctx.calendar.some(event => event.impact === 'high' && event.affects.includes(result.symbol)
      && Date.parse(event.time) >= start && Date.parse(event.time) <= end),
    healthy_inputs: ctx.inputsHealthy,
  };
  const details: Partial<Record<GradeCheckId, string | undefined>> = {
    macro_match: coverage.missingCountries.length
      ? `Structured macro data is missing for: ${countryNames(coverage.missingCountries)}.`
      : coverage.supportingCountries.length !== coverage.requiredCountries.length
        ? 'Structured evidence from each relevant economy must support this direction.'
        : result.alignment?.context.complete !== true ? 'The economic context is incomplete.' : undefined,
    no_event_risk: !ctx.calendarVerified ? ctx.calendarIssue ?? 'The calendar could not be verified.' : undefined,
    healthy_inputs: ctx.inputIssue,
  };
  const checks = (Object.keys(LABELS) as GradeCheckId[]).map(id => ({ id, passed: passed[id], label: LABELS[id],
    ...(details[id] ? { detail: details[id] } : {}) }));
  const directional = result.direction !== 'neutral' && sign !== 0 && Math.abs(result.biasScore) >= MIN_SIGNAL_SCORE;
  const missing = CONFIRMING.filter(id => !passed[id]).length;
  const grade = !directional || !REQUIRED.every(id => passed[id]) ? 'none' : missing === 0 ? 'A' : missing === 1 ? 'B' : 'none';
  return { grade, side: grade === 'none' ? null : sign > 0 ? 'long' : 'short', checks };
}

/** "A signal · Long", "B signal · Short" or "Lean only": the words on cards and market pages. */
export function gradeBadge(graded: SignalGradeResult | undefined): string {
  if (!graded || graded.grade === 'none' || !graded.side) return 'Lean only';
  return `${graded.grade} signal · ${graded.side === 'long' ? 'Long' : 'Short'}`;
}

/** The buy/sell call shown to traders: A is strong, B is plain, anything else is no call. */
export function signalFromGrade(graded: SignalGradeResult): TradeSignal {
  if (graded.grade === 'none' || !graded.side) return 'neutral';
  if (graded.grade === 'A') return graded.side === 'long' ? 'strong_buy' : 'strong_sell';
  return graded.side === 'long' ? 'buy' : 'sell';
}
