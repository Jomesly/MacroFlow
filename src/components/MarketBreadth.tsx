'use client';

import { motion, useReducedMotion } from 'motion/react';
import type { BiasResult } from '@/lib/types';

export default function MarketBreadth({ data }: { data: BiasResult[] }) {
  const reduce = useReducedMotion();
  const counts = [
    {
      label: 'Bullish',
      value: data.filter((d) => d.direction.includes('bullish')).length,
      tone: 'positive',
    },
    {
      label: 'Neutral',
      value: data.filter((d) => d.direction === 'neutral').length,
      tone: 'neutral',
    },
    {
      label: 'Bearish',
      value: data.filter((d) => d.direction.includes('bearish')).length,
      tone: 'negative',
    },
  ];
  return (
    <section className="breadth-panel" aria-labelledby="breadth-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="breadth-title">Market breadth</h2>
        <span className="text-xs text-zinc-400">{data.length} markets</span>
      </div>
      <div
        className="breadth-track"
        role="img"
        aria-label={counts
          .map((c) => `${c.value} ${c.label.toLowerCase()}`)
          .join(', ')}
      >
        {counts
          .filter((c) => c.value > 0)
          .map((c) => (
            <span
              key={c.label}
              className={`breadth-segment tone-${c.tone}`}
              style={{ flex: c.value }}
            >
              <motion.span
                initial={reduce ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: reduce ? 0 : 0.65,
                  delay: reduce ? 0 : 0.15,
                }}
              />
            </span>
          ))}
        {data.length === 0 && (
          <span className="text-xs text-zinc-400">Waiting for market data</span>
        )}
      </div>
      <div className="breadth-legend">
        {counts.map((c) => (
          <div key={c.label}>
            <span className={`legend-dot tone-${c.tone}`} />
            <span>{c.label}</span>
            <strong>{c.value.toString().padStart(2, '0')}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
