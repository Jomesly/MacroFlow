'use client';
import { useCallback, useEffect, useState } from 'react';
import { journalFetch } from '@/lib/journal-fetch';
import type { ImportBatchSummary } from '@/lib/journal-import-types';
import { tradingAccountLabel, type TradingAccount } from '@/lib/trading-account-types';

export default function ImportHistory({ accounts, accountId, onImport }: { accounts: TradingAccount[]; accountId: string; onImport: () => void }) {
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await journalFetch('/api/journal/imports'), body = await response.json(); if (!response.ok) throw new Error(body.error); setBatches(body.batches); }
    catch { setError('Import history could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch this signed-in user's import history on mount
    void load();
  }, [load]);
  async function undo(batch: ImportBatchSummary) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await journalFetch(`/api/journal/imports/${batch.id}/undo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedUntouched: batch.untouched }) }), body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Undo failed.');
      setConfirming(null); setNotice(`${body.result.removed} trades removed. ${body.result.retained} edited trades kept. Your account and balance snapshot remain.`);
      window.dispatchEvent(new Event('macroflow:journal-updated')); await load();
    } catch (e) { setConfirming(null); setError(e instanceof Error ? e.message : 'Undo failed.'); }
    finally { setBusy(false); }
  }
  return <section className="import-history" aria-labelledby="import-history-title"><div className="import-review-heading"><div><h3 id="import-history-title">Import history</h3><p>Bring a Notion journal or CSV into one of your accounts.</p></div><button type="button" className="account-secondary-button" onClick={onImport}>Import journal</button></div>
    {loading && <p role="status">Loading imports…</p>}{error && <p role="alert" className="trading-account-error">{error} <button type="button" className="text-link" onClick={() => void load()}>Refresh history</button></p>}{notice && <p role="status" className="import-note">{notice}</p>}
    {!loading && !error && !batches.filter(b => !accountId || b.accountId === accountId).length && <p className="account-dialog-note">No imports yet. Export your Notion trading database as CSV to get started.</p>}
    {batches.filter(b => !accountId || b.accountId === accountId).map(batch => <article className="import-history-row" key={batch.id}><div><h4>{batch.filename}</h4><p>{new Date(batch.createdAt).toLocaleDateString()} · {batch.count} trades · {batch.status === 'undone' ? 'Undone' : 'Imported'}</p><p>{accounts.find(a => a.id === batch.accountId) ? tradingAccountLabel(accounts.find(a => a.id === batch.accountId)!) : 'Account'}</p></div>{batch.status === 'committed' && <button type="button" className="account-secondary-button" disabled={busy} onClick={() => setConfirming(batch.id)}>Undo import</button>}
      {confirming === batch.id && <div className="import-undo"><p>Remove {batch.untouched} untouched trades? {batch.edited} edited trades will stay; {batch.removed} were already removed. The account and any opening balance stay.</p><button type="button" className="account-secondary-button" disabled={busy} onClick={() => setConfirming(null)}>Keep import</button><button type="button" className="account-primary-button" disabled={busy} onClick={() => void undo(batch)}>{busy ? 'Undoing…' : `Remove ${batch.untouched} trades`}</button></div>}</article>)}
  </section>;
}
