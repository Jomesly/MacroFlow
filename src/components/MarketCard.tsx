"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CaretRight,
  Minus,
  TrendUp,
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import type { BiasResult } from "@/lib/types";
import type { BoardTile } from "@/lib/market-board";
import { marketIsOpen } from "@/lib/marketIsOpen";
import { biasWord, convictionLabel } from "@/lib/market-factors";

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
  tile,
  onNavigate,
  index = 0,
  historyScale = 100,
  outdated = false,
}: {
  data: BiasResult;
  /** Board placement; on wide screens the tile's size follows its conviction. */
  tile?: BoardTile;
  /** Runs just before the card opens the market's full analysis page. */
  onNavigate?: () => void;
  index?: number;
  historyScale?: number;
  /** The read could not be refreshed; conviction must not be presented as current. */
  outdated?: boolean;
}) {
  const [flip, setFlip] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const positive = data.direction.includes("bullish");
  const negative = data.direction.includes("bearish");
  const tone = positive ? "positive" : negative ? "negative" : "neutral";
  const open = marketIsOpen(data.symbol);
  const bias = biasWord(data.direction);
  // Strength of the news and macro lean; the full analysis page holds the reasons.
  const strength = data.direction === "neutral" ? null : Math.abs(Math.round(data.biasPercent));
  // Signal-bar meter: empty when there is no lean to be convinced of.
  const level = data.direction === "neutral" ? 0 : data.conviction === "high" ? 3 : data.conviction === "medium" ? 2 : 1;
  const DirectionIcon = positive
    ? ArrowUpRight
    : negative
      ? ArrowDownRight
      : Minus;

  useEffect(() => {
    try {
      const key = `mf-direction-${data.forecast?.modelVersion ?? data.alignment?.modelVersion ?? "legacy"}-${data.symbol}`;
      const previous = sessionStorage.getItem(key);
      if (previous && previous !== data.direction) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- compare the previous session snapshot after hydration
        setFlip(previous.replaceAll("_", " "));
      }
      sessionStorage.setItem(key, data.direction);
    } catch {
      /* The card remains usable when browser storage is unavailable. */
    }
  }, [data.symbol, data.direction, data.alignment?.modelVersion, data.forecast?.modelVersion]);

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
      data-conviction={data.conviction}
      data-outdated={outdated || undefined}
      data-size={tile?.size}
      style={
        tile
          ? ({
              "--tile-col": `${tile.col} / span ${tile.colSpan}`,
              "--tile-row": `${tile.row} / span ${tile.rowSpan}`,
            } as CSSProperties)
          : undefined
      }
    >
      <Link
        href={`/markets/${data.symbol}`}
        onClick={onNavigate}
        className="market-card-main"
        aria-label={`${data.symbol}: ${bias}${strength === null ? "" : `, ${strength}% strength`}, ${convictionLabel(data).toLowerCase()}${outdated ? ", outdated read" : ""}. View full analysis.`}
      >
        <span className="market-id">
          <h3>{data.symbol}</h3>
          <span className="market-name">
            <span>{data.name}</span>
            {!open && <span>Closed</span>}
          </span>
        </span>
        <span className="market-score is-bias">
          <DirectionIcon
            size="0.6em"
            weight="bold"
            className="score-direction-icon"
            aria-hidden="true"
          />
          {bias}
        </span>
        <span className="market-percent">
          {strength === null ? "—" : strength}
          {strength !== null && <small>%</small>}
        </span>
        <span className="market-read">
          <span className="market-direction">
            <span className="conviction-meter" data-level={level} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {convictionLabel(data)}
            {outdated ? (
              <span className="market-window is-outdated">Outdated</span>
            ) : (
              data.forecast && <span className="market-window">4h</span>
            )}
          </span>
        </span>
        {!data.forecast && <BiasHistory data={data} scale={historyScale} />}
        <CaretRight
          size={16}
          className="market-card-caret"
          aria-hidden="true"
        />
      </Link>
      {flip && (
        <Link
          href={`/markets/${data.symbol}`}
          className="flip-notice"
          aria-label={`${data.symbol} bias changed from ${flip}. View analysis.`}
          onClick={() => {
            setFlip(null);
            onNavigate?.();
          }}
        >
          <TrendUp size={15} aria-hidden="true" />
          <span className="flip-text">Bias changed from {flip}. View analysis.</span>
          <span className="flip-short">Changed</span>
        </Link>
      )}
    </motion.article>
  );
}
