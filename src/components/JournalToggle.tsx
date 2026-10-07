'use client';

import { useCallback, useRef, useState } from 'react';
import { Trade, TradesApiResponse } from '@/lib/types';
import JournalPeek from './JournalPeek';

export default function JournalToggle() {
  const [peekVisible, setPeekVisible] = useState(false);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  const ensureLoaded = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/journal/trade');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TradesApiResponse = await res.json();
      setTrades(json.trades);
    } catch {
      setError(true);
      fetchedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMouseEnter = () => {
    setPeekVisible(true);
    void ensureLoaded();
  };

  const handleMouseLeave = () => setPeekVisible(false);

  const handleClick = () => {
    window.open('/journal', '_blank');
  };

  return (
    <div
      className="fixed right-0 top-1/2 -translate-y-1/2 z-40 pl-2"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <JournalPeek trades={trades} loading={loading} error={error} visible={peekVisible} />
      <button
        type="button"
        onClick={handleClick}
        title="Open Trading Journal"
        aria-label="Open Trading Journal"
        className="flex flex-col items-center gap-2.5 rounded-l-lg border border-r-0 border-zinc-800 bg-zinc-900 px-2 py-4 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
        <span className="text-[9px] font-semibold uppercase tracking-[0.25em] [writing-mode:vertical-rl]">
          Journal
        </span>
      </button>
    </div>
  );
}
