'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, ClockCounterClockwise, Wallet, X, PencilSimpleLine, WarningCircle } from '@phosphor-icons/react';
import { journalFetch } from '@/lib/journal-fetch';
import { tradingAccountLabel, type TradingAccount } from '@/lib/trading-account-types';
import { CASH_KINDS, CASH_LABELS, fundsMutationSchema, type AccountFunds, type CashEntry, type CashKind, type FundRevision, type FundsMutation } from '@/lib/account-funds-types';
import { formatMoney, isoDateTime, localDateTime, moneyUnits, unitsMoney, normalizeMoney } from '@/lib/account-money';

function useAccountFunds(accountId: string, active = true) {
  const [data, setData] = useState<AccountFunds | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    try {
      const response = await journalFetch(`/api/journal/trading-accounts/${accountId}/funds`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Funds could not be loaded.');
      if (token === generation.current) { setData(value); setError(''); }
    } catch (error) { if (token === generation.current) setError(error instanceof Error ? error.message : 'Funds could not be loaded.'); }
    finally { if (token === generation.current) setLoading(false); }
  }, [accountId]);
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh updates state only after the account request resolves
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener('macroflow:journal-updated', changed);
    return () => { generation.current += 1; window.removeEventListener('macroflow:journal-updated', changed); };
  }, [refresh, active]);
  return { data, setData, loading, error, refresh };
}

function Coverage({ data }: { data: AccountFunds }) {
  const count = data.summary.missingPnl + data.summary.missingDates;
  return <p className={`funds-coverage${data.summary.complete ? ' is-complete' : ''}`}>
    {!data.summary.complete && <WarningCircle size={15} aria-hidden="true" />}
    <span>{!data.opening ? 'Add an opening snapshot to calculate your balance.' : count ? `${data.summary.missingPnl ? `${data.summary.missingPnl} closed trade(s) missing cash P&L. ` : ''}${data.summary.missingDates ? `${data.summary.missingDates} trade(s) with unknown or ambiguous closing times. ` : ''}Known activity only.` : data.syncedAccount ? 'Manual funds history. Broker cash movements are not synced.' : 'Based on recorded activity. Floating P&L is excluded.'}</span>
  </p>;
}

export function AccountFundsCard({ account, active = true, onManage }: { account: TradingAccount; active?: boolean; onManage: () => void }) {
  const { data, loading, error, refresh } = useAccountFunds(account.id, active);
  return <section className="account-funds-card" aria-label={`Funds for ${account.nickname || account.accountNumber || 'My journal'}`}>
    <div className="funds-card-heading"><span><Wallet size={16} aria-hidden="true" />Account funds</span><span>{account.currency || 'Currency unset'}</span></div>
    <p className="funds-card-identity">{tradingAccountLabel(account)}</p>
    {loading && <p className="funds-card-loading" role="status">Loading balance…</p>}
    {error ? <div className="funds-card-error" role="alert"><p>{error}</p><button type="button" className="text-link" onClick={() => void refresh()}>Retry funds</button></div> : data && <>
      <span className="funds-balance-label">{data.opening ? data.summary.complete ? 'Recorded balance' : 'Known recorded balance' : 'Opening balance'}</span>
      <p className="funds-card-balance">{data.summary.balance !== null && data.currency ? formatMoney(data.summary.balance, data.currency) : 'Not set yet'}</p>
      <Coverage data={data} />
      {data.opening && data.currency && <dl className="funds-card-breakdown"><div><dt>Net funding</dt><dd>{formatMoney(data.summary.netFunding, data.currency)}</dd></div><div><dt>Net trading P&amp;L</dt><dd>{formatMoney(data.summary.netPnl, data.currency)}</dd></div></dl>}
    </>}
    <button type="button" className="account-secondary-button funds-manage-button" onClick={onManage}>{data?.opening ? 'Manage funds' : 'Set opening balance'}<ArrowUpRight size={16} aria-hidden="true" /></button>
  </section>;
}

