'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Visible tabs poll only at the dataset cadence; unmounts abort pending work. */
export function useMarketResource<T>(url: string, intervalMs = 300_000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);

  const refresh = useCallback(async () => {
    if (controller.current || document.hidden) return;
    const request = new AbortController();
    controller.current = request;
    lastAttempt.current = Date.now();
    setLoading(true);
    try {
      const response = await fetch(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]) });
      if (!response.ok) throw new Error('Request failed');
      const result: T = await response.json();
      if (!request.signal.aborted) { setData(result); setError(false); }
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted) setLoading(false);
      if (controller.current === request) controller.current = null;
    }
  }, [url]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const visible = () => {
      if (!document.hidden && Date.now() - lastAttempt.current >= intervalMs) void refresh();
    };
    const timer = setInterval(visible, intervalMs);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      clearTimeout(initial);
      document.removeEventListener('visibilitychange', visible);
      controller.current?.abort();
      controller.current = null;
    };
  }, [refresh, intervalMs]);

  return { data, loading, error, refresh };
}
