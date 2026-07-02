'use client';

import { BiasResult } from '@/lib/types';

const DIRECTION_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  bullish: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-950/30',
    border: 'border-emerald-800/30',
  },
  bearish: {
    text: 'text-red-400',
    bg: 'bg-red-950/30',
    border: 'border-red-800/30',
  },
  neutral: {
    text: 'text-zinc-400',
    bg: 'bg-zinc-800/30',
    border: 'border-zinc-700/30',
  },
};

const SIGNAL_COLORS: Record<string, string> = {
  strong_buy: 'bg-emerald-500',
  buy: 'bg-emerald-600',
  neutral: 'bg-zinc-600',
  sell: 'bg-red-600',
  strong_sell: 'bg-red-500',
};

function MiniBar({ score }: { score: number }) {
  const barWidth = Math.min(Math.abs(score), 100);
  const isPositive = score >= 0;

  return (
    <div className="relative h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className={`absolute top-0 h-full rounded-full transition-all duration-500 ${
          isPositive ? 'bg-emerald-500' : 'bg-red-500'
        }`}
        style={{
          width: `${barWidth}%`,
          left: isPositive ? '50%' : `${50 - barWidth}%`,
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-full w-px bg-zinc-600" />
      </div>
    </div>
  );
}

interface MarketCardProps {
  data: BiasResult;
  onClick: () => void;
}

export default function MarketCard({ data, onClick }: MarketCardProps) {
  const colors = DIRECTION_COLORS[data.direction] || DIRECTION_COLORS.neutral;

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border ${colors.border} ${colors.bg} p-4 transition-all text-left w-full cursor-pointer
        hover:scale-[1.03] hover:shadow-[0_0_20px_-5px] hover:shadow-${data.direction === 'bullish' ? 'emerald' : data.direction === 'bearish' ? 'red' : 'white'}-500/20
        hover:border-white/20 active:scale-[0.98] group outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-bold leading-none text-white group-hover:text-white transition-colors">
            {data.symbol}
          </h3>
          <p className="text-xs text-zinc-500 mt-1 leading-none">{data.name}</p>
        </div>
        <div className="text-right">
          <span className={`text-2xl font-bold leading-none ${colors.text} tabular-nums`}>
            {data.biasPercent > 0 ? '+' : ''}
            {data.biasPercent}%
          </span>
          <div className="flex items-center gap-1 justify-end mt-1">
            <div className={`w-1.5 h-1.5 rounded-full ${SIGNAL_COLORS[data.signal]}`} />
            <span className="text-[9px] text-zinc-500 uppercase tracking-wider">{data.signal.replace('_', ' ')}</span>
          </div>
        </div>
      </div>

      <div className="mb-2">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[11px] text-zinc-500">Bias</span>
          <span className={`text-xs font-semibold leading-none ${colors.text}`}>
            {data.dailyLabel}
          </span>
        </div>
        <MiniBar score={data.biasScore} />
      </div>

      {data.conviction !== 'low' && data.eventCount > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            data.conviction === 'high' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-amber-900/40 text-amber-400'
          }`}>
            {data.conviction.toUpperCase()} conviction
          </span>
          <span className="text-[10px] text-zinc-600">{data.eventCount} events</span>
          <span className="text-[10px] text-zinc-600">{data.confirmationRatio}% agree</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2.5 border-t border-zinc-800/50 mt-2.5">
        <span className="text-[10px] text-zinc-600">
          {new Date(data.lastUpdated).toLocaleTimeString()}
        </span>
        <span className="text-[10px] text-blue-400 transition-all duration-200 group-hover:text-blue-300 group-hover:translate-x-0.5">
          Click for details →
        </span>
      </div>
    </button>
  );
}
