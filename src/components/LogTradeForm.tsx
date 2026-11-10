'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { journalFetch } from '@/lib/journal-fetch';
import { useSetupTags } from '@/lib/use-setup-tags';
import { TRADE_SYMBOLS, type TradeDirection, type TradeResult } from '@/lib/types';
import { type TradingAccount } from '@/lib/trading-account-types';
import { tradeBatchSchema } from '@/lib/journal-batch-types';
import { moneyUnits, normalizeMoney } from '@/lib/account-money';

interface Props {
  selectedAccountIds: string[];
  accounts?: TradingAccount[];
  onSavingChange: (saving: boolean) => void;
}

export default function LogTradeForm({ selectedAccountIds, accounts = [], onSavingChange }: Props) {
  const id = useId();
  const setupTags = useSetupTags();
  const [loggedAt, setLoggedAt] = useState(() => new Date());
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<TradeDirection | ''>('');
  const [entry, setEntry] = useState('');
  const [exit, setExit] = useState('');
  const [result, setResult] = useState<TradeResult | ''>('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const submitting = useRef(false);
  const destinations = accounts.filter(account => selectedAccountIds.includes(account.id) && account.brokerAccountId === null);
  const currencies = [...new Set(destinations.map(account => account.currency).filter((currency): currency is string => !!currency))];
  const cashAmounts: Record<string, string | null> = Object.fromEntries(currencies.map(currency => {
    try {
      const amount = (amounts[currency] ?? '').trim();
      return [currency, moneyUnits(amount, currency) > 0n ? normalizeMoney(amount, currency) : null];
    } catch { return [currency, null]; }
  }));
  const missingCurrency = destinations.some(account => !account.currency);
  const cashValid = result === '' || (!missingCurrency && (result === 'breakeven' || currencies.every(currency => cashAmounts[currency] !== null)));
  const entryNumber = Number(entry);
  const exitNumber = Number(exit);
  const entryValid = entry !== '' && Number.isFinite(entryNumber) && entryNumber > 0 && entryNumber <= 1e12;
  const exitValid = exit === '' || (Number.isFinite(exitNumber) && exitNumber > 0 && exitNumber <= 1e12);
  const exitRequiresResult = exit !== '' && result === '';
  const canSubmit = destinations.length > 0 && symbol !== '' && direction !== '' && entryValid && exitValid && !exitRequiresResult && cashValid && !saving;
  const pnl = entryValid && exitValid && exit !== '' && direction !== ''
    ? Math.round(((exitNumber - entryNumber) / entryNumber) * 100 * (direction === 'short' ? -1 : 1) * 100) / 100
    : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !canSubmit) return;
    setError(''); setSuccess('');
    try {
      // Keep capture time stable across retries. Apply the result's sign to
      // exact decimal strings; price return stays separate from cash P&L.
      const capturedAt = loggedAt.toISOString();
      const payload = {
        symbol, direction, entryPrice: entryNumber, openedAt: capturedAt, setupTags: tags, notes,
        accounts: destinations.map(account => ({
          accountId: account.id, exitPrice: exit === '' ? null : exitNumber,
          result: result || null, closedAt: result ? capturedAt : null,
          netPnl: result === 'breakeven' ? '0' : result && account.currency ? `${result === 'loss' ? '-' : ''}${cashAmounts[account.currency]}` : null,
        })),
      };
      const signature = JSON.stringify(payload);
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
      const body = { ...payload, requestId: pending.current.requestId };
      const validation = tradeBatchSchema.safeParse(body);
      if (!validation.success) throw new Error(validation.error.issues[0].message);
      submitting.current = true; setSaving(true); onSavingChange(true);
      const response = await journalFetch('/api/journal/trade-batches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error ?? 'Trade could not be saved. Retry with the same details.');
      setSuccess(`Saved to ${destinations.map(account => account.nickname || account.accountNumber || 'My journal').join(' and ')}.`);
      setSymbol(''); setDirection(''); setEntry(''); setExit(''); setResult(''); setAmounts({}); setTags([]); setNotes(''); setLoggedAt(new Date());
      pending.current = null;
      window.dispatchEvent(new Event('macroflow:journal-updated'));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Save status could not be confirmed. Retry with the same details.');
    } finally {
      submitting.current = false; setSaving(false); onSavingChange(false);
    }
  }

  return <form className="trade-capture trade-capture-classic" onSubmit={submit}>
    <fieldset disabled={saving} className="trade-capture-fields">
      <div className="capture-logged-at"><span>Logged At</span><time dateTime={loggedAt.toISOString()} suppressHydrationWarning>{loggedAt.toLocaleString()}</time></div>
      <div className="capture-grid">
        <label className="capture-field" htmlFor={`${id}-symbol`}>Symbol
          <select id={`${id}-symbol`} aria-label="Symbol" required value={symbol} onChange={event => setSymbol(event.target.value)}>
            <option value="">Select symbol</option>{TRADE_SYMBOLS.map(symbol => <option key={symbol}>{symbol}</option>)}
          </select>
        </label>
        <fieldset className="capture-direction"><legend>Direction</legend><div className="capture-segmented">
          {(['long', 'short'] as const).map(value => <button key={value} type="button" aria-pressed={direction === value} className={direction === value ? `is-${value}` : ''} onClick={() => setDirection(value)}>{value === 'long' ? 'Long' : 'Short'}</button>)}
        </div></fieldset>
      </div>
      <div className="capture-grid capture-price-grid">
        <label className="capture-field" htmlFor={`${id}-entry`}>Entry Price
          <input id={`${id}-entry`} aria-label="Entry price" required type="number" step="any" min="0.00000001" max="1000000000000" inputMode="decimal" value={entry} onChange={event => setEntry(event.target.value)} placeholder="0.00" />
        </label>
        <label className="capture-field" htmlFor={`${id}-exit`}><span>Exit Price <span className="capture-optional">(optional)</span></span>
          <input id={`${id}-exit`} aria-label="Exit Price (optional)" type="number" step="any" min="0.00000001" max="1000000000000" inputMode="decimal" value={exit} onChange={event => setExit(event.target.value)} placeholder="0.00" />
        </label>
        <div className="capture-field">
          <span id={`${id}-pnl-label`}>P&amp;L (preview)</span>
          <output className={`capture-pnl-preview${pnl !== null && pnl > 0 ? ' is-positive' : pnl !== null && pnl < 0 ? ' is-negative' : ''}`} aria-labelledby={`${id}-pnl-label`} title="Price change percentage; not cash profit or loss.">{pnl === null ? '—' : `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%`}</output>
        </div>
      </div>
      <fieldset className="capture-result">
        <legend>Result{exitRequiresResult && <span className="capture-result-hint"> — required when exit price is filled</span>}</legend>
        <div className="capture-segmented">
          {(['win', 'loss', 'breakeven'] as const).map(value => <button key={value} type="button" aria-pressed={result === value} className={result === value ? `is-${value}` : ''} onClick={() => setResult(current => current === value ? '' : value)}>{value === 'win' ? 'Win' : value === 'loss' ? 'Loss' : 'Breakeven'}</button>)}
        </div>
      </fieldset>
      {result && <div className="capture-cash-result">
        {result !== 'breakeven' && currencies.map(currency => <label className="capture-field" key={currency} htmlFor={`${id}-amount-${currency}`}>
          Amount ({currency})
          <input id={`${id}-amount-${currency}`} aria-label={`Amount (${currency})`} aria-describedby={`${id}-amount-help`} type="text" inputMode="decimal" required value={amounts[currency] ?? ''} onChange={event => setAmounts(current => ({ ...current, [currency]: event.target.value }))} placeholder="0.00" />
        </label>)}
        <p className="capture-help" id={`${id}-amount-help`}>{result === 'breakeven' ? 'Breakeven records zero. Your balance stays the same.' : `Enter a positive amount. ${result === 'win' ? 'Win adds it to' : 'Loss deducts it from'} ${destinations.length > 1 ? 'each selected account’s balance' : 'your account balance'}.${currencies.length > 1 ? ' Enter each amount in the currency shown.' : ''}`}</p>
        {missingCurrency && <p className="capture-error" role="alert">Set the account currency in Account details before recording a cash result.</p>}
      </div>}
      <fieldset className="capture-tags"><legend>Setup Tags</legend><div>
        {setupTags.map(tag => <button key={tag} type="button" aria-pressed={tags.includes(tag)} onClick={() => setTags(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag])}>{tag}</button>)}
      </div></fieldset>
      <label className="capture-field" htmlFor={`${id}-notes`}>Notes
        <textarea id={`${id}-notes`} aria-label="Notes" rows={3} maxLength={10_000} placeholder="Setup context, mistakes, lessons..." value={notes} onChange={event => setNotes(event.target.value)} />
      </label>
    </fieldset>
    {error && <p className="capture-error" role="alert">{error}</p>}
    <div className="capture-submit">
      <button className="account-primary-button" type="submit" disabled={!canSubmit}>{saving ? 'Saving…' : 'Log Trade'}</button>
      {success && <p className="capture-success" role="status">{success}</p>}
      {!destinations.length && <span>Choose a trading account above to save.</span>}
    </div>
  </form>;
}
