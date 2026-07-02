'use client';

import { BiasResult } from '@/lib/types';

const DIRECTION_COLORS: Record<string, { text: string; bg: string; border: string; bar: string }> = {
  bullish: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-950/20',
    border: 'border-emerald-800/30',
    bar: 'bg-emerald-500',
  },
  bearish: {
    text: 'text-red-400',
    bg: 'bg-red-950/20',
    border: 'border-red-800/30',
    bar: 'bg-red-500',
  },
  neutral: {
    text: 'text-zinc-400',
    bg: 'bg-zinc-800/20',
    border: 'border-zinc-700/30',
    bar: 'bg-zinc-500',
  },
};

function ScoreBar({ score }: { score: number }) {
  const barWidth = Math.min(Math.abs(score), 100);
  const isPositive = score >= 0;

  return (
    <div className="relative h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
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
        <div className="h-full w-px bg-zinc-500" />
      </div>
    </div>
  );
}

function SentimentGauge({ sentiment }: { sentiment: string }) {
  const isFear = sentiment === 'fear';
  const isGreed = sentiment === 'greed';
  const fill = isFear ? 25 : isGreed ? 75 : 50;

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] text-zinc-500">
        <span>Fear</span>
        <span className="font-medium text-zinc-400 capitalize">{sentiment}</span>
        <span>Greed</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${
            isFear ? 'bg-red-500' : isGreed ? 'bg-emerald-500' : 'bg-zinc-500'
          }`}
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  );
}

function TradeabilityBadge({ tradeable, reason }: { tradeable: boolean; reason: string }) {
  return (
    <div className={`rounded-lg border p-3 ${tradeable ? 'border-emerald-800/30 bg-emerald-950/20' : 'border-zinc-700/30 bg-zinc-800/20'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-lg ${tradeable ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {tradeable ? '✓' : '○'}
        </span>
        <span className={`text-sm font-semibold ${tradeable ? 'text-emerald-400' : 'text-zinc-400'}`}>
          {tradeable ? 'Tradeable' : 'Exercise Caution'}
        </span>
      </div>
      <p className="text-xs text-zinc-500 leading-relaxed">{reason}</p>
    </div>
  );
}

interface BiasDetailProps {
  data: BiasResult;
  onClose: () => void;
}

export default function BiasDetail({ data, onClose }: BiasDetailProps) {
  const colors = DIRECTION_COLORS[data.direction] || DIRECTION_COLORS.neutral;

  const riskOffCount = data.events.filter((e) => e.category === 'risk_sentiment' && e.scoreChange < 0).length;
  const riskOnCount = data.events.filter((e) => e.category === 'risk_sentiment' && e.scoreChange > 0).length;
  const tensionCount = data.events.filter((e) => e.category === 'geopolitical' && e.scoreChange > 0).length;

  const sentiment =
    riskOffCount + tensionCount > riskOnCount && riskOffCount + tensionCount > 0
      ? 'fear'
      : riskOnCount > riskOffCount + tensionCount
        ? 'greed'
        : 'neutral';

  const hasClearDirection = Math.abs(data.biasScore) > 25;
  const hasEnoughEvents = data.events.length >= 2;
  const bullishCount = data.events.filter((e) => e.scoreChange > 0).length;
  const bearishCount = data.events.filter((e) => e.scoreChange < 0).length;
  const hasConflict = bullishCount > 0 && bearishCount > 0;
  const highImpactCount = data.events.filter((e) => e.impact === 'high').length;

  const tradeable = hasClearDirection && hasEnoughEvents && highImpactCount >= 1;
  const tradeReason = tradeable
    ? `Clear ${data.direction} bias with ${highImpactCount} high-impact event${highImpactCount > 1 ? 's' : ''} driving the signal. ${hasConflict ? 'Some conflicting signals exist, but net direction is clear.' : 'All signals align in the same direction.'}`
    : !hasClearDirection
      ? 'Bias is neutral or too weak to trade. Wait for a stronger fundamental signal.'
      : !hasEnoughEvents
        ? 'Not enough events driving this bias. More confirmation needed.'
        : 'Insufficient high-impact events to confirm the signal.';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-12 px-4 pb-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-300 transition-colors text-lg leading-none"
        >
          ✕
        </button>

        <div className="flex items-start justify-between mb-5 pr-6">
          <div>
            <h2 className="text-xl font-bold text-white">{data.symbol}</h2>
            <p className="text-sm text-zinc-500 mt-0.5">{data.name}</p>
          </div>
          <div className="text-right">
            <span className={`text-3xl font-bold leading-none tabular-nums ${colors.text}`}>
              {data.biasPercent > 0 ? '+' : ''}
              {data.biasPercent}%
            </span>
            <p className={`text-xs font-semibold mt-1 ${colors.text}`}>{data.dailyLabel}</p>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs text-zinc-500">Score</span>
            <span className={`text-sm font-semibold ${colors.text}`}>
              {data.biasScore > 0 ? '+' : ''}
              {data.biasScore} / +100
            </span>
          </div>
          <ScoreBar score={data.biasScore} />
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-zinc-600">Bearish -100</span>
            <span className="text-[10px] text-zinc-500">0</span>
            <span className="text-[10px] text-zinc-600">+100 Bullish</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Direction</p>
            <p className={`text-sm font-semibold capitalize ${colors.text}`}>{data.direction}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Strength</p>
            <p className="text-sm font-semibold text-zinc-200 capitalize">{data.strength}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Events</p>
            <p className="text-sm font-semibold text-zinc-200">{data.events.length} active</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Confidence</p>
            <p className={`text-sm font-semibold ${highImpactCount >= 1 ? 'text-emerald-400' : 'text-zinc-400'}`}>
              {highImpactCount >= 2 ? 'High' : highImpactCount >= 1 ? 'Medium' : 'Low'}
            </p>
          </div>
        </div>

        <div className="mb-5">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Investor Sentiment</p>
          <SentimentGauge sentiment={sentiment} />
        </div>

        <div className="mb-5">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Tradeability</p>
          <TradeabilityBadge tradeable={tradeable} reason={tradeReason} />
        </div>

        {data.events.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
              All Drivers ({data.events.length})
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scroll">
              {data.events.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-zinc-900/50">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`inline-block px-1.5 py-0.5 text-[9px] font-medium leading-none rounded border ${
                        e.impact === 'high'
                          ? 'bg-red-900/40 text-red-400 border-red-700/40'
                          : e.impact === 'medium'
                            ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700/40'
                      }`}
                    >
                      {e.impact}
                    </span>
                    <span className="text-xs text-zinc-300 truncate">{e.title}</span>
                  </div>
                  <span
                    className={`text-xs font-mono font-medium ml-2 tabular-nums ${
                      e.scoreChange > 0 ? 'text-emerald-400' : e.scoreChange < 0 ? 'text-red-400' : 'text-zinc-500'
                    }`}
                  >
                    {e.scoreChange > 0 ? '+' : ''}
                    {e.scoreChange}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-zinc-800">
          <p className="text-[10px] text-zinc-600">
            Updated: {new Date(data.lastUpdated).toLocaleString()}
          </p>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            This is not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
