import { MacroEvent, UpcomingEvent } from '../types';

// FMP economic calendar endpoint is deprecated (legacy endpoint no longer
// available for accounts created after August 2025). Stubbed out pending
// FRED API integration (fred.stlouisfed.org) as permanent replacement.

export async function fetchEconomicCalendar(): Promise<MacroEvent[]> {
  return [];
}

export async function fetchUpcomingEconomicCalendar(): Promise<UpcomingEvent[]> {
  return [];
}
