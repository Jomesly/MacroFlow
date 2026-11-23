import { getEvents } from './events';
import { scoreMarketForecast } from './forecast';
import { selectEventsAsOf } from './macro-context';
import { gradeSignal, signalFromGrade, type SignalGradeResult } from './signal-grade';
import type { AssetSymbol, BiasResult, DataSource, DxyContext, MacroEvent, SourceHealth, UpcomingEvent } from './types';

export type GradedResult = BiasResult & { grade: SignalGradeResult };
export interface BiasSnapshot {
  asOf: string;
  results: GradedResult[];
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
  const inputAge = Date.parse(asOf) - Date.parse(cachedAt);
  const inputsHealthy = source === 'live' && !stale && Number.isFinite(inputAge) && inputAge >= 0 && inputAge <= 5 * 60_000;
  const calendar = calendarEvidence?.events ?? [];
  const results = scoreMarketForecast(events, context, asOf, symbol).map(result => {
    const grade = gradeSignal(result, { asOf, calendar, inputsHealthy });
    return { ...result, grade, signal: signalFromGrade(grade) };
  });
  return { asOf, results, meta: { source, cachedAt, sourceHealth, stale, inputsHealthy, nextEvent, dxy: getDxyContext(selectEventsAsOf(events, asOf)) } };
}
