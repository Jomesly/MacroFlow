import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildBiasSnapshot } from '@/lib/bias-snapshot';
import { FORECAST_VERSION } from '@/lib/forecast';
import { fetchYahooHourly } from '@/lib/api/intraday';
import { MARKET_REFERENCES } from '@/lib/asset-momentum';
import { selectNewSignals, SIGNAL_SPACING_MS } from '@/lib/signals/record';
import { resolveSignal } from '@/lib/signals/resolve';
import { fromDbRow, toDbRow, type SignalDbRow } from '@/lib/signals/types';
import type { AssetSymbol } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Called hourly by Supabase pg_cron (supabase/signal-schedule.sql) with its own secret, not a login. */
function authorized(request: NextRequest): boolean {
  const secret = process.env.SIGNALS_CRON_SECRET ?? '';
  const match = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '');
  if (secret.length < 32 || !match) return false;
  const given = Buffer.from(match[1]), expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const failure = (step: string, error: { message: string }) => {
  console.error('[signals] run failed', step, error.message);
  return NextResponse.json({ error: `Could not ${step}.` }, { status: 500 });
};

/**
 * Record each new A/B signal, then score signals whose four hours have passed.
 * Recording needs healthy inputs; resolving always runs, so an outage never strands old signals.
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = await import('@/lib/supabase');
  const { asOf, results, meta } = await buildBiasSnapshot();
  const windowStart = new Date(Date.parse(asOf) - SIGNAL_SPACING_MS).toISOString();

  let recorded = 0;
  if (meta.inputsHealthy) {
    const recent = await supabase.from('signal_outcomes').select('symbol, issued_at').gt('issued_at', windowStart);
    if (recent.error) return failure('read recent signals', recent.error);
    const rows = selectNewSignals(results, (recent.data ?? []).map(row => ({ symbol: row.symbol as AssetSymbol, issuedAt: row.issued_at as string })), asOf, FORECAST_VERSION);
    if (rows.length) {
      const insert = await supabase.from('signal_outcomes').upsert(rows.map(toDbRow), { onConflict: 'id', ignoreDuplicates: true });
      if (insert.error) return failure('record signals', insert.error);
    }
    recorded = rows.length;
  }

  const open = await supabase.from('signal_outcomes').select('*').eq('outcome', 'open').lt('issued_at', windowStart);
  if (open.error) return failure('read open signals', open.error);
  const bySymbol = new Map<AssetSymbol, SignalDbRow[]>();
  for (const row of (open.data ?? []) as SignalDbRow[]) bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) ?? []), row]);

  let resolved = 0, voided = 0;
  for (const [symbol, rows] of bySymbol) {
    const reference = MARKET_REFERENCES[symbol];
    // A price outage leaves the signal open for the next run rather than guessing.
    const bars = reference ? await fetchYahooHourly(symbol, reference.ticker, '5d').then(dataset => dataset.bars, () => null) : null;
    if (!bars) continue;
    for (const row of rows) {
      const result = resolveSignal(fromDbRow(row), bars, asOf);
      if (result.outcome === 'open') continue;
      const update = await supabase.from('signal_outcomes').update({ outcome: result.outcome, entry_at: result.entryAt, exit_at: result.exitAt,
        entry_price: result.entryPrice, exit_price: result.exitPrice, return_bps: result.returnBps }).eq('id', row.id).eq('outcome', 'open');
      if (update.error) return failure('save an outcome', update.error);
      if (result.outcome === 'void') voided++; else resolved++;
    }
  }
  return NextResponse.json({ recorded, resolved, voided, asOf });
}
