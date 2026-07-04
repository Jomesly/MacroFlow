/**
 * !! DO NOT USE FOR REAL BACKTESTS !!
 *
 * DEV-ONLY: Generate SYNTHETIC historical economic calendar events.
 * Uses Math.random() to invent CPI/NFP/GDP values. The output has NO
 * relationship to real economic data. Any backtest report generated from
 * this data is meaningless and must not be cited as findings.
 *
 * This script exists only for local development/testing of the backtest
 * pipeline infrastructure. For real backtests, use:
 *   npx tsx scripts/fetch-historical-calendar.ts
 *
 * Usage: npx tsx scripts/generate-synthetic-calendar.DEV-ONLY.ts [days_back]
 */

import * as fs from 'fs';
import * as path from 'path';

interface CalendarEvent {
  id: string;
  event: string;
  country: string;
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
}

// Known economic release patterns (US-focused, some UK)
// Times are approximate (US Eastern, converted to UTC for consistency)
const EVENT_PATTERNS = [
  // CPI - typically released monthly around the 10th-13th
  { event: 'CPI', country: 'US', dayOfMonth: [10, 11, 12, 13], forecastRange: [2.5, 3.5], volatility: 0.3 },
  { event: 'Core CPI', country: 'US', dayOfMonth: [10, 11, 12, 13], forecastRange: [2.0, 3.0], volatility: 0.2 },
  // Nonfarm Payrolls - first Friday of month
  { event: 'Nonfarm Payrolls', country: 'US', dayOfWeek: 5, weekOfMonth: [1, 2], forecastRange: [150, 250], volatility: 50 },
  { event: 'Unemployment Rate', country: 'US', dayOfWeek: 5, weekOfMonth: [1, 2], forecastRange: [3.5, 4.5], volatility: 0.2 },
  // GDP - quarterly
  { event: 'GDP', country: 'US', dayOfMonth: [25, 26, 27, 28, 29, 30], forecastRange: [1.5, 3.0], volatility: 0.5 },
  // PMI
  { event: 'ISM Manufacturing PMI', country: 'US', dayOfMonth: [1, 2, 3], forecastRange: [48, 55], volatility: 2 },
  { event: 'ISM Services PMI', country: 'US', dayOfMonth: [3, 4, 5], forecastRange: [50, 58], volatility: 2 },
  // Retail Sales
  { event: 'Retail Sales', country: 'US', dayOfMonth: [14, 15, 16, 17], forecastRange: [0.0, 1.0], volatility: 0.3 },
  // UK events
  { event: 'CPI', country: 'GB', dayOfMonth: [18, 19, 20, 21], forecastRange: [2.0, 4.0], volatility: 0.3 },
  { event: 'BoE Interest Rate Decision', country: 'GB', dayOfMonth: [5, 6, 7, 8], forecastRange: [4.0, 5.5], volatility: 0.25 },
  // Fed events (roughly every 6 weeks)
  { event: 'Fed Interest Rate Decision', country: 'US', dayOfMonth: [28, 29, 30, 31, 1], forecastRange: [4.0, 5.5], volatility: 0.25 },
];

function getWeekOfMonth(date: Date): number {
  const day = date.getDate();
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  if (day <= 28) return 4;
  return 5;
}

function generateEventValue(
  forecastRange: number[],
  volatility: number
): { actual: number; forecast: number } {
  const forecast = forecastRange[0] + Math.random() * (forecastRange[1] - forecastRange[0]);
  // Actual beats or misses forecast randomly
  const beat = Math.random() > 0.45; // slight bias toward beats
  const move = (Math.random() * volatility * 2) - volatility;
  const actual = beat ? forecast + Math.abs(move) : forecast - Math.abs(move);
  return {
    actual: Math.round(actual * 100) / 100,
    forecast: Math.round(forecast * 100) / 100,
  };
}

function generateCalendar(daysBack: number): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

  for (const pattern of EVENT_PATTERNS) {
    let current = new Date(startDate);

    while (current <= endDate) {
      const dayOfMonth = current.getDate();
      const dayOfWeek = current.getDay();
      const weekOfMonth = getWeekOfMonth(current);

      let shouldGenerate = false;

      if (pattern.dayOfMonth && pattern.dayOfMonth.includes(dayOfMonth)) {
        shouldGenerate = true;
      }
      if (pattern.dayOfWeek && pattern.dayOfWeek === dayOfWeek && pattern.weekOfMonth?.includes(weekOfMonth)) {
        shouldGenerate = true;
      }

      if (shouldGenerate) {
        const { actual, forecast } = generateEventValue(
          pattern.forecastRange,
          pattern.volatility
        );

        events.push({
          id: `synth-${pattern.event.replace(/\s+/g, '-').toLowerCase()}-${current.toISOString().slice(0, 10)}`,
          event: pattern.event,
          country: pattern.country,
          date: current.toISOString(),
          actual,
          forecast,
          previous: null,
        });
      }

      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  // Sort by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return events;
}

function main() {
  const daysBack = parseInt(process.argv[2] || '30', 10);
  console.log(`Generating synthetic calendar for ${daysBack} days...`);

  const events = generateCalendar(daysBack);
  console.log(`Generated ${events.length} events`);

  const outDir = path.join(process.cwd(), 'data', 'historical-calendar');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'events.json');
  fs.writeFileSync(outFile, JSON.stringify(events, null, 2));
  console.log(`Saved to ${outFile}`);
}

main();
