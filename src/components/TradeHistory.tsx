'use client';
import { journalFetch } from '@/lib/journal-fetch';
import { tradeDateLabel, tradeDay } from '@/lib/trade-dates';
import { useSetupTags } from '@/lib/use-setup-tags';

import { useCallback, useEffect, useState } from 'react';
import TradeScreenshots from './TradeScreenshots';
import { journalFeatures } from '@/lib/journal-features';
import { Trade, TradeApiResponse, TradeResult, TradesApiResponse } from '@/lib/types';
import { type TradingAccount, tradingAccountLabel } from '@/lib/trading-account-types';
import { formatMoney, isoDateTime, localDateTime, moneyUnits } from '@/lib/account-money';

const RESULT_BADGES: Record<string, { label: string; classes: string }> = {
  win: { label: 'WIN', classes: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/40' },
  loss: { label: 'LOSS', classes: 'bg-red-900/40 text-red-400 border-red-700/40' },
  breakeven: { label: 'BE', classes: 'bg-zinc-800 text-zinc-400 border-zinc-700/40' },
  open: { label: 'OPEN', classes: 'bg-amber-900/40 text-amber-400 border-amber-700/40' },
};

const FIELD_CLS =
  'w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-400 transition-colors';

const LABEL_CLS = 'block text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5';

const RESULT_CLS = (active: boolean, tone: 'emerald' | 'red' | 'zinc'): string =>
  `flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors cursor-pointer ${
    active
      ? tone === 'emerald'
        ? 'bg-emerald-600 border-emerald-500 text-white'
        : tone === 'red'
          ? 'bg-red-600 border-red-500 text-white'
          : 'bg-zinc-600 border-zinc-500 text-white'
      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
  }`;

function resultBadge(trade: Trade) {
  if (trade.result) return RESULT_BADGES[trade.result];
  return RESULT_BADGES.open;
}

function formatPnl(trade: Trade): { text: string; color: string } {
  if (trade.pnlPercent === null) return { text: '—', color: 'text-zinc-600' };
  const sign = trade.pnlPercent > 0 ? '+' : '';
  return {
    text: `${sign}${trade.pnlPercent.toFixed(2)}%`,
    color:
      trade.pnlPercent > 0
        ? 'text-emerald-400'
        : trade.pnlPercent < 0
          ? 'text-red-400'
          : 'text-zinc-500',
  };
}

export default function TradeHistory({ journalAccountId, accounts = [] }: { journalAccountId?: string; accounts?: TradingAccount[] }) {
  const setupTags = useSetupTags();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editExit, setEditExit] = useState('');
  const [editResult, setEditResult] = useState<TradeResult | ''>('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editEntry, setEditEntry] = useState('');
  const [editNet, setEditNet] = useState('');
  const [editClosedAt, setEditClosedAt] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editUnknown, setEditUnknown] = useState(false);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await journalFetch(`/api/journal/trade${journalAccountId ? `?tradingAccount=${encodeURIComponent(journalAccountId)}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: TradesApiResponse = await res.json();
      setTrades(json.trades);
      setLoadError('');
    } catch (err) {
      setTrades([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load trades. Please retry.');
    } finally {
      setLoading(false);
    }
  }, [journalAccountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; all setState occurs after await resolves
    void fetchTrades();
  }, [fetchTrades]);

  const retry = () => {
    setLoading(true);
    setLoadError('');
    void fetchTrades();
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setEditingId(null);
    setConfirmDeleteId(null);
    setActionError('');
  };

  const startEdit = (trade: Trade) => {
    setEditingId(trade.id);
    setEditExit(trade.exitPrice !== null ? String(trade.exitPrice) : '');
    setEditResult(trade.result ?? '');
    setEditNotes(trade.notes);
    setEditTags([...trade.setupTags]);
    setEditEntry(trade.entryPrice === null ? '' : String(trade.entryPrice));
    setEditNet(trade.pnlAmountExact ?? (trade.pnlAmount == null ? '' : String(trade.pnlAmount)));
    setEditUnknown(trade.result !== null && trade.pnlAmount === null);
    setEditClosedAt(trade.closedAt ? localDateTime(new Date(trade.closedAt), true) : trade.result === null ? localDateTime(new Date(), true) : '');
    setEditOpen(false);
    setActionError('');
    setConfirmDeleteId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setActionError('');
  };

  const toggleEditTag = (tag: string) => {
    setEditTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const saveEdit = async (id: string) => {
    const trade = trades.find(trade => trade.id === id);
    if (!trade) return;
    const synced = trade.brokerAccountId !== null;
    const exitFilled = editExit !== '';
    const exitNum = Number(editExit);

    if (exitFilled && (!Number.isFinite(exitNum) || exitNum <= 0)) {
      setActionError('Exit price must be a positive number');
      return;
    }
    if (!editOpen && exitFilled && editResult === '' && !editNet) {
      setActionError('Result is required when exit price is set');
      return;
    }

    setSaving(true);
    setActionError('');
    try {
      if (!synced && !editOpen && !editNet && !editUnknown) throw new Error('Enter net P&L or mark the cash result unknown.');
      const net = editOpen || editUnknown ? null : editNet;
      const outcome = net !== null && net !== '' ? moneyUnits(net) > 0n ? 'win' : moneyUnits(net) < 0n ? 'loss' : 'breakeven' : editResult || null;
      const closingTime = trade.closedAt && editClosedAt === localDateTime(new Date(trade.closedAt), true) ? trade.closedAt : editOpen || synced || (trade.importBatchId && !editClosedAt) ? null : isoDateTime(editClosedAt);
      const body = {
        ...(!synced ? { entryPrice: editEntry === '' && trade.importBatchId ? null : Number(editEntry), exitPrice: editOpen ? null : exitFilled ? exitNum : null, result: editOpen ? null : outcome, netPnl: net, closedAt: editOpen ? null : closingTime } : {}),
        expectedRevision: trade.revision ?? 1,
        notes: editNotes,
        setupTags: editTags,
      };
      const res = await journalFetch(`/api/journal/trade/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'Failed to update trade');
      }
      const json: TradeApiResponse = await res.json();
      setTrades((prev) => prev.map((t) => (t.id === id ? json.trade : t)));
      setEditingId(null);
      window.dispatchEvent(new Event('macroflow:journal-updated'));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update trade');
    } finally {
      setSaving(false);
    }
  };

  const deleteTrade = async (id: string) => {
    setSaving(true);
    setActionError('');
    try {
      const res = await journalFetch(`/api/journal/trade/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'Failed to delete trade');
      }
      setTrades((prev) => prev.filter((t) => t.id !== id));
      setExpandedId(null);
      setConfirmDeleteId(null);
      window.dispatchEvent(new Event('macroflow:journal-updated'));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete trade');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-3.5 border-b border-zinc-800/50 last:border-0 animate-pulse"
          >
            <div className="flex items-center gap-3">
              <div className="h-4 w-14 bg-zinc-800 rounded" />
              <div className="h-4 w-16 bg-zinc-800 rounded" />
            </div>
            <div className="h-4 w-20 bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-800/30 bg-red-950/20 p-6 text-center">
        <p role="alert" className="text-red-400 text-sm">{loadError}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  if (trades.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
        <p className="text-sm text-zinc-400">No trades logged yet</p>
        <p className="text-xs text-zinc-600 mt-1">
          Switch to the Log Trade tab to record your first trade.
        </p>
      </div>
    );
  }

  const decisions = new Set(trades.map(trade => trade.tradeGroupId || trade.id)).size;
  return (
    <div className="trade-history-container rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <p className="trade-history-count">{trades.length} account trade{trades.length === 1 ? '' : 's'} · {decisions} trading decision{decisions === 1 ? '' : 's'} <span>Shared entries count once per decision.</span></p>
      <div className="trade-history-columns px-4 py-2 border-b border-zinc-800 bg-zinc-900/70">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 w-16">
          Symbol
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 w-16">
          Side
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 w-20">
          Entry
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 w-16">
          Result
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 w-16 text-right">
          P&amp;L
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600 ml-auto">
          Date
        </span>
        <span className="w-4" />
      </div>

      {trades.map((trade) => {
        const badge = resultBadge(trade);
        const pnl = formatPnl(trade);
        const expanded = expandedId === trade.id;
        const editing = editingId === trade.id;
        const account = accounts.find(account => account.id === trade.journalAccountId);
        const synced = trade.brokerAccountId !== null;

        return (
          <div key={trade.id} className="trade-record border-b border-zinc-800/50 last:border-0">
            {!journalAccountId && <p className="trade-record-account">{account ? tradingAccountLabel(account) : 'My journal'}</p>}
            <button
              type="button"
              onClick={() => toggleExpand(trade.id)}
              aria-expanded={expanded}
              aria-controls={`trade-details-${trade.id}`}
              className="trade-history-row w-full px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors cursor-pointer"
            >
              <span className="trade-history-symbol"><strong>{trade.symbol}</strong>{trade.tradeGroupId && <small className="trade-shared-label">Shared entry</small>}</span>
              <span
                className={`text-[10px] font-semibold uppercase w-16 ${
                  trade.direction === 'long' ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {trade.direction === 'long' ? '▲ Long' : '▼ Short'}
              </span>
              <span className="text-xs font-mono tabular-nums text-zinc-400 w-20">
                {trade.entryPrice ?? '—'}
              </span>
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded border leading-none w-16 text-center ${badge.classes}`}
                title={trade.result === 'breakeven' ? 'Breakeven' : undefined}
              >
                {badge.label}
              </span>
              <span className={`text-xs font-mono tabular-nums w-16 text-right ${pnl.color}`}>
                {pnl.text}
              </span>
              <span className="text-[10px] text-zinc-600 ml-auto shrink-0">
                {trade.importInfo?.datePrecision === 'date' ? tradeDay(trade, false) : new Date(trade.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <svg
                className={`w-3.5 h-3.5 text-zinc-600 transition-transform duration-200 shrink-0 ${
                  expanded ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>

            {expanded && (
              <div id={`trade-details-${trade.id}`} className="px-4 pb-4 pt-1 bg-zinc-900/40">
                {!editing ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                          {trade.importInfo?.dateMeaning === 'close' ? 'Closing date' : 'Logged'}
                        </p>
                        <p className="text-xs text-zinc-200 font-mono">
                          {tradeDateLabel(trade)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                          Entry
                        </p>
                        <p className="text-xs text-zinc-200 font-mono tabular-nums">
                          {trade.entryPrice ?? '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                          Exit
                        </p>
                        <p className="text-xs text-zinc-200 font-mono tabular-nums">
                          {trade.exitPrice !== null ? trade.exitPrice : '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">
                          Price return
                        </p>
                        <p className={`text-xs font-mono tabular-nums ${pnl.color}`}>
                          {pnl.text}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">
                        Setup Tags
                      </p>
                      {trade.setupTags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {trade.setupTags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-600">No tags</p>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">
                        Notes
                      </p>
                      <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {trade.notes || <span className="text-zinc-600">No notes</span>}
                      </p>
                    </div>

                    <p className="trade-cash-result">Net cash P&amp;L: <strong>{trade.pnlAmountExact != null && account?.currency ? formatMoney(trade.pnlAmountExact, account.currency) : 'Unknown'}</strong>{trade.closedAt && <span> · Closed {tradeDateLabel(trade, true)}</span>}</p>
                    {trade.tradeGroupId && <p className="capture-help">This record belongs to a shared entry. Changes here affect this account only.</p>}
                    {trade.importInfo && <p className="capture-help">Imported from CSV · Original {trade.importInfo.dateMeaning === 'close' ? 'closing' : 'entry'} date: {trade.importInfo.sourceDate} ({trade.importInfo.timezone}).{trade.importInfo.datePrecision === 'date' ? ' Time unknown.' : ''}{trade.importInfo.dateMeaning === 'close' ? ' Entry date unknown.' : ''}</p>}
                    {journalFeatures.screenshots && <TradeScreenshots tradeId={trade.id} />}
                    {actionError && <p className="text-xs text-red-400">{actionError}</p>}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => startEdit(trade)}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors cursor-pointer"
                      >
                        {trade.result === null ? 'Close Trade' : 'Edit'}
                      </button>
                      {confirmDeleteId === trade.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Delete this trade?</span>
                          <button
                            type="button"
                            onClick={() => void deleteTrade(trade.id)}
                            disabled={saving}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {saving ? 'Deleting...' : 'Yes, delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(trade.id)}
                          className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {!synced ? <>
                      <label className="capture-checkbox"><input type="checkbox" checked={editOpen} onChange={event => setEditOpen(event.target.checked)} />Keep this trade open / reopen it</label>
                      <div className="capture-grid">
                        <label className="capture-field">Entry price<input type="number" step="any" value={editEntry} onChange={event => setEditEntry(event.target.value)} /></label>
                        {!editOpen && <><label className="capture-field">Closing date &amp; time<input type="datetime-local" step="1" required value={editClosedAt} onChange={event => setEditClosedAt(event.target.value)} /></label><label className="capture-field">Net P&amp;L · {account?.currency || 'currency unset'}<input type="text" inputMode="decimal" value={editNet} disabled={editUnknown} onChange={event => setEditNet(event.target.value)} placeholder="After trading fees" /></label><label className="capture-checkbox"><input type="checkbox" checked={editUnknown} onChange={event => setEditUnknown(event.target.checked)} />Cash P&amp;L is unknown</label></>}
                      </div>
                    </> : <p className="funds-notice">Execution details are managed by MT5 sync. You can update your notes and tags.</p>}
                    {!synced && !editOpen && <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor={`edit-exit-${trade.id}`} className={LABEL_CLS}>
                          Exit Price
                        </label>
                        <input
                          id={`edit-exit-${trade.id}`}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          placeholder="0.00"
                          value={editExit}
                          onChange={(e) => setEditExit(e.target.value)}
                          className={FIELD_CLS}
                        />
                      </div>
                      <div>
                        {editUnknown ? <>
                        <span className={LABEL_CLS}>Result</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setEditResult('win')}
                            className={RESULT_CLS(editResult === 'win', 'emerald')}
                          >
                            Win
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditResult('loss')}
                            className={RESULT_CLS(editResult === 'loss', 'red')}
                          >
                            Loss
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditResult('breakeven')}
                            className={RESULT_CLS(editResult === 'breakeven', 'zinc')}
                          >
                            BE
                          </button>
                        </div>
                        </> : <p className="capture-help">The result follows the sign of net cash P&amp;L. Mark cash P&amp;L unknown to choose an outcome manually.</p>}
                      </div>
                    </div>

                    </>}
                    <div>
                      <span className={LABEL_CLS}>Setup Tags</span>
                      <div className="flex flex-wrap gap-2">
                        {[...new Set([...setupTags, ...editTags])].map((tag) => {
                          const active = editTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => toggleEditTag(tag)}
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                                active
                                  ? 'bg-zinc-100 border-zinc-100 text-zinc-950'
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                              }`}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label htmlFor={`edit-notes-${trade.id}`} className={LABEL_CLS}>
                        Notes
                      </label>
                      <textarea
                        id={`edit-notes-${trade.id}`}
                        rows={3}
                        placeholder="Setup context, mistakes, lessons..."
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        className={FIELD_CLS + ' resize-y'}
                      />
                    </div>

                    {actionError && <p className="text-xs text-red-400">{actionError}</p>}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit(trade.id)}
                        disabled={saving}
                        className="rounded-full bg-zinc-100 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-zinc-300 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={saving}
                        className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
