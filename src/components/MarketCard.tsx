"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CaretDown,
  Minus,
  TrendUp,
} from "@phosphor-icons/react";
import type { BiasResult } from "@/lib/types";
import { marketIsOpen } from "@/lib/marketIsOpen";

const ASSET_MARK: Record<string, { mark: string; name: string }> = {
  XAUUSD: { mark: "Au", name: "Commodity" },
  GBPUSD: { mark: "£", name: "Forex" },
  US100: { mark: "N", name: "US index" },
  DJ30: { mark: "D", name: "US index" },
  BTCUSD: { mark: "₿", name: "Crypto" },
};

function BiasHistory({ data }: { data: BiasResult }) {
  const scores = data.history.slice(-7).map((item) => item.biasScore);
  const positive = data.direction.includes("bullish");
  const negative = data.direction.includes("bearish");
  if (scores.length < 2)
    return (
      <div className="bias-history-empty">
        Bias history builds with daily snapshots.
      </div>
    );
  const points = scores.map((score, i) => [
    8 + i * (224 / (scores.length - 1)),
    32 - Math.max(-100, Math.min(100, score)) * 0.25,
  ]);
  const line = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`)
    .join(" ");
  return (
    <svg
      className={`bias-history ${positive ? "is-positive" : negative ? "is-negative" : ""}`}
      viewBox="0 0 240 66"
      role="img"
      aria-label={`${data.symbol} historical bias scores: ${scores.join(", ")}`}
    >
      <defs>
        <linearGradient id={`area-${data.symbol}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0 32H240" className="chart-zero" />
      <path
        d={`${line} L232 66 L8 66 Z`}
        className="chart-area"
        fill={`url(#area-${data.symbol})`}
      />
      <path d={line} className="chart-line" />
      <circle
        cx={points.at(-1)![0]}
        cy={points.at(-1)![1]}
        r="7"
        className="chart-endpoint-halo"
      />
      <circle
        cx={points.at(-1)![0]}
        cy={points.at(-1)![1]}
        r="3"
        fill="currentColor"
      />
    </svg>
  );
}

const METER_SEGMENTS = 10;

/** Bipolar -100..+100 meter: segments light up outward from the centre. */
function BiasMeter({ score }: { score: number }) {
  const clamped = Math.max(-100, Math.min(100, score));
  const lit = Math.round((Math.abs(clamped) / 100) * METER_SEGMENTS);
  const side = (dir: "bear" | "bull") =>
    Array.from({ length: METER_SEGMENTS }, (_, i) => {
      // i counts outward from the centre line.
      const on =
        i < lit &&
        ((dir === "bull" && clamped > 0) || (dir === "bear" && clamped < 0));
      return (
        <i
          key={i}
          className={on ? "is-lit" : undefined}
          style={
            on
              ? { opacity: 0.45 + (0.55 * (i + 1)) / METER_SEGMENTS }
              : undefined
          }
        />
      );
    });
  return (
    <div className="bias-meter">
      <div
        className="bias-meter-track"
        role="img"
        aria-label={`Bias score ${score}, from minus 100 to plus 100`}
      >
        <span className="bias-meter-side is-bear">{side("bear")}</span>
        <span className="bias-meter-center" />
        <span className="bias-meter-side">{side("bull")}</span>
      </div>
      <div className="bias-meter-scale" aria-hidden="true">
        <span>-100</span>
        <span>0</span>
        <span>+100</span>
      </div>
    </div>
  );
}

export default function MarketCard({
  data,
  onClick,
  index = 0,
}: {
  data: BiasResult;
  onClick: () => void;
  index?: number;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [flip, setFlip] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const positive = data.direction.includes("bullish");
  const negative = data.direction.includes("bearish");
  const tone = positive ? "positive" : negative ? "negative" : "neutral";
  const open = marketIsOpen(data.symbol);
  const asset = ASSET_MARK[data.symbol];
  const direction = data.direction.startsWith("weakly_")
    ? `Leaning ${positive ? "bullish" : "bearish"}`
    : data.direction.charAt(0).toUpperCase() + data.direction.slice(1);
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
        <div className="market-card-top">
          <span
            className={`asset-mark asset-${data.symbol.toLowerCase()}`}
            aria-hidden="true"
          >
            {asset.mark}
          </span>
          <span className="asset-identity">
            <h3>{data.symbol}</h3>
            <span>{data.name}</span>
          </span>
          <ArrowUpRight
            size={17}
            className="card-open-icon"
            aria-hidden="true"
          />
        </div>
        <div className="market-score-label">Fundamental bias</div>
        <div className="market-score">
          <span>
            {data.biasPercent > 0 ? "+" : ""}
            {data.biasPercent}
            <small>%</small>
          </span>
          <span className="market-direction">
            <DirectionIcon
              size={13}
              weight="bold"
              className="score-direction-icon"
              aria-hidden="true"
            />
            {direction}
          </span>
        </div>
        <BiasMeter score={data.biasScore} />
        <div className="market-stats">
          <span>
            Conviction
            <strong className={`conviction-${data.conviction}`}>
              <i />
              <i />
              <i />
              {data.conviction}
            </strong>
          </span>
          <span>
            Agreement
            <strong>
              {data.confirmationRatio}
              <small>%</small>
            </strong>
          </span>
        </div>
        <div className="market-history-heading">
          <span>Bias history</span>
          <span>Last 7 snapshots</span>
        </div>
        <BiasHistory data={data} />
        <div className="market-card-meta">
          <span className={`market-session ${open ? "is-open" : ""}`}>
            <i />
            {open ? "Market open" : "Market closed"}
          </span>
          <span>
            {data.eventCount} drivers{" "}
            <ArrowRight size={13} aria-hidden="true" />
          </span>
        </div>
      </button>
      {data.history.length > 0 && (
        <div className="market-history-section">
          <button
            type="button"
            className="history-toggle"
            aria-expanded={historyOpen}
            aria-controls={`history-${data.symbol}`}
            onClick={() => setHistoryOpen(!historyOpen)}
          >
            <span>7-day history</span>
            <CaretDown
              size={13}
              className={historyOpen ? "rotate-180" : ""}
              aria-hidden="true"
            />
          </button>
          {historyOpen && (
            <div className="history-table-wrap" id={`history-${data.symbol}`}>
              <table>
                <caption className="sr-only">
                  Daily bias history for {data.symbol}
                </caption>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Direction</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((entry) => (
                    <tr key={entry.date}>
                      <td>{entry.date.slice(5)}</td>
                      <td>
                        {entry.direction
                          .replace("weakly_", "Leaning ")
                          .replaceAll("_", " ")}
                      </td>
                      <td>
                        {entry.biasScore > 0 ? "+" : ""}
                        {entry.biasScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
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
