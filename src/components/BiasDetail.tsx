'use client';

import { BiasResult, TradeSignal } from '@/lib/types';

const DIRECTION_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  bullish: { text: 'text-emerald-400', bg: 'bg-emerald-950/20', border: 'border-emerald-800/30' },
  bearish: { text: 'text-red-400', bg: 'bg-red-950/20', border: 'border-red-800/30' },
  neutral: { text: 'text-zinc-400', bg: 'bg-zinc-800/20', border: 'border-zinc-700/30' },
};

const SIGNAL_CONFIG: Record<TradeSignal, { label: string; color: string; bg: string }> = {
  strong_buy: { label: 'Strong Buy', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  buy: { label: 'Buy', color: 'text-emerald-300', bg: 'bg-emerald-400/10 border-emerald-400/30' },
  neutral: { label: 'Neutral / No Signal', color: 'text-zinc-400', bg: 'bg-zinc-800/10 border-zinc-700/30' },
  sell: { label: 'Sell', color: 'text-red-300', bg: 'bg-red-400/10 border-red-400/30' },
  strong_sell: { label: 'Strong Sell', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
};

function ScoreBar({ score }: { score: number }) {
  const barWidth = Math.min(Math.abs(score), 100);
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
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-500 ${isFear ? 'bg-red-500' : isGreed ? 'bg-emerald-500' : 'bg-zinc-500'}`}
          style={{ width: `${fill}%` }}
        />
      </div>
    </div>
  );
}

interface BiasDetailProps {
  data: BiasResult;
  onClose: () => void;
}

export default function BiasDetail({ data, onClose }: BiasDetailProps) {
  const colors = DIRECTION_COLORS[data.direction] || DIRECTION_COLORS.neutral;
  const signal = SIGNAL_CONFIG[data.signal];
  const isBullish = data.direction === 'bullish';
  const isBearish = data.direction === 'bearish';

  const riskOffCount = data.events.filter((e) => e.category === 'risk_sentiment' && e.scoreChange < 0).length;
  const riskOnCount = data.events.filter((e) => e.category === 'risk_sentiment' && e.scoreChange > 0).length;
  const tensionCount = data.events.filter((e) => e.category === 'geopolitical' && e.scoreChange > 0).length;
  const sentiment = riskOffCount + tensionCount > riskOnCount && riskOffCount + tensionCount > 0 ? 'fear'
    : riskOnCount > riskOffCount + tensionCount ? 'greed' : 'neutral';

  const highImpactCount = data.events.filter((e) => e.impact === 'high').length;
  const bullishCount = data.events.filter((e) => e.scoreChange > 0).length;
  const bearishCount = data.events.filter((e) => e.scoreChange < 0).length;

  const tradingReadiness =
    data.conviction === 'high' && Math.abs(data.biasScore) > 40
      ? { label: 'High probability setup', color: 'text-emerald-400' }
      : data.conviction === 'medium' && Math.abs(data.biasScore) > 25
        ? { label: 'Moderate probability — manage risk', color: 'text-amber-400' }
        : { label: 'Low conviction — wait for clearer signal', color: 'text-zinc-500' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 pt-12 px-4 pb-4 overflow-y-auto" onClick={onClose}>
      <div
        className="relative w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
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

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 mb-5">
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
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Probability</span>
            <span className={`text-xs font-semibold ${tradingReadiness.color}`}>{tradingReadiness.label}</span>
          </div>
        </div>

        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs text-zinc-500">Bias Score</span>
            <span className={`text-sm font-semibold ${colors.text}`}>{data.biasScore > 0 ? '+' : ''}{data.biasScore} / +100</span>
          </div>
          <ScoreBar score={data.biasScore} />
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-zinc-600">Bearish -100</span>
            <span className="text-[10px] text-zinc-500">0</span>
            <span className="text-[10px] text-zinc-600">+100 Bullish</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Direction</p>
            <p className={`text-sm font-semibold capitalize ${colors.text}`}>{data.direction}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Events</p>
            <p className="text-sm font-semibold text-zinc-200">{data.eventCount}</p>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Agreement</p>
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

        <div className="mb-5">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Market Sentiment</p>
          <SentimentGauge sentiment={sentiment} />
        </div>

        <div className="mb-5">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Assessment</p>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            {isBullish ? (
              <p className="text-xs text-zinc-300 leading-relaxed">
                Fundamental bias is <span className="text-emerald-400 font-medium">bullish</span> with <span className="text-zinc-200 font-medium">{data.conviction}</span> conviction.
                {bullishCount} of {data.eventCount} events support this direction ({data.confirmationRatio}% agreement).
                {highImpactCount >= 1 ? ' High-impact events confirm the signal.' : ' Most signals are medium/low impact — monitor closely.'}
                {data.conviction === 'high' ? ' This is a high-probability alignment between technical and fundamental analysis.' : ''}
              </p>
            ) : isBearish ? (
              <p className="text-xs text-zinc-300 leading-relaxed">
                Fundamental bias is <span className="text-red-400 font-medium">bearish</span> with <span className="text-zinc-200 font-medium">{data.conviction}</span> conviction.
                {bearishCount} of {data.eventCount} events support this direction ({data.confirmationRatio}% agreement).
                {highImpactCount >= 1 ? ' High-impact events confirm the signal.' : ' Most signals are medium/low impact — monitor closely.'}
                {data.conviction === 'high' ? ' This is a high-probability alignment between technical and fundamental analysis.' : ''}
              </p>
            ) : (
              <p className="text-xs text-zinc-400 leading-relaxed">
                No dominant fundamental bias detected. Signals are either mixed or too weak to establish direction.
                Wait for stronger macroeconomic data or news catalysts before entering a position.
              </p>
            )}
          </div>
        </div>

        {data.events.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
              All Drivers ({data.events.length})
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {data.events.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-zinc-900/50">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-medium leading-none rounded border ${
                      e.impact === 'high' ? 'bg-red-900/40 text-red-400 border-red-700/40'
                        : e.impact === 'medium' ? 'bg-amber-900/40 text-amber-400 border-amber-700/40'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700/40'
                    }`}>{e.impact}</span>
                    <span className="text-xs text-zinc-300 truncate">{e.title}</span>
                  </div>
                  <span className={`text-xs font-mono font-medium ml-2 tabular-nums ${
                    e.scoreChange > 0 ? 'text-emerald-400' : e.scoreChange < 0 ? 'text-red-400' : 'text-zinc-500'
                  }`}>
                    {e.scoreChange > 0 ? '+' : ''}{e.scoreChange}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-zinc-800 space-y-1">
          <p className="text-[10px] text-zinc-600">Updated: {new Date(data.lastUpdated).toLocaleString()}</p>
          <p className="text-[10px] text-zinc-600">This is not financial advice. Always do your own research.</p>
        </div>
      </div>
    </div>
  );
}
