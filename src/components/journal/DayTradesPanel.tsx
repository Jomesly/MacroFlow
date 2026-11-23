'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowSquareOut, CaretLeft, CaretRight, X } from '@phosphor-icons/react';
import { journalFetch } from '@/lib/journal-fetch';
import type { CalendarDay } from '@/lib/analytics';
import type { DayScreenshot, DayTrade, DayTradesResponse } from '@/lib/day-trades';
import type { MoneyUnit } from '@/lib/money-format';
import { tradePnlLabel } from '@/lib/trade-pnl';
import { fmtMoney, fmtPct, toneOf } from './AnalyticsCharts';

type Props = {
  day: CalendarDay;
  /** The analytics view's filters, so the day lists what its cell counted. */
  filters: string;
  unit: MoneyUnit;
  onClose: () => void;
};
type Shot = DayScreenshot & { trade: DayTrade; index: number; of: number };

const RESULT_LABEL = { win: 'Win', loss: 'Loss', breakeven: 'BE' } as const;

/** Opens "Edit" for a trade in History, where screenshots are pasted and removed. */
export function openTradeInHistory(tradeId: string) {
  window.dispatchEvent(new CustomEvent('journal-open-history', { detail: { tradeId } }));
}

function longDay(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function timeOf(trade: DayTrade) {
  const label = trade.closedAt ? 'Closed' : 'Logged';
  const precision = trade.closedAt ? trade.importInfo?.closedPrecision : trade.importInfo?.datePrecision;
  if (precision === 'date') return `${label} · time unknown`;
  return `${label} ${new Date(trade.closedAt ?? trade.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function pnlOf(trade: DayTrade, unit: MoneyUnit): { text: string; tone: string } {
  if (trade.pnlAmount !== null) return { text: fmtMoney(trade.pnlAmount, unit), tone: toneOf(trade.pnlAmount) };
  const label = tradePnlLabel(trade);
  return { text: label.text, tone: label.tone === 'none' ? 'flat' : label.tone };
}

export default function DayTradesPanel({ day, filters, unit, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [data, setData] = useState<DayTradesResponse | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
      // React removes the dialog before the browser can restore focus; do it here.
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(filters);
    query.set('date', day.date);
    journalFetch(`/api/journal/day?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? 'This day could not be loaded.');
        setData(body as DayTradesResponse);
        setError('');
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'This day could not be loaded.');
      });
    return () => controller.abort();
  }, [day.date, filters, attempt]);

  const shots = useMemo<Shot[]>(() => (data?.trades ?? []).flatMap((trade) =>
    trade.screenshots.map((shot, index) => ({ ...shot, trade, index, of: trade.screenshots.length }))), [data]);

  const close = useCallback(() => { if (viewing === null) onClose(); }, [onClose, viewing]);
  const retry = () => { setData(null); setError(''); setAttempt((n) => n + 1); };
  const edit = (tradeId: string) => { onClose(); openTradeInHistory(tradeId); };

  const counted = `${day.trades} ${day.trades === 1 ? 'trade' : 'trades'}`;
  const record = `${day.wins}W · ${day.losses}L${day.breakeven ? ` · ${day.breakeven}BE` : ''}`;
  let shotNumber = 0;

  return (
    <dialog
      ref={dialog}
      className="jd-day-drawer"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === dialog.current) close(); }}
    >
      <header className="jd-day-head">
        <div>
          <p className="jd-day-kicker">Trading day</p>
          <h2 id={titleId}>{longDay(day.date)}</h2>
          <p className="jd-day-summary">
            {day.net !== null && <b className={`is-${toneOf(day.net)}`}>{fmtMoney(day.net, unit)}</b>}
            <span>{counted}</span>
            <span>{record}</span>
            {day.winRate !== null && <span>{fmtPct(day.winRate)} win rate</span>}
          </p>
        </div>
        <button type="button" className="jd-day-close" aria-label="Close day" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="jd-day-body">
        {error ? (
          <div role="alert" className="jd-day-state">
            <p>{error}</p>
            <button type="button" className="jd-day-link" onClick={retry}>Try again</button>
          </div>
        ) : !data ? (
          <div className="jd-day-skeleton" role="status" aria-label="Loading trades">
            {Array.from({ length: Math.min(3, Math.max(1, day.trades)) }, (_, i) => <span key={i} />)}
          </div>
        ) : data.trades.length === 0 ? (
          <p className="jd-day-state">No closed trades on this day for the current filters.</p>
        ) : (
          <>
            {data.screenshots === 'unavailable' && <p role="status" className="jd-day-notice">Screenshots could not be loaded right now. Trades are shown without images.</p>}
            <ol className="jd-day-list">
              {data.trades.map((trade) => {
                const pnl = pnlOf(trade, unit);
                return (
                  <li key={trade.id} className="jd-day-trade">
                    <div className="jd-day-trade-top">
                      <strong>{trade.symbol}</strong>
                      <span className={`jd-day-side is-${trade.direction === 'long' ? 'positive' : 'negative'}`}>{trade.direction === 'long' ? 'Long' : 'Short'}</span>
                      {trade.result && <span className={`jd-day-result is-${trade.result === 'win' ? 'positive' : trade.result === 'loss' ? 'negative' : 'flat'}`}>{RESULT_LABEL[trade.result]}</span>}
                      <span className={`jd-day-pnl is-${pnl.tone}`}>{pnl.text}</span>
                    </div>
                    <p className="jd-day-meta">
                      <span>{timeOf(trade)}</span>
                      {trade.rMultiple !== null && <span>{trade.rMultiple > 0 ? '+' : ''}{trade.rMultiple.toFixed(2)}R</span>}
                    </p>
                    {trade.setupTags.length > 0 && <ul className="jd-day-tags" aria-label="Setup tags">{trade.setupTags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
                    {trade.notes && <p className="jd-day-notes">{trade.notes}</p>}
                    {data.screenshots !== 'disabled' && (
                      trade.screenshots.length > 0 ? (
                        <div className="jd-day-shots">
                          {trade.screenshots.map((shot, index) => {
                            const position = shotNumber++;
                            return (
                              <button key={shot.id} type="button" className="jd-day-thumb" onClick={() => setViewing(position)} aria-label={`View ${trade.symbol} screenshot ${index + 1} of ${trade.screenshots.length}`}>
                                {broken.has(shot.id)
                                  ? <span className="jd-day-thumb-error">Image unavailable</span>
                                  // eslint-disable-next-line @next/next/no-img-element -- private image served by the authenticated route
                                  : <img src={shot.url} alt="" width={shot.width} height={shot.height} loading="lazy" decoding="async" onError={() => setBroken((set) => new Set(set).add(shot.id))} />}
                              </button>
                            );
                          })}
                        </div>
                      ) : data.screenshots === 'ready' && <p className="jd-day-empty-shots">No screenshots</p>
                    )}
                    <button type="button" className="jd-day-link" onClick={() => edit(trade.id)}>
                      {data.screenshots === 'disabled' ? 'Edit in History' : trade.screenshots.length ? 'Edit trade & screenshots' : 'Add screenshots in History'}
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      {viewing !== null && shots[viewing] && (
        <ScreenshotLightbox shots={shots} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </dialog>
  );
}

function ScreenshotLightbox({ shots, index, onIndex, onClose }: {
  shots: Shot[]; index: number; onIndex: (index: number) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const shot = shots[index];
  const many = shots.length > 1;
  const step = useCallback((by: number) => onIndex((index + by + shots.length) % shots.length), [index, onIndex, shots.length]);

  useEffect(() => {
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="jd-lightbox"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
      onKeyDown={(event) => {
        if (!many) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      }}
    >
      <header className="jd-lightbox-bar">
        <p id={titleId}>
          <strong>{shot.trade.symbol}</strong> {shot.trade.direction === 'long' ? 'Long' : 'Short'} · screenshot {shot.index + 1} of {shot.of}
          {many && <span className="jd-lightbox-count"> · {index + 1} / {shots.length} today</span>}
        </p>
        <a href={shot.url} target="_blank" rel="noopener noreferrer" className="jd-lightbox-action">
          <ArrowSquareOut size={16} aria-hidden="true" /><span>Open original</span>
        </a>
        <button type="button" className="jd-lightbox-action" aria-label="Close screenshot" onClick={onClose} autoFocus>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <figure className="jd-lightbox-stage">
        {/* eslint-disable-next-line @next/next/no-img-element -- private image served by the authenticated route */}
        <img key={shot.id} src={shot.url} alt={`${shot.trade.symbol} trade screenshot ${shot.index + 1} of ${shot.of}`} width={shot.width} height={shot.height} />
      </figure>
      {many && (
        <>
          <button type="button" className="jd-lightbox-nav is-prev" aria-label="Previous screenshot" onClick={() => step(-1)}><CaretLeft size={22} aria-hidden="true" /></button>
          <button type="button" className="jd-lightbox-nav is-next" aria-label="Next screenshot" onClick={() => step(1)}><CaretRight size={22} aria-hidden="true" /></button>
        </>
      )}
    </dialog>
  );
}
