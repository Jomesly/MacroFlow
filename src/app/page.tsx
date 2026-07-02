'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BiasApiResponse, BiasResult, DataSource } from '@/lib/types';
import MarketCard from '@/components/MarketCard';
import BiasDetail from '@/components/BiasDetail';
import Disclaimer from '@/components/Disclaimer';

export default function Home() {
  const [data, setData] = useState<BiasResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [source, setSource] = useState<DataSource>('baseline');
  const [selected, setSelected] = useState<BiasResult | null>(null);
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
