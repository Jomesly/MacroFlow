"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CaretRight,
  Minus,
  TrendUp,
} from "@phosphor-icons/react";
import type { BiasResult } from "@/lib/types";
import { marketIsOpen } from "@/lib/marketIsOpen";

/** Every row shares one scale, so a small move never looks like a large one. */
function BiasHistory({ data, scale }: { data: BiasResult; scale: number }) {
  const scores = data.history.slice(-7).map((item) => item.biasScore);
  if (scores.length < 2)
    return (
      <div className="bias-history-empty">
        Bias history builds with daily snapshots.
      </div>
    );
  const y = (score: number) =>
    22 - (Math.max(-scale, Math.min(scale, score)) / scale) * 20;
  const line = scores
    .map(
      (score, i) =>
        `${i === 0 ? "M" : "L"}${(i * 240) / (scores.length - 1)} ${y(score)}`,
    )
    .join(" ");
  return (
    <svg
      className="bias-history"
      viewBox="0 0 240 44"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${data.symbol} historical bias scores: ${scores.join(", ")}`}
    >
      <path d="M0 22H240" className="chart-zero" />
      <path d={line} className="chart-line" />
    </svg>
  );
}

export default function MarketCard({
  data,
  onClick,
  index = 0,
  historyScale = 100,
}: {
  data: BiasResult;
  onClick: () => void;
  index?: number;
  historyScale?: number;
}) {
  const [flip, setFlip] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const positive = data.direction.includes("bullish");
  const negative = data.direction.includes("bearish");
  const tone = positive ? "positive" : negative ? "negative" : "neutral";
  const open = marketIsOpen(data.symbol);
  const direction = data.direction.startsWith("weakly_")
    ? `Leaning ${positive ? "bullish" : "bearish"}`
    : data.direction.charAt(0).toUpperCase() + data.direction.slice(1);
  const conviction =
    data.conviction.charAt(0).toUpperCase() + data.conviction.slice(1);
  const DirectionIcon = positive
    ? ArrowUpRight
    : negative
      ? ArrowDownRight
      : Minus;

  useEffect(() => {
    try {
      const key = `mf-direction-${data.symbol}`;
      const previous = sessionStorage.getItem(key);
      if (previous && previous !== data.direction) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- compare the previous session snapshot after hydration
        setFlip(previous.replaceAll("_", " "));
      }
      sessionStorage.setItem(key, data.direction);
    } catch {
      /* The card remains usable when browser storage is unavailable. */
    }
  }, [data.symbol, data.direction]);

  return (
    <motion.article
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: reduce ? 0 : 0.3,
        delay: reduce ? 0 : index * 0.045,
      }}
      className={`market-card tone-${tone}`}
    >
      <button
        type="button"
        onClick={onClick}
        className="market-card-main"
        aria-label={`View ${data.symbol} analysis`}
      >
        <span className="market-id">
          <h3>{data.symbol}</h3>
          <span className="market-name">
            <span>{data.name}</span>
            {!open && <span>Closed</span>}
          </span>
        </span>
        <span className="market-score">
          {data.biasPercent > 0 ? "+" : ""}
          {data.biasPercent}
          <small>%</small>
        </span>
        <span className="market-read">
          <span className="market-direction">
            <DirectionIcon
              size={14}
              weight="bold"
              className="score-direction-icon"
              aria-hidden="true"
            />
            {direction}
          </span>
          <span className="market-conviction">{conviction} conviction</span>
        </span>
        <BiasHistory data={data} scale={historyScale} />
        <CaretRight
          size={16}
          className="market-card-caret"
          aria-hidden="true"
        />
      </button>
      {flip && (
        <button
          type="button"
          className="flip-notice"
          onClick={() => {
            setFlip(null);
            onClick();
          }}
        >
          <TrendUp size={15} aria-hidden="true" />
          <span>Bias changed from {flip}. View analysis.</span>
        </button>
      )}
    </motion.article>
  );
}
