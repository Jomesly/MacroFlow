'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BiasApiResponse, BiasResult, DataSource, DxyContext, UpcomingEvent } from '@/lib/types';
import MarketCard from '@/components/MarketCard';
import BiasDetail from '@/components/BiasDetail';
import Disclaimer from '@/components/Disclaimer';

function DxyBar({ dxy }: { dxy: DxyContext }) {
  const isUp = dxy.status === 'strengthening';
  return (
    <div className={`rounded-lg border px-4 py-3 flex items-center justify-between ${
      isUp ? 'border-red-800/30 bg-red-950/15' : 'border-emerald-800/30 bg-emerald-950/15'
    }`}>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">DXY</span>
          <span className="text-sm font-bold text-white">{dxy.price}</span>
        </div>
        <span className={`flex items-center gap-1 text-xs font-semibold ${
          isUp ? 'text-red-400' : 'text-emerald-400'
        }`}>
          {isUp ? '↑' : '↓'} {Math.abs(dxy.percentChange).toFixed(2)}%
          <span className="font-normal text-zinc-500 ml-0.5">
            ({isUp ? 'STRENGTHENING' : 'WEAKENING'})
          </span>
        </span>
      </div>
      <p className={`text-[11px] ${isUp ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
        {dxy.summary}
      </p>
    </div>
  );
}

function CountdownTimer({ target }: { target: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function tick() {
      const diff = new Date(target).getTime() - Date.now();
      if (diff <= 0) { setRemaining('Starting soon'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setRemaining(`${h}h ${m}m`);
    }
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [target]);

  return <span className="tabular-nums">{remaining}</span>;
}

function NextEventBar({ nextEvent }: { nextEvent: UpcomingEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-blue-800/30 bg-blue-950/15 px-4 py-3">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full text-left cursor-pointer">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-700/40 uppercase shrink-0">
            Next Event
          </span>
          <span className="text-xs text-zinc-300 font-medium truncate">{nextEvent.country} {nextEvent.name}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
            nextEvent.impact === 'high' ? 'bg-red-900/40 text-red-400' : 'bg-amber-900/40 text-amber-400'
          }`}>
            {nextEvent.impact.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-blue-300 font-mono">
            In <CountdownTimer target={nextEvent.date} />
          </span>
          <svg className={`w-3 h-3 text-zinc-500 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <p className="text-[10px] text-zinc-500 mt-2 pt-2 border-t border-blue-800/20">
          Affects: {nextEvent.affects.join(', ')}
        </p>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<BiasResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>('baseline');
  const [selected, setSelected] = useState<BiasResult | null>(null);
  const [dxy, setDxy] = useState<DxyContext | undefined>();
  const [nextEvent, setNextEvent] = useState<UpcomingEvent | undefined | null>();
  const mountedRef = useRef(true);

  const fetchBias = useCallback(async () => {
    try {
      const res = await fetch('/api/bias');
      if (!res.ok) throw new Error('Failed to fetch bias data');
      const json: BiasApiResponse = await res.json();
      if (mountedRef.current) {
        setData(json.data);
        setLastUpdated(json.timestamp);
        setSource(json.source);
        setDxy(json.dxy);
        setNextEvent(json.nextEvent);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const id = setTimeout(() => { fetchBias(); }, 0);
    const interval = setInterval(() => { fetchBias(); }, 60000);
    return () => {
      mountedRef.current = false;
      clearTimeout(id);
      clearInterval(interval);
    };
  }, [fetchBias]);

  const sourceColors: Record<DataSource, string> = {
    live: 'bg-emerald-500',
    hybrid: 'bg-emerald-400',
    baseline: 'bg-amber-500',
  };
  const sourceLabels: Record<DataSource, string> = {
    live: 'Live Data',
    hybrid: 'Live + Baseline',
    baseline: 'Baseline Only',
  };

  return (
    <div className="flex flex-col flex-1">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white tracking-tight">MacroFlow</h1>
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                <span className={`w-1.5 h-1.5 rounded-full ${sourceColors[source]}`} />
                {sourceLabels[source]}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Fundamental Trading Bias Dashboard
            </p>
          </div>
          <div className="text-right">
            {lastUpdated && (
              <p className="text-[11px] text-zinc-600">
                Updated: {new Date(lastUpdated).toLocaleTimeString()}
              </p>
            )}
            <button
              onClick={() => {
                setLoading(true);
                fetchBias();
              }}
              className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {dxy && (
          <div className="mb-4">
            <DxyBar dxy={dxy} />
          </div>
        )}

        {nextEvent && (
          <div className="mb-4">
            <NextEventBar nextEvent={nextEvent} />
          </div>
        )}

        {loading && data.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 animate-pulse">
                <div className="h-4 w-20 bg-zinc-800 rounded mb-3" />
                <div className="h-3 w-32 bg-zinc-800 rounded mb-4" />
                <div className="h-2 w-full bg-zinc-800 rounded mb-2" />
                <div className="h-2 w-3/4 bg-zinc-800 rounded" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-800/30 bg-red-950/20 p-6 text-center">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                fetchBias();
              }}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {data.map((item) => (
              <MarketCard key={item.symbol} data={item} onClick={() => setSelected(item)} />
            ))}
          </div>
        )}

        {data.length > 0 && source === 'baseline' && (
          <div className="mt-4 rounded-lg border border-amber-800/30 bg-amber-950/10 px-4 py-3">
            <p className="text-xs text-amber-400/80 text-center">
              Showing baseline data — no live RSS feeds or APIs returned data. Bias values will update once
              market data sources respond.
            </p>
          </div>
        )}

        <p className="text-[10px] text-zinc-700 text-center mt-6">
          Click any card for full analysis: trading signal, conviction, sentiment, and event details.
        </p>
      </main>

      <footer className="border-t border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <Disclaimer />
        </div>
      </footer>

      {selected && (
        <BiasDetail data={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
