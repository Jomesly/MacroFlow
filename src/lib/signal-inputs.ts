import type { CalendarEvent, DataSource, MacroContext, SourceHealth } from './types';

interface CalendarEvidence {
  fetchedAt: string;
  archiveStatus: 'ok' | 'failed';
  events: CalendarEvent[];
}

interface SignalInputs {
  asOf: string;
  cachedAt: string;
  source: DataSource;
  stale?: boolean;
  sourceHealth: SourceHealth;
  context: MacroContext;
  calendarEvidence?: CalendarEvidence;
}

/** Unknown calendar coverage is never evidence that the forecast window is safe. */
export function assessSignalInputs(inputs: SignalInputs) {
  const now = Date.parse(inputs.asOf);
  const age = (timestamp: string) => now - Date.parse(timestamp);
  const fresh = (timestamp: string, maxAge: number) => {
    const elapsed = age(timestamp);
    return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= maxAge;
  };
  const calendar = inputs.calendarEvidence;
  let calendarIssue: string | undefined;
  if (!calendar) calendarIssue = 'The economic calendar is unavailable.';
  else if (calendar.archiveStatus !== 'ok') calendarIssue = 'The economic calendar archive is unavailable.';
  else if (!fresh(calendar.fetchedAt, 60 * 60_000)) calendarIssue = 'The economic calendar is outdated or has an invalid fetch time.';
  else if (!calendar.events.length || calendar.events.some(event => !Number.isFinite(Date.parse(event.time)))) {
    calendarIssue = 'The economic calendar has no usable schedule.';
  } else if (!calendar.events.some(event => Date.parse(event.time) >= now + 4 * 60 * 60_000)) {
    calendarIssue = 'The economic calendar does not cover the full four-hour forecast window.';
  }
  const calendarVerified = !calendarIssue;
  let inputIssue: string | undefined;
  if (inputs.source !== 'live' || inputs.stale || !fresh(inputs.cachedAt, 5 * 60_000)) {
    inputIssue = 'Live inputs are outdated or unavailable.';
  } else if (!inputs.context.complete || !fresh(inputs.context.asOf, 2 * 86_400_000 - 1)) {
    inputIssue = 'The structured US macro context is incomplete or outdated.';
  } else if (Object.values(inputs.sourceHealth).some(status => status === 'failed')) {
    inputIssue = 'A configured data provider failed; new signals are paused.';
  } else if (['finnhub', 'rss', 'market_data', 'fred', 'calendar_archive', 'economic_calendar']
    .some(name => !['ok', 'empty'].includes(inputs.sourceHealth[name]))) {
    inputIssue = 'Required provider health could not be verified.';
  } else if (inputs.sourceHealth.fred !== 'ok' || inputs.sourceHealth.market_data !== 'ok'
    || inputs.sourceHealth.calendar_archive !== 'ok'
    || !['finnhub', 'rss'].some(name => inputs.sourceHealth[name] === 'ok')) {
    inputIssue = 'Required macro, market or news data is unavailable.';
  } else if (!calendarVerified) inputIssue = calendarIssue;
  return { inputsHealthy: !inputIssue, calendarVerified, inputIssue, calendarIssue };
}
