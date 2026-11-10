'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { BucketStats, CalendarDay, EquityPoint, TimeCell } from '@/lib/analytics';

type Tone = 'positive' | 'negative' | 'flat';

export function toneOf(n: number | null): Tone {
  return n === null || n === 0 ? 'flat' : n > 0 ? 'positive' : 'negative';
}

export function fmtMoney(n: number | null): string {
  if (n === null) return '—';
  const text = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;
}

/** Whole numbers for tight cells; the exact figure stays in the tooltip. */
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs > 0 && abs < 1) return fmtMoney(n);
  const text = abs >= 10_000 ? `${(abs / 1000).toFixed(0)}k` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`;
}

export function fmtPct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(n % 1 === 0 ? 0 : 1)}%`;
}

function fmtDay(date: string, year = true): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: year ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

/** Counts to the new figure so a changed filter reads as a change. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: reduce ? 0 : 0.7,
      ease: 'easeOut',
      onUpdate: setShown,
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <>{format(shown)}</>;
}

const GAUGE_ARC = 'M 8 56 A 48 48 0 0 1 104 56';

/** Half ring split into shares, read left to right. */
export function Gauge({ segments, label }: { segments: { value: number; tone: Tone }[]; label: string }) {
  const reduce = useReducedMotion();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;
  return (
    <svg className="jd-gauge" viewBox="0 0 112 62" role="img" aria-label={label}>
      <path d={GAUGE_ARC} className="track" />
      {total > 0 &&
        segments.map((segment) => {
          const share = segment.value / total;
          const start = offset;
          offset += share;
          if (share === 0) return null;
          return (
            <motion.path
              key={segment.tone}
              d={GAUGE_ARC}
              className={`seg-${segment.tone}`}
              initial={reduce ? false : { pathLength: 0, pathOffset: start }}
              animate={{ pathLength: share, pathOffset: start }}
              transition={{ duration: reduce ? 0 : 0.7, ease: 'easeOut' }}
            />
          );
        })}
    </svg>
  );
}

export function Sparkline({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return null;
  const values = [0, ...points.map((p) => p.cumulative)];
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * 100).toFixed(2)} ${(34 - ((v - min) / span) * 32).toFixed(2)}`)
    .join(' ');
  return (
    <svg className={`jd-spark is-${toneOf(values[values.length - 1])}`} viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <path d={line} />
    </svg>
  );
}

export function EquityCurve({ points }: { points: EquityPoint[] }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState<number | null>(null);
  // The curve starts from zero, before the first trading day.
  const series = useMemo(() => [{ date: '', net: 0, cumulative: 0 }, ...points], [points]);
  const values = series.map((p) => p.cumulative);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low || 1) * 0.08;
  const min = low - pad;
  const span = high + pad - min;
  const x = (i: number) => (i / (series.length - 1)) * 100;
  const y = (v: number) => 100 - ((v - min) / span) * 100;
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(3)} ${y(p.cumulative).toFixed(3)}`).join(' ');
  const end = series[series.length - 1];
  const tone = toneOf(end.cumulative);
  const point = active === null ? null : series[active];
  const ticks = [...new Set([high, 0, low])];

  return (
    <div className="jd-equity">
      <div className="jd-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ top: `${y(tick)}%` }}>{fmtCompact(tick)}</span>
        ))}
      </div>
      <div
        className={`jd-plot is-${tone}`}
        role="img"
        aria-label={`Cumulative net P&L across ${points.length} trading ${points.length === 1 ? 'day' : 'days'}, from ${fmtDay(points[0].date)} to ${fmtDay(end.date)}, ending at ${fmtMoney(end.cumulative)}.`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          setActive(Math.max(0, Math.min(series.length - 1, Math.round(ratio * (series.length - 1)))));
        }}
        onPointerLeave={() => setActive(null)}
      >
        <motion.div
          key={`${points.length}:${end.date}:${end.cumulative}`}
          className="jd-plot-reveal"
          initial={reduce ? false : { clipPath: 'inset(0 100% 0 0)' }}
          animate={{ clipPath: 'inset(0 0% 0 0)' }}
          transition={{ duration: reduce ? 0 : 0.9, ease: 'easeOut' }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="area" d={`${line} L100 ${y(0)} L0 ${y(0)} Z`} />
            <path className="zero" d={`M0 ${y(0)} H100`} />
            <path className="line" d={line} />
          </svg>
        </motion.div>
        {point && active !== null && (
          <>
            <span className="jd-cross" style={{ left: `${x(active)}%` }} />
            <span className="jd-dot" style={{ left: `${x(active)}%`, top: `${y(point.cumulative)}%` }} />
            <div className={`jd-tip ${x(active) > 55 ? 'flip' : ''}`} style={{ left: `${x(active)}%` }}>
              <strong>{point.date ? fmtDay(point.date) : 'Start'}</strong>
              {point.date && <span>Day <b className={`is-${toneOf(point.net)}`}>{fmtMoney(point.net)}</b></span>}
              <span>Total <b className={`is-${toneOf(point.cumulative)}`}>{fmtMoney(point.cumulative)}</b></span>
            </div>
          </>
        )}
      </div>
      <div className="jd-xaxis" aria-hidden="true">
        <span>{fmtDay(points[0].date)}</span>
        {points.length > 1 && <span>{fmtDay(end.date)}</span>}
      </div>
    </div>
  );
}