function RevisionHistory({ revisions, currency }: { revisions: FundRevision[]; currency: string }) {
  if (!revisions.length) return null;
  return <details className="funds-revisions"><summary><ClockCounterClockwise size={14} aria-hidden="true" />Change history · {revisions.length}</summary><ol>{revisions.map(revision => <li key={revision.id}><div><strong>{revision.operation === 'set-opening' ? revision.before ? 'Opening corrected' : 'Opening set' : revision.operation === 'add' ? 'Recorded' : revision.operation === 'edit' ? 'Corrected' : 'Voided'}</strong><time>{new Date(revision.createdAt).toLocaleString()}</time></div>{revision.before?.amount !== undefined && <p>Before: {formatMoney(revision.before.amount, currency)} · {revision.before.kind ? CASH_LABELS[revision.before.kind as CashKind] : 'Opening balance'} · {revision.before.effectiveAt && new Date(revision.before.effectiveAt).toLocaleString()}</p>}<p>After: {revision.operation === 'void' ? 'Voided' : revision.after.amount !== undefined ? formatMoney(revision.after.amount, currency) : 'Updated'} · {revision.after.effectiveAt && new Date(revision.after.effectiveAt).toLocaleString()}</p>{revision.reason && <p>{revision.reason}</p>}{revision.before?.note && <p>Previous note: {revision.before.note}</p>}{revision.after.note && revision.after.note !== revision.reason && <p>Note: {revision.after.note}</p>}</li>)}</ol></details>;
}

