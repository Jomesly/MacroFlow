'use client';

import { useState } from 'react';
import { BiasResult, TradeSignal } from '@/lib/types';

const DIRECTION_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  bullish: { text: 'text-emerald-400', bg: 'bg-emerald-950/20', border: 'border-emerald-800/30' },
  weakly_bullish: { text: 'text-emerald-300', bg: 'bg-emerald-950/15', border: 'border-emerald-800/25' },
  neutral: { text: 'text-zinc-400', bg: 'bg-zinc-800/20', border: 'border-zinc-700/30' },
  weakly_bearish: { text: 'text-red-300', bg: 'bg-red-950/15', border: 'border-red-800/25' },
  bearish: { text: 'text-red-400', bg: 'bg-red-950/20', border: 'border-red-800/30' },
};

const SIGNAL_CONFIG: Record<TradeSignal, { label: string; color: string; bg: string }> = {
  strong_buy: { label: 'Strong Buy', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  buy: { label: 'Buy', color: 'text-emerald-300', bg: 'bg-emerald-400/10 border-emerald-400/30' },
  neutral: { label: 'Neutral / No Signal', color: 'text-zinc-400', bg: 'bg-zinc-800/10 border-zinc-700/30' },
  sell: { label: 'Sell', color: 'text-red-300', bg: 'bg-red-400/10 border-red-400/30' },
  strong_sell: { label: 'Strong Sell', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
};

function ScoreBar({ score }: { score: number }) {
  const barWidth = Math.min(Math.abs(score), 100) / 2;
  const isPositive = score >= 0;

  return (
    <div className="relative h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className={`absolute top-0 h-full rounded-full transition-all duration-500 ${isPositive ? 'bg-emerald-500' : 'bg-red-500'}`}
        style={{ width: `${barWidth}%`, left: isPositive ? '50%' : `${50 - barWidth}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-full w-px bg-zinc-500" />
      </div>
    </div>
  );
}

interface BiasDetailProps {
  data: BiasResult;
  onClose: () => void;
}

export default function BiasDetail({ data, onClose }: BiasDetailProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const colors = DIRECTION_COLORS[data.direction] || DIRECTION_COLORS.neutral;
  const signal = SIGNAL_CONFIG[data.signal];
  const isBullish = data.direction === 'bullish' || data.direction === 'weakly_bullish';
  const isBearish = data.direction === 'bearish' || data.direction === 'weakly_bearish';

  const highImpactCount = data.events.filter((e) => e.impact === 'high').length;
  const bullishCount = data.events.filter((e) => e.scoreChange > 0).length;
  const bearishCount = data.events.filter((e) => e.scoreChange < 0).length;
  const supportingHighImpactCount = data.events.filter((e) => e.impact === 'high' && e.scoreChange * data.biasScore > 0).length;

  const tradingReadiness =
    data.conviction === 'high' && Math.abs(data.biasScore) > 40
      ? { label: 'Strong macro alignment', color: 'text-emerald-400' }
      : data.conviction === 'medium' && Math.abs(data.biasScore) > 25
        ? { label: 'Moderate macro alignment — manage risk', color: 'text-amber-400' }
        : { label: 'Low conviction — wait for clearer signal', color: 'text-zinc-500' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-8 px-4 pb-4 overflow-y-auto" onClick={onClose}>
      <div
        className="relative w-full max-w-5xl rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none">✕</button>

        <div className="flex items-start justify-between mb-5 pr-6">
          <div>
            <h2 className="text-xl font-bold text-white">{data.symbol}</h2>
            <p className="text-sm text-zinc-500 mt-0.5">{data.name}</p>
          </div>
          <div className="text-right">
            <span className={`text-3xl font-bold leading-none tabular-nums ${colors.text}`}>
              {data.biasPercent > 0 ? '+' : ''}{data.biasPercent}%
            </span>
            <p className={`text-xs font-semibold mt-1 ${colors.text}`}>{data.dailyLabel}</p>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-5 mb-5">
          <div className="col-span-3 space-y-4">
            {data.alignment && (
              <div className="rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400 space-y-2">
                <p className="font-medium text-zinc-200">4-hour alignment: {data.alignment.status.replaceAll('_', ' ')}</p>
                <p>Regime: {data.alignment.context.regime.replaceAll('_', ' ')}. {data.alignment.context.reasons.join(' ')}</p>
                <p>2-year yield minus effective Fed rate: {data.alignment.context.rateSpread === null ? 'unavailable' : `${data.alignment.context.rateSpread.toFixed(2)} pp`} {data.alignment.context.rateObservationDate && `(observed ${data.alignment.context.rateObservationDate})`}</p>
                {data.alignment.reasons.map(reason => <p key={reason}>{reason}</p>)}
                <p>Economic trends and release surprises are separate evidence. The regime and score are rule-based; four-hour win probability is not yet validated.</p>
              </div>
            )}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500">Trading Signal</span>
                <span className={`text-sm font-bold ${signal.color}`}>{signal.label}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500">Conviction</span>
                <span className={`text-xs font-semibold ${data.conviction === 'high' ? 'text-emerald-400' : data.conviction === 'medium' ? 'text-amber-400' : 'text-zinc-500'}`}>
                  {data.conviction.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500">Macro Alignment</span>
                <span className={`text-xs font-semibold ${tradingReadiness.color}`}>{tradingReadiness.label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Category Coverage</span>
                <span className="text-xs font-semibold text-zinc-300">{data.confidenceCount} / {data.totalPossibleSignals} categories</span>
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-xs text-zinc-500">Bias Score</span>
                <span className={`text-sm font-semibold ${colors.text}`}>{data.biasScore > 0 ? '+' : ''}{data.biasScore} / ±100</span>
              </div>
              <ScoreBar score={data.biasScore} />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-zinc-600">Bearish -100</span>
                <span className="text-[10px] text-zinc-500">0</span>
                <span className="text-[10px] text-zinc-600">+100 Bullish</span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-2">The percentage is a normalized rule score, not a probability or expected return.</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Direction</p>
                <p className={`text-sm font-semibold ${colors.text}`}>
                  {data.direction === 'weakly_bullish' ? 'Leaning Bullish'
                    : data.direction === 'weakly_bearish' ? 'Leaning Bearish'
                      : data.direction.charAt(0).toUpperCase() + data.direction.slice(1)}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Events</p>
                <p className="text-sm font-semibold text-zinc-200">{data.eventCount}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Supports Bias</p>
                <p className="text-sm font-semibold text-zinc-200">{data.confirmationRatio}%</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Bullish</p>
                <p className="text-sm font-semibold text-emerald-400">{bullishCount}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Bearish</p>
                <p className="text-sm font-semibold text-red-400">{bearishCount}</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">High Impact</p>
                <p className="text-sm font-semibold text-zinc-200">{highImpactCount}</p>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Assessment</p>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                {isBullish ? (
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Fundamental bias is <span className="text-emerald-400 font-medium">{data.direction === 'weakly_bullish' ? 'leaning bullish' : 'bullish'}</span> with <span className="text-zinc-200 font-medium">{data.conviction}</span> conviction.
                    {bullishCount} of {data.eventCount} events support this direction ({data.confirmationRatio}% agreement).
                    {supportingHighImpactCount >= 1 ? ' Supporting evidence includes high-impact events.' : ' No high-impact event supports this direction.'}
                    {data.direction === 'weakly_bullish' ? ' This is a weak lean — wait for stronger confirmation before acting.' : ''}
                    {data.conviction === 'high' ? ' Multiple macro categories support this direction under the scoring rules.' : ''}
                  </p>
                ) : isBearish ? (
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    Fundamental bias is <span className="text-red-400 font-medium">{data.direction === 'weakly_bearish' ? 'leaning bearish' : 'bearish'}</span> with <span className="text-zinc-200 font-medium">{data.conviction}</span> conviction.
                    {bearishCount} of {data.eventCount} events support this direction ({data.confirmationRatio}% agreement).
                    {supportingHighImpactCount >= 1 ? ' Supporting evidence includes high-impact events.' : ' No high-impact event supports this direction.'}
                    {data.direction === 'weakly_bearish' ? ' This is a weak lean — wait for stronger confirmation before acting.' : ''}
                    {data.conviction === 'high' ? ' Multiple macro categories support this direction under the scoring rules.' : ''}
                  </p>
                ) : (
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    No dominant fundamental bias detected. Signals are either mixed or too weak to establish direction.
                    Wait for stronger macroeconomic data or news catalysts before entering a position.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="col-span-2">
            {data.events.length > 0 && (
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
                  All Drivers ({data.events.length})
                </p>
                <p className="text-[10px] text-zinc-500 mb-2">Contributions are rule inputs before category caps and the final ±100 cap, so their sum can differ from the bias score.</p>
                <div className="space-y-1.5 max-h-[460px] overflow-y-auto pr-1">
                  {data.events.map((e, idx) => {
                    const isExpanded = expandedIdx === idx;
                    return (
                      <div key={e.id} className="rounded overflow-hidden">
                        <button
                          onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                          className="flex items-center justify-between w-full py-1.5 px-2 rounded bg-zinc-900/50 hover:bg-zinc-800/70 transition-colors text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className={`inline-block px-1.5 py-0.5 text-[9px] font-medium leading-none rounded border shrink-0 ${
                              e.impact === 'high' ? 'bg-red-900/40 text-red-400 border-red-700/40'
                                : e.impact === 'medium' ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
                                  : 'bg-zinc-800 text-zinc-400 border-zinc-700/40'
                            }`}>{e.impact}</span>
                            <span className="text-xs text-zinc-300 truncate">{e.title}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-xs font-mono font-medium tabular-nums ${
                              e.scoreChange > 0 ? 'text-emerald-400' : e.scoreChange < 0 ? 'text-red-400' : 'text-zinc-500'
                            }`}>
                              {e.scoreChange > 0 ? '+' : ''}{e.scoreChange}
                            </span>
                            <svg className={`w-3 h-3 text-zinc-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="px-2 pb-2 pt-1">
                            <div className="rounded border border-zinc-700/50 bg-zinc-900/80 p-3 space-y-2">
                              <p className="text-xs text-zinc-100 leading-relaxed">{e.description}</p>
                              {e.evidenceType && <p className="text-[10px] text-zinc-400">Evidence: {e.evidenceType}{e.timestamp ? ` · available ${new Date(e.timestamp).toLocaleString()}` : ''}</p>}
                              {e.observationDate && <p className="text-[10px] text-zinc-400">Observation period: {e.observationDate}</p>}
                              <div className="flex items-center gap-2 flex-wrap">
                                {e.sourceName && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/40 uppercase tracking-wider">
                                    {e.sourceName}
                                  </span>
                                )}
                                {e.url && (
                                  <a
                                    href={e.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline transition-colors inline-flex items-center gap-1"
                                  >
                                    Open article →
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-zinc-800 space-y-1">
          <p className="text-[10px] text-zinc-600">Updated: {new Date(data.lastUpdated).toLocaleString()}</p>
          <p className="text-[10px] text-zinc-600">This is not financial advice. Always do your own research.</p>
        </div>
      </div>
    </div>
  );
}
