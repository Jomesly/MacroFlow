'use client';

import Link from 'next/link';
import { useState } from 'react';
import AccountDialog from './AccountDialog';
import { announceSessionChange } from '@/lib/journal-session';

export default function AccountSettings({ userId, email, deletionPending: initialPending }: {
  userId: string; email: string; deletionPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deletionPending, setDeletionPending] = useState(initialPending);

  function close() { setOpen(false); setPassword(''); setConfirmation(''); setError(''); }
  async function deleteAccount() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/account', {
        method: 'DELETE', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-journal-user': userId },
        body: JSON.stringify({ password, confirmation }),
      });
      const result = await response.json();
      if (result.deletionPending) setDeletionPending(true);
      if (response.status === 401 || result.code === 'SESSION_CHANGED') {
        announceSessionChange();
        // Discard journal state when the authenticated identity changes.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/login'); return;
      }
      if (!response.ok) throw new Error(result.error ?? 'Could not delete your account. Please retry.');
      setPassword(''); announceSessionChange();
      window.location.replace('/account-deleted');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete your account. Please retry.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-6">
    {deletionPending && <div role="status" className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4 text-sm leading-relaxed text-amber-200">Deletion is pending. Your journal and EA keys are blocked. Use “Finish account deletion” below to retry.</div>}
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-white">Your account</h2>
      <p className="mt-3 text-xs text-zinc-500">Signed in as</p>
      <p className="mt-1 break-all text-sm text-zinc-200">{email}</p>
      {!deletionPending && <div className="mt-5 flex flex-wrap gap-4 text-xs">
        <Link href="/journal/welcome" className="text-blue-400 hover:text-blue-300">Journal preferences →</Link>
        <Link href="/journal?tab=accounts" className="text-blue-400 hover:text-blue-300">Manage trading accounts →</Link>
      </div>}
    </section>
    <section className="rounded-xl border border-red-900/60 bg-red-950/10 p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-red-300">Delete MacroFlow account</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">Permanently delete your login, profile, all journal trades, trading-account connections and API keys. This cannot be undone.</p>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">To remove just one trading account, use Accounts in your journal. Your accounts with brokers remain open.</p>
      <button type="button" onClick={() => setOpen(true)} className="mt-5 rounded-lg border border-red-800 bg-red-950/50 px-4 py-2.5 text-sm font-medium text-red-300 hover:border-red-600 hover:bg-red-900/40">
        {deletionPending ? 'Finish account deletion' : 'Delete my account'}
      </button>
    </section>
    {open && <AccountDialog title={deletionPending ? 'Finish account deletion' : 'Permanently delete your account?'} busy={busy} onClose={close}>
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void deleteAccount(); }}>
        <p className="text-sm leading-relaxed text-zinc-400">All MacroFlow data owned by <span className="break-all text-zinc-200">{email}</span> will be permanently deleted. EA imports and access from other devices will stop.</p>
        <label className="block text-xs text-zinc-300">Current password
          <input autoFocus type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
        </label>
        <label className="block text-xs text-zinc-300">Type DELETE to confirm
          <input autoComplete="off" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy}
            className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
        </label>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-800 pt-4">
          <button type="button" disabled={busy} onClick={close} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || !password || confirmation !== 'DELETE'} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40">{busy ? 'Deleting…' : 'Permanently delete account'}</button>
        </div>
      </form>
    </AccountDialog>}
  </div>;
}