type Mode = 'overview' | 'opening' | 'add' | 'edit' | 'void';
export function AccountFundsDialog({ account, onClose }: { account: TradingAccount; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, setData, loading, error: loadError, refresh } = useAccountFunds(account.id);
  const [mode, setMode] = useState<Mode>('overview');
  const [entry, setEntry] = useState<CashEntry | null>(null);
  const [kind, setKind] = useState<CashKind>('deposit');
  const [amount, setAmount] = useState('');
  const [effective, setEffective] = useState(() => localDateTime());
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [moreLoading, setMoreLoading] = useState(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const submitting = useRef(false);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const actualMode = mode === 'overview' && data && !data.opening ? 'opening' : mode;
  const currency = data?.currency || account.currency || '';

  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => { if (actualMode !== 'overview') formHeading.current?.focus(); }, [actualMode]);

  function begin(next: Mode, selected?: CashEntry) {
    setMode(next); setEntry(selected ?? null); setError(''); setSuccess(''); setReason('');
    if (next === 'opening' && data?.opening) { setAmount(data.opening.amount); setEffective(localDateTime(new Date(data.opening.effectiveAt), true)); setNote(''); }
    else if (selected) { setAmount(selected.amount.replace('-', '')); setEffective(localDateTime(new Date(selected.effectiveAt), true)); setKind(selected.kind); setNote(selected.note); }
    else { setAmount(''); setEffective(localDateTime()); setKind('deposit'); setNote(''); }
  }

  let preview: string | null = null;
  try {
    if (data?.summary.balance != null && currency && actualMode !== 'opening') {
      let change = actualMode === 'void' && entry ? -moneyUnits(entry.amount) : 0n;
      if (actualMode === 'add' || actualMode === 'edit') {
        const units = moneyUnits(amount, currency);
        if (units <= 0n) throw new Error();
        change = ['withdrawal', 'adjustment-decrease', 'fee'].includes(kind) ? -units : units;
        if (actualMode === 'edit' && entry) change -= moneyUnits(entry.amount);
      }
      preview = unitsMoney(moneyUnits(data.summary.balance, undefined, true) + change);
    }
  } catch { /* incomplete input has no balance preview */ }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !data || !currency) return;
    setError(''); setSuccess('');
    try {
      let mutation: FundsMutation;
      const originalTime = actualMode === 'opening' ? data.opening?.effectiveAt : entry?.effectiveAt;
      const effectiveAt = actualMode === 'void' ? '' : originalTime && effective === localDateTime(new Date(originalTime), true) ? originalTime : isoDateTime(effective);
      if (actualMode === 'void' && entry) mutation = { action: 'void', entryId: entry.id, expectedVersion: entry.version, reason };
      else if (actualMode === 'opening') mutation = { action: 'set-opening', amount: normalizeMoney(amount, currency), effectiveAt, note, expectedVersion: data.opening?.version ?? 0 };
      else {
        const fields = { kind, amount: normalizeMoney(amount, currency), effectiveAt, note };
        mutation = actualMode === 'edit' && entry ? { action: 'edit', entryId: entry.id, expectedVersion: entry.version, reason, ...fields } : { action: 'add', ...fields };
      }
      const parsed = fundsMutationSchema.safeParse(mutation);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check funds details.');
      const signature = JSON.stringify(parsed.data);
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
      submitting.current = true; setWorking(true);
      const response = await journalFetch(`/api/journal/trading-accounts/${account.id}/funds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: pending.current.requestId, mutation: parsed.data }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Funds could not be saved. Retry with the same details.');
      pending.current = null;
      await refresh();
      setSuccess(actualMode === 'void' ? 'Entry voided. Its history is preserved.' : actualMode === 'edit' ? 'Correction saved with change history.' : actualMode === 'opening' ? 'Opening balance saved.' : `${CASH_LABELS[kind]} recorded.`);
      setMode('overview'); setEntry(null); setAmount(''); setNote(''); setReason('');
      window.dispatchEvent(new Event('macroflow:journal-updated'));
    } catch (error) { setError(error instanceof Error ? error.message : 'Save status could not be confirmed. Retry with the same details.'); }
    finally { submitting.current = false; setWorking(false); }
  }

  async function loadMore() {
    if (!data || moreLoading) return;
    setMoreLoading(true); setError('');
    try {
      const response = await journalFetch(`/api/journal/trading-accounts/${account.id}/funds?offset=${data.entries.length}`);
      const body: AccountFunds & { error?: string } = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'History could not be loaded.');
      setData(current => current ? { ...current, entries: [...current.entries, ...body.entries.filter(entry => !current.entries.some(existing => existing.id === entry.id))], hasMore: body.hasMore } : current);
    } catch (error) { setError(error instanceof Error ? error.message : 'History could not be loaded.'); }
    finally { setMoreLoading(false); }
  }

  return <dialog ref={dialog} className="account-dialog funds-dialog" aria-labelledby="funds-dialog-title" onCancel={event => { if (working) event.preventDefault(); }} onClose={() => { if (!dialog.current?.open) onClose(); }}>
    <div className="account-dialog-panel">
      <div className="account-dialog-heading"><div><span className="account-dialog-kicker">Your account, accounted for</span><h2 id="funds-dialog-title">Account funds</h2></div><button type="button" className="account-icon-button" aria-label="Close funds dialog" onClick={onClose} disabled={working}><X size={20} aria-hidden="true" /></button></div>
      <p className="account-dialog-description">{tradingAccountLabel(account)}</p>
      {loading && <p className="capture-help" role="status">Loading account funds…</p>}
      {loadError && <div className="capture-error" role="alert">{loadError}<button type="button" className="text-link" onClick={() => void refresh()}>Retry</button></div>}
      {!currency && !loading && <p className="funds-notice">This account needs a currency. Close this dialog and choose one in Account details, then return to set your opening balance.</p>}
      {success && <p className="capture-success" role="status">{success}</p>}
      {data && currency && <>
        {data.opening && <div className="funds-overview"><span className="funds-balance-label">{data.summary.complete ? 'Recorded balance' : 'Known recorded balance'}</span><p className="funds-dialog-balance">{formatMoney(data.summary.balance!, currency)}</p><Coverage data={data} /><dl className="funds-summary-grid"><div><dt>Net funding</dt><dd>{formatMoney(data.summary.netFunding, currency)}</dd></div><div><dt>Net trading P&amp;L</dt><dd>{formatMoney(data.summary.netPnl, currency)}</dd></div><div><dt>Adjustments</dt><dd>{formatMoney(data.summary.adjustments, currency)}</dd></div><div><dt>Standalone fees</dt><dd>{formatMoney(data.summary.fees, currency)}</dd></div></dl><small className="funds-as-of">As of {new Date(data.summary.asOf).toLocaleString()} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</small></div>}
        {actualMode === 'overview' ? <>
          <div className="funds-section-heading"><h3>Funds history</h3><button type="button" className="account-primary-button" onClick={() => begin('add')}><ArrowDownLeft size={16} aria-hidden="true" />Add funds entry</button></div>
          <div className="funds-history">
            {data.entries.map(entry => <article className={`funds-history-entry${entry.voidedAt ? ' is-voided' : ''}`} key={entry.id}><div className="funds-entry-top"><div><strong>{CASH_LABELS[entry.kind]}{entry.voidedAt && <span className="funds-void-badge">Voided</span>}</strong><time>{new Date(entry.effectiveAt).toLocaleString()}</time></div><span>{formatMoney(entry.amount, currency)}</span></div>{entry.note && <p>{entry.note}</p>}<div className="funds-entry-actions"><RevisionHistory revisions={entry.revisions} currency={currency} />{!entry.voidedAt && <div><button type="button" onClick={() => begin('edit', entry)} aria-label={`Edit ${CASH_LABELS[entry.kind]} ${formatMoney(entry.amount, currency)}`}><PencilSimpleLine size={14} aria-hidden="true" />Edit</button><button type="button" onClick={() => begin('void', entry)}>Void</button></div>}</div></article>)}
            {!data.entries.length && <div className="funds-empty"><Wallet size={24} aria-hidden="true" /><h4>Your funding story starts here</h4><p>Record a deposit, withdrawal, fee or balance adjustment.</p></div>}
            {data.hasMore && <button type="button" className="account-secondary-button" onClick={() => void loadMore()} disabled={moreLoading}>{moreLoading ? 'Loading…' : 'Load older entries'}</button>}
          </div>
          {data.opening && <div className="funds-opening-history"><div className="funds-entry-top"><div><strong>Opening snapshot</strong><time>{new Date(data.opening.effectiveAt).toLocaleString()}</time></div><span>{formatMoney(data.opening.amount, currency)}</span></div><div className="funds-entry-actions"><RevisionHistory revisions={data.opening.revisions} currency={currency} /><button type="button" onClick={() => begin('opening')}>Correct opening</button></div></div>}
        </> : <form className="funds-entry-form" onSubmit={submit}>
          <h3 ref={formHeading} tabIndex={-1}>{actualMode === 'opening' ? data.opening ? 'Correct opening balance' : 'Set your starting point' : actualMode === 'void' ? 'Void this entry' : actualMode === 'edit' ? 'Correct funds entry' : 'Record account funds'}</h3>
          <p className="capture-help">{actualMode === 'opening' ? 'Enter the balance your account already had at this exact time. All activity through this snapshot is already included.' : actualMode === 'void' ? 'This removes the entry’s effect from your balance and keeps its change history.' : 'Cash movements stay separate from your trading profit.'}</p>
          <fieldset disabled={working} className="trade-capture-fields">
            {actualMode !== 'void' && <>
              {actualMode !== 'opening' && <label className="capture-field">Action<select value={kind} onChange={event => setKind(event.target.value as CashKind)}>{CASH_KINDS.map(kind => <option key={kind} value={kind}>{CASH_LABELS[kind]}</option>)}</select></label>}
              <div className="capture-grid"><label className="capture-field">{actualMode === 'opening' ? 'Opening balance' : 'Amount'} · {currency}<input type="text" inputMode="decimal" required maxLength={25} value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label><label className="capture-field">{actualMode === 'opening' ? 'Balance as of' : 'Effective date & time'}<input type="datetime-local" step="1" required value={effective} onChange={event => setEffective(event.target.value)} /><small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small></label></div>
              <label className="capture-field">{actualMode === 'opening' && data.opening ? 'Correction reason' : kind.startsWith('adjustment') && actualMode !== 'opening' ? 'Adjustment reason' : 'Note (optional)'}<textarea rows={2} required={(actualMode === 'opening' && !!data.opening) || (actualMode !== 'opening' && kind.startsWith('adjustment'))} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder={actualMode === 'opening' ? 'Starting balance from your account statement' : 'What was this funds movement for?'} /></label>
              {kind === 'fee' && actualMode !== 'opening' && <p className="funds-notice">Use standalone fees only when they are not already included in a trade’s net P&amp;L.</p>}
            </>}
            {(actualMode === 'edit' || actualMode === 'void') && <label className="capture-field">Correction reason<textarea rows={2} required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain why you are correcting this entry" /></label>}
          </fieldset>
          {preview !== null && <div className="funds-balance-preview"><span>Recorded balance after {actualMode === 'void' ? 'voiding' : 'saving'}</span><strong>{formatMoney(preview, currency)}</strong><small>{moneyUnits(preview, undefined, true) < 0n ? 'This records a negative balance. Check that it matches your account activity.' : 'Trading P&L is unaffected by this funds entry.'}</small></div>}
          {actualMode === 'opening' && <p className="funds-notice">Only trades realized and funds recorded after this snapshot contribute to the balance. Older activity is already covered by the opening amount.</p>}
          <div className="account-dialog-footer">{data.opening && <button type="button" className="account-secondary-button" onClick={() => { setMode('overview'); setError(''); }} disabled={working}>Cancel</button>}<button type="submit" className="account-primary-button" disabled={working}>{working ? 'Saving…' : actualMode === 'void' ? 'Void entry' : actualMode === 'opening' ? 'Save opening balance' : actualMode === 'edit' ? 'Save correction' : 'Record funds entry'}</button></div>
        </form>}
      </>}
      {error && <p className="capture-error" role="alert">{error}</p>}
    </div>
  </dialog>;
}
