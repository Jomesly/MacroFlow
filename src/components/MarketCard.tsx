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
import { leadDriver, type BoardTile } from "@/lib/market-board";
import { marketIsOpen } from "@/lib/marketIsOpen";
import { currentDirectionChance, chanceHeadline } from "@/lib/direction-chance";
import { useMarketClock } from "@/components/market/useMarketClock";
import DirectionChanceChart from "@/components/market/DirectionChanceChart";

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
  chanceBlocked = false,
}: {
  data: BiasResult;
  /** Board placement; on wide screens the tile's size follows its conviction. */
  tile?: BoardTile;
  /** Runs just before the card opens the market's full analysis page. */
  onNavigate?: () => void;
  index?: number;
  historyScale?: number;
  chanceBlocked?: boolean;
}) {
  const [flip, setFlip] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const now = useMarketClock();
  const chance = currentDirectionChance(data, now, chanceBlocked);
  const headline = chanceHeadline(chance);
  const positive = data.forecast ? headline.direction === 'up' : data.direction.includes("bullish");
  const negative = data.forecast ? headline.direction === 'down' : data.direction.includes("bearish");
  const tone = positive ? "positive" : negative ? "negative" : "neutral";
  const open = marketIsOpen(data.symbol);
  const driver = leadDriver(data);
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
        aria-label={`View ${data.symbol} analysis`}
      >
        <span className="market-id">
          <h3>{data.symbol}</h3>
          <span className="market-name">
            <span>{data.name}</span>
            {!open && <span>Closed</span>}
          </span>
        </span>
        <span className="market-score" aria-label={data.forecast
          ? headline.percent === null ? 'Direction chance unavailable' : `${headline.percent}% estimated ${headline.direction} chance over four hours`
          : `${data.biasPercent}% macro bias strength`}>
          {data.forecast ? headline.percent ?? '—' : `${data.biasPercent > 0 ? '+' : ''}${data.biasPercent}`}
          {(!data.forecast || headline.percent !== null) && <small>%</small>}
        </span>
        <span className="market-read">
          <span className="market-direction">
            <DirectionIcon
              size={14}
              weight="bold"
              className="score-direction-icon"
              aria-hidden="true"
            />
            {data.forecast ? headline.direction === "up" ? "Estimated chance up" : headline.direction === "down" ? "Estimated chance down" : headline.direction === "balanced" ? "Even chance" : "Awaiting estimate" : direction}
          </span>
          <span className="market-conviction">{conviction} {data.forecast ? "confidence / 4h" : "conviction"}</span>
        </span>
        {tile?.size === "lg" && driver && (
          <span className="market-driver">{driver}</span>
        )}
        {data.forecast ? <DirectionChanceChart chance={chance} compact /> : <BiasHistory data={data} scale={historyScale} />}
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
