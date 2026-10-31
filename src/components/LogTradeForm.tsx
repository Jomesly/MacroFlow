'use client';
import { journalFetch } from '@/lib/journal-fetch';

import { useEffect, useState } from 'react';
import { SETUP_TAGS, TradeDirection, TradeResult, TradeSymbol, TRADE_SYMBOLS } from '@/lib/types';

const LABEL_CLS = 'block text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1.5';

const FIELD_CLS =
  'w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors';

const DIRECTION_CLS = (active: boolean, tone: 'emerald' | 'red'): string =>
  `flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors cursor-pointer ${
    active
      ? tone === 'emerald'
        ? 'bg-emerald-600 border-emerald-500 text-white'
        : 'bg-red-600 border-red-500 text-white'
      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
  }`;

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

function previewPnl(entry: number, exit: number, direction: TradeDirection): number {
  const pct = ((exit - entry) / entry) * 100;
  return Math.round((direction === 'short' ? -pct : pct) * 100) / 100;
}

export default function LogTradeForm() {
  const [loggedAt, setLoggedAt] = useState(() => new Date());
  const [symbol, setSymbol] = useState<TradeSymbol | ''>('');
  const [direction, setDirection] = useState<TradeDirection | ''>('');
  const [tags, setTags] = useState<string[]>([]);
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [result, setResult] = useState<TradeResult | ''>('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (status !== 'success') return;
    const id = setTimeout(() => setStatus('idle'), 4000);
    return () => clearTimeout(id);
  }, [status]);

  const entryNum = Number(entryPrice);
  const exitNum = Number(exitPrice);
  const entryValid = entryPrice !== '' && Number.isFinite(entryNum) && entryNum > 0;
  const exitFilled = exitPrice !== '';
  const exitValid = !exitFilled || (Number.isFinite(exitNum) && exitNum > 0);
  const exitRequiresResult = exitFilled && result === '';

  const canSubmit =
    symbol !== '' &&
    direction !== '' &&
    entryValid &&
    exitValid &&
    !exitRequiresResult &&
    status !== 'saving';

  const pnlPreview =
    entryValid && exitValid && exitFilled && direction !== ''
      ? previewPnl(entryNum, exitNum, direction)
      : null;

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const resetForm = () => {
    setSymbol('');
    setDirection('');
    setTags([]);
    setEntryPrice('');
    setExitPrice('');
    setResult('');
    setNotes('');
    setLoggedAt(new Date());
  };

  const submit = async () => {
    if (!canSubmit) return;

    setStatus('saving');
    setErrorMsg('');

    try {
      const body: Record<string, unknown> = {
        symbol,
        direction,
        entryPrice: entryNum,
        setupTags: tags,
        notes,
      };
      if (exitFilled) body.exitPrice = exitNum;
      if (result !== '') body.result = result;

      const res = await journalFetch('/api/journal/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? 'Failed to save trade');
      }

      resetForm();
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save trade');
      setStatus('error');
    }
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 mb-5">
        <span className={LABEL_CLS + ' mb-0'}>Logged At</span>
        <span className="text-xs text-zinc-300 font-mono tabular-nums">
          {loggedAt.toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label htmlFor="journal-symbol" className={LABEL_CLS}>
            Symbol
          </label>
          <select
            id="journal-symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value as TradeSymbol | '')}
            className={FIELD_CLS}
          >
            <option value="">Select symbol</option>
            {TRADE_SYMBOLS.map((s) => (
              <option key={s} value={s} className="bg-zinc-900">
                {s}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className={LABEL_CLS}>Direction</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDirection('long')}
              className={DIRECTION_CLS(direction === 'long', 'emerald')}
            >
              Long
            </button>
            <button
              type="button"
              onClick={() => setDirection('short')}
              className={DIRECTION_CLS(direction === 'short', 'red')}
            >
              Short
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <label htmlFor="journal-entry" className={LABEL_CLS}>
            Entry Price
          </label>
          <input
            id="journal-entry"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="0.00"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            className={FIELD_CLS}
          />
        </div>

        <div>
          <label htmlFor="journal-exit" className={LABEL_CLS}>
            Exit Price <span className="text-zinc-600 normal-case tracking-normal">(optional)</span>
          </label>
          <input
            id="journal-exit"
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="0.00"
            value={exitPrice}
            onChange={(e) => setExitPrice(e.target.value)}
            className={FIELD_CLS}
          />
        </div>

        <div>
          <span className={LABEL_CLS}>P&amp;L (preview)</span>
          <div
            className={`w-full bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-mono tabular-nums flex items-center ${
              pnlPreview === null
                ? 'text-zinc-600'
                : pnlPreview > 0
                  ? 'text-emerald-400'
                  : pnlPreview < 0
                    ? 'text-red-400'
                    : 'text-zinc-500'
            }`}
          >
            {pnlPreview === null
              ? '—'
              : `${pnlPreview > 0 ? '+' : ''}${pnlPreview.toFixed(2)}%`}
          </div>
        </div>
      </div>

      <div className="mb-4">
        <span className={LABEL_CLS}>
          Result
          {exitRequiresResult && (
            <span className="ml-2 text-amber-400 normal-case tracking-normal">
              — required when exit price is filled
            </span>
          )}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setResult('win')}
            className={RESULT_CLS(result === 'win', 'emerald')}
          >
            Win
          </button>
          <button
            type="button"
            onClick={() => setResult('loss')}
            className={RESULT_CLS(result === 'loss', 'red')}
          >
            Loss
          </button>
          <button
            type="button"
            onClick={() => setResult('breakeven')}
            className={RESULT_CLS(result === 'breakeven', 'zinc')}
          >
            Breakeven
          </button>
        </div>
      </div>

      <div className="mb-4">
        <span className={LABEL_CLS}>Setup Tags</span>
        <div className="flex flex-wrap gap-2">
          {SETUP_TAGS.map((tag) => {
            const active = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-5">
        <label htmlFor="journal-notes" className={LABEL_CLS}>
          Notes
        </label>
        <textarea
          id="journal-notes"
          rows={3}
          placeholder="Setup context, mistakes, lessons..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={FIELD_CLS + ' resize-y'}
        />
      </div>

      {errorMsg && (
        <p className="mb-3 text-xs text-red-400">{errorMsg}</p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            canSubmit
              ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
              : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
          }`}
        >
          {status === 'saving' ? 'Saving...' : 'Log Trade'}
        </button>

        {status === 'success' && (
          <span className="rounded-lg border border-emerald-800/30 bg-emerald-950/20 px-4 py-2 text-xs text-emerald-400">
            Trade logged successfully
          </span>
        )}
      </div>
    </div>
  );
}
