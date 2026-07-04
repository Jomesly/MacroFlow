/**
 * Point-in-time replay harness for backtesting.
 *
 * At each simulated time T, only events with timestamp <= T are visible
 * to the scoring engine. This prevents look-ahead bias.
 *
 * Outputs: data/backtest-snapshots/{symbol}.json
 *
 * Usage: npx tsx scripts/backtest-replay.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { calculateBias } from '../src/lib/engine';
import { MacroEvent, AssetSymbol } from '../src/lib/types';

interface CalendarEvent {
  id: string;
  event: string;
  country: string;
  date: string;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
}

interface ScoredSnapshot {
  timestamp: string;
  symbol: AssetSymbol;
  score: number;
  biasPercent: number;
  direction: string;
  strength: string;
  conviction: string;
  signal: string;
  eventCount: number;
  confirmationRatio: number;
  categoryBreakdown: Record<string, number>;
}

// Category mapping from event names to engine categories
const EVENT_CATEGORY_MAP: Record<string, string> = {
  'CPI': 'inflation',
  'Core CPI': 'inflation',
  'Nonfarm Payrolls': 'employment',
  'Unemployment Rate': 'employment',
  'GDP': 'gdp',
  'ISM Manufacturing PMI': 'pmi',
  'ISM Services PMI': 'pmi',
  'Retail Sales': 'retail_sales',
  'Fed Interest Rate Decision': 'fed_tone',
  'BoE Interest Rate Decision': 'boe_tone',
};

// Value classification — uses actual vs previous when forecast is null (FRED data)
// This matches fred.ts live logic: compare each release to previous release
function classifyValue(
  event: string,
  actual: number,
  forecast: number | null,
  previous: number | null
): string {
  // If forecast exists, use actual vs forecast (beats/misses)
  // If no forecast (FRED), use actual vs previous (month-over-month change)
  const reference = forecast ?? previous;
  if (reference === null) return 'neutral';

  const diff = actual - reference;
  const name = event.toLowerCase();

  if (name.includes('cpi') || name.includes('inflation')) {
    return diff > 0 ? 'high' : diff < 0 ? 'low' : 'neutral';
  }
  if (name.includes('unemployment') || name.includes('jobless')) {
    // Higher unemployment = weak labor market
    return diff > 0 ? 'weak' : diff < 0 ? 'strong' : 'neutral';
  }
  if (name.includes('nonfarm') || name.includes('payroll')) {
    return diff > 0 ? 'strong' : diff < 0 ? 'weak' : 'neutral';
  }
  if (name.includes('gdp')) {
    return diff > 0 ? 'beat' : diff < 0 ? 'miss' : 'neutral';
  }
  if (name.includes('pmi') || name.includes('manufacturing') || name.includes('services')) {
    return diff > 0 ? 'beat' : diff < 0 ? 'miss' : 'neutral';
  }
  if (name.includes('retail sales') || name.includes('retail')) {
    return diff > 0 ? 'beat' : diff < 0 ? 'miss' : 'neutral';
  }
  if (name.includes('fed') || name.includes('interest rate')) {
    return diff > 0 ? 'hawkish' : diff < 0 ? 'dovish' : 'neutral';
  }
  if (name.includes('boe') || name.includes('bank of england')) {
    return diff > 0 ? 'hawkish' : diff < 0 ? 'dovish' : 'neutral';
  }

  return 'neutral';
}

function convertToMacroEvent(calEvent: CalendarEvent): MacroEvent {
  const category = EVENT_CATEGORY_MAP[calEvent.event] || 'other';
  const value = calEvent.actual !== null
    ? classifyValue(calEvent.event, calEvent.actual, calEvent.forecast, calEvent.previous)
    : 'neutral';

  const impact = /cpi|inflation|nonfarm|payroll|nfp|employment|unemployment|gdp|interest rate|fed|boe|bank of england/i.test(calEvent.event)
    ? 'high'
    : 'medium';

  return {
    id: calEvent.id,
    category: category as MacroEvent['category'],
    title: `${calEvent.country} ${calEvent.event} — Actual: ${calEvent.actual} (Forecast: ${calEvent.forecast})`,
    description: `${calEvent.event} for ${calEvent.country}: actual=${calEvent.actual}, forecast=${calEvent.forecast}`,
    timestamp: calEvent.date,
    impact,
    value,
    country: calEvent.country,
    sourceName: 'backtest-calendar',
  };
}

function loadHistoricalData(): { events: CalendarEvent[]; prices: Record<string, unknown[]> } {
  // Load calendar events
  const calendarPath = path.join(process.cwd(), 'data', 'historical-calendar', 'events.json');
  const events: CalendarEvent[] = JSON.parse(fs.readFileSync(calendarPath, 'utf8'));

  // Load price data for each symbol
  const pricesDir = path.join(process.cwd(), 'data', 'historical-prices');
  const symbols = ['XAUUSD', 'GBPUSD', 'US100', 'DJ30', 'BTCUSD'];
  const prices: Record<string, unknown[]> = {};

  for (const symbol of symbols) {
    const pricePath = path.join(pricesDir, `${symbol}.json`);
    if (fs.existsSync(pricePath)) {
      prices[symbol] = JSON.parse(fs.readFileSync(pricePath, 'utf8'));
    }
  }

  return { events, prices };
}

function runReplay(): void {
  console.log('Loading historical data...');
  const { events, prices } = loadHistoricalData();

  console.log(`Calendar events: ${events.length}`);
  console.log(`Symbols with prices: ${Object.keys(prices).join(', ')}`);

  // Convert calendar events to MacroEvent format
  const macroEvents: MacroEvent[] = events
    .filter(e => e.actual !== null)
    .map(convertToMacroEvent);

  // Sort by timestamp
  macroEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  console.log(`Converted MacroEvents: ${macroEvents.length}`);

  // Generate snapshots at each event timestamp
  const snapshots: Record<string, ScoredSnapshot[]> = {
    XAUUSD: [], GBPUSD: [], US100: [], DJ30: [], BTCUSD: [],
  };

  for (const event of macroEvents) {
    const eventTime = new Date(event.timestamp);

    // Only use events that occurred up to this point (no look-ahead)
    const knownEvents = macroEvents.filter(
      e => new Date(e.timestamp).getTime() <= eventTime.getTime()
    );

    // Calculate bias for each symbol
    const results = calculateBias(knownEvents);

    for (const result of results) {
      // Build category breakdown
      const categoryBreakdown: Record<string, number> = {};
      for (const scored of result.events) {
        categoryBreakdown[scored.category] = (categoryBreakdown[scored.category] || 0) + scored.scoreChange;
      }

      snapshots[result.symbol].push({
        timestamp: event.timestamp,
        symbol: result.symbol,
        score: result.biasScore,
        biasPercent: result.biasPercent,
        direction: result.direction,
        strength: result.strength,
        conviction: result.conviction,
        signal: result.signal,
        eventCount: result.eventCount,
        confirmationRatio: result.confirmationRatio,
        categoryBreakdown,
      });
    }
  }

  // Save snapshots
  const outDir = path.join(process.cwd(), 'data', 'backtest-snapshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const [symbol, symbolSnapshots] of Object.entries(snapshots)) {
    const outFile = path.join(outDir, `${symbol}.json`);
    fs.writeFileSync(outFile, JSON.stringify(symbolSnapshots, null, 2));
    console.log(`${symbol}: ${symbolSnapshots.length} snapshots saved`);
  }

  console.log('\nReplay complete.');
}

runReplay();
