'use client';

import { useRef, useState } from 'react';
import type { BrokerAccount } from '@/lib/account-management';
import { journalFetch } from '@/lib/journal-fetch';
import AccountDialog from './AccountDialog';

const FIELD = 'mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const BUTTON = 'rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:border-zinc-500 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed';
const PRIMARY = 'rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed';
const DANGER = 'rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed';

function connectionStatus(account: BrokerAccount) {
  if (account.lifecycle === 'removed') return { label: 'Removed', color: 'text-zinc-500 bg-zinc-800' };
  if (account.lifecycle === 'paused') return { label: 'Sync paused', color: 'text-amber-300 bg-amber-950/50' };
  if (!account.last_seen_at) return { label: 'Waiting for EA', color: 'text-amber-300 bg-amber-950/50' };
  if (Date.now() - new Date(account.last_seen_at).getTime() < 5 * 60 * 1000) return { label: 'Connected', color: 'text-emerald-300 bg-emerald-950/50' };
  return { label: 'Offline', color: 'text-zinc-400 bg-zinc-800' };
}

export default function TradingAccountCard({ account, onChanged }: { account: BrokerAccount; onChanged: () => Promise<void> }) {
  const [dialog, setDialog] = useState<'edit' | 'remove' | 'reconnect' | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [deleteTrades, setDeleteTrades] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [snapshot, setSnapshot] = useState(account);
  const [stale, setStale] = useState(false);
  const operation = useRef<{ payload: string; id: string } | null>(null);
  const status = connectionStatus(account);
  const label = account.display_name || account.account_login;

  function open(next: typeof dialog) {
    setSnapshot(account); setStale(false); operation.current = null;
    setError(''); setNotice(''); setName(account.display_name ?? ''); setNotes(account.notes);
    setDeleteTrades(false); setConfirmation(''); setDialog(next);
  }

  async function mutate(action: 'edit' | 'pause' | 'resume' | 'remove' | 'reconnect') {
    const target = dialog ? snapshot : account;
    const payload = JSON.stringify({ expectedVersion: target.management_version,
      ...(action === 'edit' ? { action, displayName: name, notes } : action === 'remove' ? { deleteTrades, confirmation } : action === 'reconnect' ? {} : { action }),
    });
    if (operation.current?.payload !== payload) operation.current = { payload, id: crypto.randomUUID() };
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await journalFetch(`/api/journal/accounts/${account.id}${action === 'reconnect' ? '/reconnect' : ''}`, {
        method: action === 'remove' ? 'DELETE' : action === 'reconnect' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), operationId: operation.current.id }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (['ACCOUNT_STATE_CHANGED', 'ACCOUNT_OPERATION_CONFLICT', 'ACCOUNT_REMOVED'].includes(result.code)) {
          setStale(true);
          await onChanged();
        }
        throw new Error(result.error ?? 'Could not update this account.');
      }
      setDialog(null);
      setNotice(action === 'edit' ? 'Account details saved.' : action === 'pause' ? 'Sync paused. Journal history is unchanged.' : action === 'resume' || action === 'reconnect' ? 'Sync enabled. Waiting for the next EA request.' : 'Trading account removed.');
      await onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update this account.'); }
    finally { setBusy(false); }
  }

  return <article aria-label={`Trading account ${label}`} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="break-all text-sm font-semibold text-white">{label}</h3>
          <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${status.color}`}>{status.label}</span>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-zinc-400">{account.account_login} · {account.server}{account.currency ? ` · ${account.currency}` : ''}</p>
      </div>
      <span className="text-xs text-zinc-400">{account.trade_count.toLocaleString()} {account.trade_count === 1 ? 'trade' : 'trades'}</span>
    </div>
    {account.notes && <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">{account.notes}</p>}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/70 pt-3">
      <p className="text-[11px] text-zinc-500">{account.lifecycle === 'removed' ? 'Further imports are blocked.' : account.last_seen_at ? `Last sync ${new Date(account.last_seen_at).toLocaleString()}${account.ea_version ? ` · EA v${account.ea_version}` : ''}` : 'Waiting for the EA to send trades.'}</p>
      <div className="flex flex-wrap gap-2">
        {account.lifecycle === 'removed' ? <button type="button" disabled={busy} onClick={() => open('reconnect')} className={BUTTON}>Reconnect</button> : <>
          <button type="button" disabled={busy} onClick={() => open('edit')} className={BUTTON}>Edit details</button>
          <button type="button" disabled={busy} onClick={() => void mutate(account.lifecycle === 'paused' ? 'resume' : 'pause')} className={BUTTON}>{busy && !dialog ? 'Updating…' : account.lifecycle === 'paused' ? 'Resume sync' : 'Pause sync'}</button>
          <button type="button" disabled={busy} onClick={() => open('remove')} className={`${BUTTON} border-red-900/50 text-red-400 hover:border-red-700 hover:text-red-300`}>Remove account</button>
        </>}
      </div>
    </div>
    {!dialog && error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
    {notice && <p role="status" className="mt-3 text-xs text-emerald-400">{notice}</p>}

    {dialog && <AccountDialog title={dialog === 'edit' ? 'Edit trading account' : dialog === 'remove' ? 'Remove trading account?' : 'Reconnect trading account?'} busy={busy} onClose={() => { setDialog(null); setError(''); }}>
      <p className="mb-5 break-all text-xs text-zinc-400">{snapshot.display_name && <span className="mb-1 block font-semibold text-white">{snapshot.display_name}</span>}{snapshot.account_login} · {snapshot.server}</p>
      <form onSubmit={(event) => { event.preventDefault(); void mutate(dialog); }} className="space-y-5">
        {dialog === 'edit' && <>
          <label className="block text-xs text-zinc-300">Display name <span className="text-zinc-500">(optional)</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="e.g. Main trading account" className={FIELD} disabled={busy} />
          </label>
          <label className="block text-xs text-zinc-300">Notes <span className="text-zinc-500">(optional)</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={4} placeholder="A private note about this account" className={FIELD} disabled={busy} />
          </label>
          <p className="text-xs leading-relaxed text-zinc-500">Login, server, currency and EA version come from MT5. Your display name and notes stay unchanged during sync.</p>
        </>}
        {dialog === 'remove' && <>
          <p className="text-sm leading-relaxed text-zinc-300">This stops imports into MacroFlow and removes the connection. Your account with the broker stays open.</p>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="mb-3 text-xs font-medium text-white">What should happen to its {snapshot.trade_count} imported trades?</legend>
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${!deleteTrades ? 'border-blue-500/70 bg-blue-950/20' : 'border-zinc-800'}`}>
              <input autoFocus type="radio" name="history" checked={!deleteTrades} onChange={() => setDeleteTrades(false)} className="mt-0.5 accent-blue-500" />
              <span className="text-sm">Keep journal history <span className="mt-1 block text-xs text-zinc-400">Recommended. Trades and analytics stay available.</span></span>
            </label>
            <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${deleteTrades ? 'border-red-500/70 bg-red-950/20' : 'border-zinc-800'}`}>
              <input type="radio" name="history" checked={deleteTrades} onChange={() => setDeleteTrades(true)} className="mt-0.5 accent-red-500" />
              <span className="text-sm">Delete imported trades too <span className="mt-1 block text-xs text-zinc-400">Permanently erase this account’s trades. Journal analytics will change.</span></span>
            </label>
          </fieldset>
          {deleteTrades && <label className="block text-xs text-zinc-300">Type {snapshot.account_login} to confirm
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className={FIELD} disabled={busy} />
          </label>}
          <p className="text-xs text-zinc-500">Other accounts and unrelated manual trades stay unchanged. Future EA requests for this account will be blocked until you reconnect it.</p>
        </>}
        {dialog === 'reconnect' && <>
          <p className="text-sm leading-relaxed text-zinc-300">Allow the EA to import trades for this account again. Attach the EA with an active API key to resume syncing.</p>
          <p className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200">If you previously deleted its trades, the EA may import historical trades again. Existing retained trades are deduplicated.</p>
        </>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-3 border-t border-zinc-800 pt-4">
          <button type="button" onClick={() => { setDialog(null); setError(''); }} disabled={busy} className={BUTTON}>Cancel</button>
          <button type="submit" disabled={busy || stale || (dialog === 'remove' && deleteTrades && confirmation !== snapshot.account_login)} className={dialog === 'remove' ? DANGER : PRIMARY}>
            {busy ? 'Saving…' : dialog === 'edit' ? 'Save changes' : dialog === 'reconnect' ? 'Reconnect account' : deleteTrades ? 'Remove and delete trades' : 'Remove account'}
          </button>
        </div>
      </form>
    </AccountDialog>}
  </article>;
}
