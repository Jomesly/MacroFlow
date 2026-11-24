import { getEvents } from './events';
import { scoreMarketForecast } from './forecast';
import { selectEventsAsOf } from './macro-context';
import { convictionFromGrade, gradeSignal, signalFromGrade, type SignalGradeResult } from './signal-grade';
import { assessSignalInputs } from './signal-inputs';
import type { AssetSymbol, BiasResult, DataSource, DxyContext, MacroEvent, SourceHealth, UpcomingEvent } from './types';

export type GradedResult = BiasResult & { grade: SignalGradeResult };
export interface BiasSnapshot {
  asOf: string;
  results: GradedResult[];
  // For an all-market snapshot inputsHealthy covers shared providers. Each result's
  // healthy_inputs check additionally enforces its domestic dependency.
  meta: { source: DataSource; cachedAt: string; sourceHealth: SourceHealth; stale?: boolean; inputsHealthy: boolean; nextEvent: UpcomingEvent | null; dxy?: DxyContext };
}

function getDxyContext(events: MacroEvent[]): DxyContext | undefined {
  const dxyEvent = events.find((e) => e.seriesId === 'DXY' && e.value !== 'neutral');
  if (!dxyEvent) return;
  const descMatch = dxyEvent.description.match(/Current:\s*([\d.]+)/);
  const changeMatch = dxyEvent.description.match(/\(([\d.-]+)%\)/);
  const price = descMatch?.[1] ?? '';
  const percentChange = changeMatch ? parseFloat(changeMatch[1]) : 0;
  const status = percentChange >= 0 ? 'strengthening' : 'weakening';
  const summary = status === 'strengthening'
    ? 'Bearish pressure on Gold (XAUUSD) and GBP/USD today'
    : 'Bullish tailwind for Gold (XAUUSD) and GBP/USD today';
  return { price, percentChange, status, summary };
}

/**
 * One scoring path for the dashboard and the hourly signal recorder, so a recorded
 * signal is exactly what a trader saw. Buy/sell calls come only from the grade.
 */
export async function buildBiasSnapshot(symbol?: AssetSymbol): Promise<BiasSnapshot> {
  const { events, source, cachedAt, sourceHealth, stale, context, nextEvent, calendarEvidence } = await getEvents();
  const asOf = new Date().toISOString();
  const inputs = { asOf, cachedAt, source, stale, sourceHealth, context, calendarEvidence };
  const quality = assessSignalInputs({ ...inputs, symbol });
  const { inputsHealthy } = quality;
  const calendar = calendarEvidence?.events ?? [];
  const results = scoreMarketForecast(events, context, asOf, symbol).map(result => {
    const marketQuality = assessSignalInputs({ ...inputs, symbol: result.symbol });
    const grade = gradeSignal(result, { asOf, calendar, ...marketQuality });
    // Conviction is the grade on one Low / Medium / High scale, so cards never show two scales.
    return { ...result, grade, signal: signalFromGrade(grade), conviction: convictionFromGrade(grade) };
  });
  return { asOf, results, meta: { source, cachedAt, sourceHealth, stale, inputsHealthy, nextEvent, dxy: getDxyContext(selectEventsAsOf(events, asOf)) } };
}
