'use client';

import { useEffect, useState } from 'react';
import { BiasResult } from '@/lib/types';

const DIRECTION_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  bullish: { text: 'text-emerald-400', bg: 'bg-emerald-950/30', border: 'border-emerald-800/30' },
  bearish: { text: 'text-red-400', bg: 'bg-red-950/30', border: 'border-red-800/30' },
  neutral: { text: 'text-zinc-400', bg: 'bg-zinc-800/30', border: 'border-zinc-700/30' },
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
      <div className={`absolute top-0 h-full rounded-full transition-all duration-500 ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
        style={{ width: `${barWidth}%`, left: isPositive ? '50%' : `${50 - barWidth}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-full w-px bg-zinc-600" />
      </div>
    </div>
  );
}

function getConfidenceColor(ratio: number): string {
  if (ratio >= 0.6) return 'text-emerald-400';
  if (ratio >= 0.3) return 'text-amber-400';
  return 'text-red-400';
}

function getConfidenceLevel(ratio: number): string {
  if (ratio >= 0.6) return 'High';
  if (ratio >= 0.3) return 'Medium';
  return 'Low';
}

interface MarketCardProps {
  data: BiasResult;
  onClick: () => void;
}

export default function MarketCard({ data, onClick }: MarketCardProps) {
  const colors = DIRECTION_COLORS[data.direction] || DIRECTION_COLORS.neutral;
  const [flipInfo, setFlipInfo] = useState<{ from: string; to: string; trigger: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const ratio = data.totalPossibleSignals > 0 ? data.confidenceCount / data.totalPossibleSignals : 0;
  const confidenceColor = getConfidenceColor(ratio);
  const confidenceLevel = getConfidenceLevel(ratio);

  useEffect(() => {
    const key = `mf-direction-${data.symbol}`;
    const prev = sessionStorage.getItem(key);
    const cur = data.direction;

    if (prev && prev !== cur) {
      const sorted = [...data.events].sort((a, b) => Math.abs(b.scoreChange) - Math.abs(a.scoreChange));
      const trigger = sorted.length > 0 ? sorted[0].title : '';
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFlipInfo({ from: prev, to: cur, trigger });
    }

    sessionStorage.setItem(key, cur);
  }, [data.symbol, data.direction, data.events]);

  const dismissFlip = () => setFlipInfo(null);

  return (
    <div className="relative h-full">
      <div
        className={`rounded-xl border ${colors.border} ${colors.bg} flex flex-col h-full`}
      >
        <button
          onClick={onClick}
          className={`w-full p-4 flex-1 transition-all text-left cursor-pointer
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
              {data.biasPercent > 0 ? '+' : ''}{data.biasPercent}%
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

        <div className="mb-2 flex items-center gap-2">
          <span className={`text-[10px] font-semibold ${confidenceColor}`}>
            Confidence: {confidenceLevel}
          </span>
          <span className="text-[10px] text-zinc-600">
            {data.confidenceCount} of {data.totalPossibleSignals} signals
          </span>
        </div>

        <div className="mb-2 min-h-[20px]">
          {data.conviction !== 'low' && data.eventCount > 0 && (
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                data.conviction === 'high' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-amber-900/40 text-amber-400'
              }`}>
                {data.conviction.toUpperCase()} conviction
              </span>
              <span className="text-[10px] text-zinc-600">{data.eventCount} events</span>
              <span className="text-[10px] text-zinc-600">{data.confirmationRatio}% agree</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2.5 border-t border-zinc-800/50 mt-2.5">
          <span className="text-[10px] text-zinc-600">
            {new Date(data.lastUpdated).toLocaleTimeString()}
          </span>
          <span className="text-[10px] text-blue-400 transition-all duration-200 group-hover:text-blue-300 group-hover:translate-x-0.5">
            Click for details →
          </span>
        </div>
      </button>

      {flipInfo && (
        <div className={`border-t ${flipInfo.to === 'bullish' ? 'border-emerald-800/30 bg-emerald-950/50' : 'border-red-800/30 bg-red-950/50'} px-4 py-2.5`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M13 2L4 14h6v8l7-12h-6z" />
                </svg>
                <span className={`text-[9px] font-bold uppercase tracking-wider ${
                  flipInfo.to === 'bullish' ? 'text-emerald-300' : 'text-red-300'
                }`}>
                  Bias Flipped
                </span>
                <span className="text-[9px] text-zinc-500">
                  {flipInfo.from.charAt(0).toUpperCase() + flipInfo.from.slice(1)} → {flipInfo.to.charAt(0).toUpperCase() + flipInfo.to.slice(1)}
                </span>
              </div>
              <p className="text-[9px] text-zinc-600 leading-tight truncate">
                {flipInfo.trigger.slice(0, 70)}
              </p>
            </div>
            <button onClick={dismissFlip} className="text-zinc-600 hover:text-zinc-300 shrink-0 text-xs leading-none mt-0.5">✕</button>
          </div>
        </div>
      )}

      {data.history.length > 0 && (
        <div className="border-t border-zinc-800/50">
          <button
            onClick={(e) => { e.stopPropagation(); setHistoryOpen(!historyOpen); }}
            className="w-full flex items-center justify-between px-4 py-2 text-left cursor-pointer hover:bg-zinc-800/30 transition-colors"
          >
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">7-Day History</span>
            <svg className={`w-3 h-3 text-zinc-500 transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {historyOpen && (
            <div className="px-4 pb-3">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-zinc-600 border-b border-zinc-800/50">
                    <th className="text-left py-1 font-medium">Date</th>
                    <th className="text-left py-1 font-medium">Direction</th>
                    <th className="text-right py-1 font-medium">Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((entry) => (
                    <tr key={entry.date} className="border-b border-zinc-800/30 last:border-0">
                      <td className="py-1 text-zinc-400">{entry.date.slice(5)}</td>
                      <td className={`py-1 font-medium ${
                        entry.direction === 'bullish' ? 'text-emerald-400' : entry.direction === 'bearish' ? 'text-red-400' : 'text-zinc-500'
                      }`}>
                        {entry.direction.charAt(0).toUpperCase() + entry.direction.slice(1)}
                      </td>
                      <td className={`py-1 text-right font-mono tabular-nums ${
                        entry.biasScore > 0 ? 'text-emerald-400' : entry.biasScore < 0 ? 'text-red-400' : 'text-zinc-500'
                      }`}>
                        {entry.biasScore > 0 ? '+' : ''}{entry.biasScore}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
