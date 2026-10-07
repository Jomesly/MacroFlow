'use client';

import { Trade } from '@/lib/types';

const RESULT_BADGES: Record<string, { label: string; classes: string }> = {
  win: { label: 'WIN', classes: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40' },
  loss: { label: 'LOSS', classes: 'bg-red-900/40 text-red-400 border-red-700/40' },
  breakeven: { label: 'BE', classes: 'bg-zinc-800 text-zinc-400 border-zinc-700/40' },
  open: { label: 'OPEN', classes: 'bg-amber-900/40 text-amber-400 border-amber-700/40' },
};

function resultBadge(trade: Trade) {
  if (trade.result) return RESULT_BADGES[trade.result];
  return RESULT_BADGES.open;
}

function formatPnl(trade: Trade): { text: string; color: string } {
  if (trade.pnlPercent === null) return { text: '—', color: 'text-zinc-600' };
  const sign = trade.pnlPercent > 0 ? '+' : '';
  return {
    text: `${sign}${trade.pnlPercent.toFixed(2)}%`,
    color: trade.pnlPercent > 0 ? 'text-emerald-400' : trade.pnlPercent < 0 ? 'text-red-400' : 'text-zinc-500',
  };
}

interface JournalPeekProps {
  trades: Trade[];
  loading: boolean;
  error: boolean;
  visible: boolean;
}

export default function JournalPeek({ trades, loading, error, visible }: JournalPeekProps) {
  const recent = trades.slice(0, 3);

  return (
    <div
      aria-hidden={!visible}
      className={`absolute right-full top-1/2 -translate-y-1/2 w-64 transition-all duration-150 ${
        visible
          ? 'opacity-100 translate-x-0'
          : 'opacity-0 translate-x-2 pointer-events-none'
      }`}
    >
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl p-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-2">
          Recent Trades
        </p>

        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between animate-pulse">
                <div className="h-3 w-14 bg-zinc-800 rounded" />
                <div className="h-3 w-16 bg-zinc-800 rounded" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="text-xs text-red-400/80">Couldn&apos;t load trades</p>
        ) : recent.length === 0 ? (
          <p className="text-xs text-zinc-500">No trades yet</p>
        ) : (
          <div className="space-y-1.5">
            {recent.map((trade) => {
              const badge = resultBadge(trade);
              const pnl = formatPnl(trade);
              return (
                <div key={trade.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-semibold text-white">{trade.symbol}</span>
                    <span
                      className={`text-[9px] font-medium ${
                        trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {trade.direction === 'long' ? '▲ LONG' : '▼ SHORT'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[9px] font-medium px-1 py-0.5 rounded border leading-none ${badge.classes}`}
                      title={trade.result === 'breakeven' ? 'Breakeven' : undefined}
                    >
                      {badge.label}
                    </span>
                    <span className={`text-[10px] font-mono tabular-nums ${pnl.color}`}>
                      {pnl.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
