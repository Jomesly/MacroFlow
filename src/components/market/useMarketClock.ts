'use client';

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((update) => update()), 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(timer); timer = undefined; }
  };
}

function snapshot() { return Math.floor(Date.now() / 1000) * 1000; }

/** One clock updates source expiry and next-release selection across panels. */
export function useMarketClock() {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
