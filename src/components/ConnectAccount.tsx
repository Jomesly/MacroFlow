'use client';
import { journalFetch } from '@/lib/journal-fetch';

import { useCallback, useEffect, useState } from 'react';

interface BrokerAccount {
  id: number;
  account_login: string;
  server: string;
  currency: string | null;
  source: string;
  ea_version: string | null;
  last_seen_at: string | null;
}

interface ApiKeyInfo {
  id: number;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const CARD = 'rounded-xl border border-zinc-800 bg-zinc-900/50 p-5';
const LABEL = 'block text-xs font-medium text-zinc-400 mb-2';
const BTN =
  'rounded-full bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60';

function statusOf(lastSeen: string | null): { label: string; classes: string } {
  if (!lastSeen) return { label: 'Waiting for EA', classes: 'text-amber-400' };
  const ageMs = Date.now() - new Date(lastSeen).getTime();
  if (ageMs < 5 * 60 * 1000) return { label: 'Connected', classes: 'text-emerald-400' };
  return { label: 'Offline', classes: 'text-zinc-500' };
}

export default function ConnectAccount() {
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await journalFetch('/api/journal/accounts');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAccounts(json.accounts ?? []);
      setKeys(json.keys ?? []);
      setError('');
    } catch (err) {
      setAccounts([]);
      setKeys([]);
      setError(err instanceof Error ? err.message : 'Failed to load connected accounts. Please retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; all setState occurs after await resolves
    void load();
    const id = setInterval(() => void load(), 60000);
    return () => clearInterval(id);
  }, [load]);

  const generateKey = async () => {
    setWorking(true);
    setError('');
    try {
      const res = await journalFetch('/api/journal/keys', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Failed to create key');
      setNewKey(json.key);
      setCopied(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setWorking(false);
    }
  };

  const revokeKey = async (id: number) => {
    setWorking(true);
    try {
      const res = await journalFetch(`/api/journal/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke key');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    } finally {
      setWorking(false);
    }
  };

  const copyKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setError('Copy failed — select the key manually');
    }
  };

  if (loading) return <p className="text-sm text-zinc-500">Loading accounts…</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      {error && <div role="alert" className="text-xs"><p className="text-red-400">{error}</p><button onClick={() => void load()} className="mt-2 text-blue-400 underline">Try again</button></div>}

      <div className={CARD}>
        <h2 className="text-sm font-semibold text-white mb-1">Connect MT5 account (beta)</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Free auto-sync via the MacroFlow EA. Read-only — it only sends closed trades, never
          places orders. Works while your MT5 terminal is running (a VPS keeps it always on).
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button type="button" onClick={generateKey} disabled={working} className={BTN}>
            {working ? 'Working…' : 'Generate API key'}
          </button>
          <a
            href="/MacroFlowSync.mq5"
            download
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            Download MacroFlowSync.mq5
          </a>
        </div>

        {newKey && (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 p-4 mb-4">
            <p className={LABEL}>Your new key — shown once, copy it now</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-zinc-950 px-3 py-2 font-mono text-xs text-amber-200">
                {newKey}
              </code>
              <button type="button" onClick={copyKey} className={BTN}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <ol className="list-decimal list-inside space-y-1.5 text-xs text-zinc-400">
          <li>Copy the EA file to your MT5 data folder under <code className="font-mono text-zinc-300">MQL5/Experts</code> and compile it in MetaEditor (F7).</li>
          <li>In MT5 go to Tools → Options → Expert Advisors, tick “Allow WebRequest for listed URL” and add this app’s origin.</li>
          <li>Attach the EA to any chart with Algo Trading enabled.</li>
          <li>Paste the API key and the ingest URL below into the EA inputs.</li>
        </ol>
        <p className={LABEL + ' mt-4'}>Ingest URL</p>
        <code className="block break-all rounded bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
          {typeof window !== 'undefined' ? `${window.location.origin}/api/journal/ingest` : '/api/journal/ingest'}
        </code>
      </div>

      <div className={CARD}>
        <h2 className="text-sm font-semibold text-white mb-3">Connected accounts</h2>
        {accounts.length === 0 ? (
          <p className="text-xs text-zinc-500">No accounts yet — generate a key and attach the EA.</p>
        ) : (
          <div className="space-y-3">
            {accounts.map((a) => {
              const s = statusOf(a.last_seen_at);
              return (
                <div key={a.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                  <span className={`text-xs font-semibold ${s.classes}`}>● {s.label}</span>
                  <span className="text-xs font-mono text-zinc-200">{a.account_login}</span>
                  <span className="text-xs text-zinc-500">{a.server}</span>
                  {a.currency && <span className="text-xs text-zinc-500">{a.currency}</span>}
                  {a.ea_version && <span className="text-[10px] text-zinc-600">EA v{a.ea_version}</span>}
                  <span className="ml-auto text-[10px] text-zinc-600">
                    {a.last_seen_at ? `last sync ${new Date(a.last_seen_at).toLocaleString()}` : 'never synced'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={CARD}>
        <h2 className="text-sm font-semibold text-white mb-3">API keys ({keys.length}/3)</h2>
        {keys.length === 0 ? (
          <p className="text-xs text-zinc-500">No active keys.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-2.5">
                <code className="font-mono text-xs text-zinc-300">{k.key_prefix}…</code>
                <span className="text-[10px] text-zinc-600">
                  created {new Date(k.created_at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => void revokeKey(k.id)}
                  disabled={working}
                  className="ml-auto rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