const MAX_BARS = 30;

export function DailyBars({ points }: { points: EquityPoint[] }) {
  const reduce = useReducedMotion();
  const days = points.slice(-MAX_BARS);
  const [active, setActive] = useState<number | null>(null);
  const up = Math.max(0, ...days.map((d) => d.net));
  const down = Math.max(0, ...days.map((d) => -d.net));
  const total = up + down || 1;
  const zero = up + down === 0 ? 50 : (up / total) * 100;
  const latest = days[days.length - 1];
  const shown = days[active ?? days.length - 1] ?? latest;
  return (
    <div>
      <p className="jd-readout">
        <span>{fmtDay(shown.date)}</span>
        <b className={`is-${toneOf(shown.net)}`}>{fmtMoney(shown.net)}</b>
      </p>
      <div
        className="jd-bars"
        role="img"
        aria-label={`Net P&L for the last ${days.length} trading ${days.length === 1 ? 'day' : 'days'}. Most recent, ${fmtDay(latest.date)}: ${fmtMoney(latest.net)}.`}
        onPointerLeave={() => setActive(null)}
      >
        <span className="zero" style={{ top: `${zero}%` }} />
        {days.map((day, i) => {
          const size = `${(Math.abs(day.net) / total) * 100}%`;
          return (
            <span
              key={day.date}
              className={`jd-bar is-${toneOf(day.net)} ${active === i ? 'is-active' : ''}`}
              onPointerEnter={() => setActive(i)}
            >
              <motion.i
                style={day.net >= 0 ? { bottom: `${100 - zero}%`, height: size, originY: 1 } : { top: `${zero}%`, height: size, originY: 0 }}
                initial={reduce ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : i * 0.015, ease: 'easeOut' }}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + by, 1)).toISOString().slice(0, 7);
}

/** Colour depth follows the size of the day against the month's largest day. */
function heat(share: number): string {
  return `${Math.round(45 + 55 * Math.min(1, share))}%`;
}

export function MonthCalendar({ days }: { days: CalendarDay[] }) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const latest = days.length ? days[days.length - 1].date.slice(0, 7) : new Date().toISOString().slice(0, 7);
  const [chosen, setChosen] = useState<string | null>(null);
  const month = chosen ?? latest;
  const [year, index] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  const cells: (CalendarDay | number | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length }, (_, i) => byDate.get(`${month}-${String(i + 1).padStart(2, '0')}`) ?? i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const traded = cells.filter((c): c is CalendarDay => c !== null && typeof c === 'object');
  const peak = Math.max(0, ...traded.map((d) => Math.abs(d.net ?? 0)));
  const money = traded.filter((d) => d.net !== null);
  const monthNet = money.length ? money.reduce((sum, d) => sum + (d.net as number), 0) : null;
  const title = new Date(Date.UTC(year, index - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <>
      <div className="jd-panel-head">
        <h3>P&amp;L calendar</h3>
        <div className="jd-cal-nav">
          <button type="button" aria-label="Previous month" onClick={() => setChosen(shiftMonth(month, -1))}>
            <CaretLeft size={14} aria-hidden="true" />
          </button>
          <strong aria-live="polite">{title}</strong>
          <button type="button" aria-label="Next month" onClick={() => setChosen(shiftMonth(month, 1))}>
            <CaretRight size={14} aria-hidden="true" />
          </button>
        </div>
        <span>
          {traded.length === 0
            ? 'No closed trades'
            : <>{monthNet !== null && <><b className={`is-${toneOf(monthNet)}`}>{fmtMoney(monthNet)}</b> · </>}{traded.length} trading {traded.length === 1 ? 'day' : 'days'}</>}
        </span>
      </div>
      <table className="jd-cal">
        <caption className="sr-only">Daily results for {title}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}
            <th scope="col" className="week-col">Week</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => {
            const weekDays = week.filter((c): c is CalendarDay => c !== null && typeof c === 'object');
            const weekMoney = weekDays.filter((d) => d.net !== null);
            const weekNet = weekMoney.length ? weekMoney.reduce((sum, d) => sum + (d.net as number), 0) : null;
            return (
              <tr key={w}>
                {week.map((cell, i) => {
                  if (cell === null) return <td key={i} className="is-outside" />;
                  if (typeof cell === 'number') return <td key={i}><span className="day">{cell}</span></td>;
                  const tone = toneOf(cell.net);
                  return (
                    <td
                      key={i}
                      data-tone={tone}
                      style={{ '--jd-heat': heat(peak ? Math.abs(cell.net ?? 0) / peak : 0) } as React.CSSProperties}
                      title={`${fmtDay(cell.date)}: ${cell.wins}W / ${cell.losses}L / ${cell.breakeven}BE, net ${fmtMoney(cell.net)}`}
                    >
                      <span className="day">{Number(cell.date.slice(8))}</span>
                      <span className="net">{cell.net === null ? `${cell.wins}W ${cell.losses}L` : fmtCompact(cell.net)}</span>
                      <span className="meta">{cell.trades} {cell.trades === 1 ? 'trade' : 'trades'}{cell.winRate !== null && ` · ${fmtPct(cell.winRate)}`}</span>
                    </td>
                  );
                })}
                <td className="week-col">
                  {weekDays.length > 0 && (
                    <>
                      <span className={`net is-${toneOf(weekNet)}`}>{weekNet === null ? '—' : fmtCompact(weekNet)}</span>
                      <span className="meta">{weekDays.length} {weekDays.length === 1 ? 'day' : 'days'}</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

const BLOCKS = ['12–4 AM', '4–8 AM', '8 AM–12 PM', '12–4 PM', '4–8 PM', '8 PM–12 AM'];
const BLOCK_LABELS = ['12a', '4a', '8a', '12p', '4p', '8p'];

export function TimeHeatmap({ cells }: { cells: TimeCell[] }) {
  const lookup = new Map(cells.map((c) => [`${c.weekday}:${c.block}`, c]));
  const weekend = cells.some((c) => c.weekday === 'Sat' || c.weekday === 'Sun');
  const rows = [...WEEKDAYS.slice(1, 6), ...(weekend ? ['Sat', 'Sun'] : [])];
  return (
    <>
      <table className="jd-heat">
        <caption className="sr-only">Win rate by entry weekday and time of day, New York time</caption>
        <thead>
          <tr>
            <td />
            {BLOCK_LABELS.map((label, i) => <th key={label} scope="col" title={`${BLOCKS[i]} ET`}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((weekday) => (
            <tr key={weekday}>
              <th scope="row">{weekday}</th>
              {BLOCKS.map((range, block) => {
                const cell = lookup.get(`${weekday}:${block}`);
                if (!cell) return <td key={block} />;
                const edge = cell.winRate === null ? 0 : (cell.winRate - 50) / 50;
                return (
                  <td
                    key={block}
                    data-tone={toneOf(edge)}
                    style={{ '--jd-heat': heat(Math.abs(edge)) } as React.CSSProperties}
                    title={`${weekday} ${range} ET: ${cell.trades} ${cell.trades === 1 ? 'trade' : 'trades'}, ${cell.wins}W / ${cell.losses}L, net ${fmtMoney(cell.net)}`}
                  >
                    {fmtPct(cell.winRate)}
                    <small>{cell.trades} {cell.trades === 1 ? 'trade' : 'trades'}</small>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="jd-legend" aria-hidden="true">
        Lower win rate
        <i data-tone="negative" style={{ '--jd-heat': '100%' } as React.CSSProperties} />
        <i data-tone="negative" style={{ '--jd-heat': '45%' } as React.CSSProperties} />
        <i data-tone="flat" />
        <i data-tone="positive" style={{ '--jd-heat': '45%' } as React.CSSProperties} />
        <i data-tone="positive" style={{ '--jd-heat': '100%' } as React.CSSProperties} />
        Higher
      </p>
    </>
  );
}

export function Breakdown({ title, data }: { title: string; data: Record<string, BucketStats> }) {
  const reduce = useReducedMotion();
  const rows = Object.entries(data).sort((a, b) => b[1].trades - a[1].trades);
  if (rows.length === 0) return null;
  return (
    <section className="jd-panel">
      <div className="jd-panel-head"><h3>{title}</h3></div>
      <div className="overflow-x-auto">
        <table className="jd-breakdown">
          <caption className="sr-only">Breakdown {title.toLowerCase()}</caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Trades</th>
              <th scope="col">Win rate</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, bucket]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{bucket.trades}</td>
                <td className={bucket.winRate === null ? '' : bucket.winRate >= 50 ? 'is-positive' : 'is-negative'}>
                  <span>{fmtPct(bucket.winRate)}</span>
                  <span className="jd-meter" aria-hidden="true">
                    {bucket.winRate !== null && (
                      <motion.i
                        style={{ width: `${bucket.winRate}%`, originX: 0 }}
                        initial={reduce ? false : { scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ duration: reduce ? 0 : 0.5, ease: 'easeOut' }}
                      />
                    )}
                  </span>
                </td>
                <td className={`is-${toneOf(bucket.net)}`}>{fmtMoney(bucket.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
