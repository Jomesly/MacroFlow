'use client';
import { journalFetch } from '@/lib/journal-fetch';

import { useCallback, useEffect, useState } from 'react';
import { AnalyticsResult, BucketStats } from '@/lib/analytics';

const CARD = 'rounded-xl border border-zinc-800 bg-zinc-900/50 p-5';
const LABEL = 'block text-xs font-medium text-zinc-400 mb-2';
const FIELD =
  'w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-400 transition-colors';

function fmtMoney(n: number | null): string {
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}

function moneyColor(n: number | null): string {
  if (n === null) return 'text-zinc-600';
  return n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-zinc-500';
}

function fmtPct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(n % 1 === 0 ? 0 : 2)}%`;
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <p className={LABEL}>{label}</p>
      <p className={`text-xl font-bold font-mono tabular-nums ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="mt-1 text-[10px] text-zinc-600">{sub}</p>}
    </div>
  );
}

function BreakdownTable({ title, data }: { title: string; data: Record<string, BucketStats> }) {
  const rows = Object.entries(data).sort((a, b) => b[1].trades - a[1].trades);
  if (rows.length === 0) return null;
  return (
    <div className={CARD}>
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="pb-2 pr-4 font-medium">Group</th>
              <th className="pb-2 pr-4 font-medium text-right">Trades</th>
              <th className="pb-2 pr-4 font-medium text-right">Win rate</th>
              <th className="pb-2 font-medium text-right">Net P&amp;L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, b]) => (
              <tr key={name} className="border-t border-zinc-800/50">
                <td className="py-2 pr-4 text-zinc-200">{name}</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums text-zinc-400">{b.trades}</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums text-zinc-300">{fmtPct(b.winRate)}</td>
                <td className={`py-2 text-right font-mono tabular-nums ${moneyColor(b.net)}`}>
                  {fmtMoney(b.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [accounts, setAccounts] = useState<{ id: number; account_login: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [fromFilter, setFromFilter] = useState('');
  const [toFilter, setToFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (accountFilter) q.set('account', accountFilter);
      if (symbolFilter) q.set('symbol', symbolFilter);
      if (fromFilter) q.set('from', fromFilter);
      if (toFilter) q.set('to', toFilter);

      const [aRes, accRes] = await Promise.all([
        journalFetch(`/api/journal/analytics?${q.toString()}`),
        journalFetch('/api/journal/accounts'),
      ]);
      if (!aRes.ok) throw new Error(`HTTP ${aRes.status}`);
      const aJson = await aRes.json();
      setData(aJson.analytics);
      if (accRes.ok) {
        const accJson = await accRes.json();
        setAccounts(accJson.accounts ?? []);
      }
      setError('');
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Failed to load analytics. Please retry.');
    } finally {
      setLoading(false);
    }
  }, [accountFilter, symbolFilter, fromFilter, toFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; all setState occurs after await resolves
    void load();
  }, [load]);

  if (loading && !data) return <p className="text-sm text-zinc-500">Loading analytics…</p>;
  if (error && !data) return <div role="alert" className="space-y-3 text-sm"><p className="text-red-400">{error}</p><button onClick={() => void load()} className="text-blue-400 underline">Try again</button></div>;
  if (!data) return null;

  const t = data.totals;

  return (
    <div className="space-y-5 max-w-6xl">
      <p className="text-xs text-zinc-500">Reporting dates use UTC. Your saved timezone preference does not change these existing aggregates yet.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label htmlFor="flt-account" className={LABEL}>Account</label>
          <select id="flt-account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className={FIELD}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.account_login}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="flt-symbol" className={LABEL}>Symbol</label>
          <input id="flt-symbol" value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} placeholder="XAUUSD" className={FIELD} />
        </div>
        <div>
          <label htmlFor="flt-from" className={LABEL}>From</label>
          <input id="flt-from" type="date" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label htmlFor="flt-to" className={LABEL}>To</label>
          <input id="flt-to" type="date" value={toFilter} onChange={(e) => setToFilter(e.target.value)} className={FIELD} />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Net P&L" value={fmtMoney(t.net)} color={moneyColor(t.net)} sub={t.moneyCoverage !== null ? `on ${t.moneyCoverage}% of closed trades` : 'no money data'} />
        <Stat label="Win rate" value={fmtPct(t.winRate)} sub={`${t.wins}W / ${t.losses}L / ${t.breakeven}BE`} />
        <Stat label="Profit factor" value={t.profitFactor !== null ? t.profitFactor.toFixed(2) : '—'} />
        <Stat label="Avg R" value={t.avgR !== null ? `${t.avgR > 0 ? '+' : ''}${t.avgR.toFixed(2)}R` : '—'} sub={t.rCoverage !== null ? `R on ${t.rCoverage}% of closed` : undefined} />
        <Stat label="Expectancy / trade" value={fmtMoney(t.expectancy)} color={moneyColor(t.expectancy)} />
        <Stat label="Avg win" value={fmtMoney(t.avgWin)} color={moneyColor(t.avgWin)} />
        <Stat label="Avg loss" value={fmtMoney(t.avgLoss)} color={moneyColor(t.avgLoss)} />
        <Stat label="Trades" value={String(t.trades)} sub={`${t.closed} closed · ${t.open} open`} />
      </div>

      <div className={CARD}>
        <h3 className="text-sm font-semibold text-white mb-3">P&amp;L calendar</h3>
        {data.calendar.length === 0 ? (
          <p className="text-xs text-zinc-500">No closed trades yet.</p>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {data.calendar.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.wins}W/${d.losses}L/${d.breakeven}BE, net ${fmtMoney(d.net)}`}
                className={`rounded-md border px-1.5 py-2 text-center ${
                  d.net === null
                    ? 'border-zinc-800 bg-zinc-900/40'
                    : d.net > 0
                      ? 'border-emerald-800/40 bg-emerald-950/30'
                      : d.net < 0
                        ? 'border-red-800/40 bg-red-950/30'
                        : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <p className="text-[9px] text-zinc-500">{d.date.slice(5)}</p>
                <p className={`text-[11px] font-mono tabular-nums font-semibold ${moneyColor(d.net)}`}>
                  {fmtMoney(d.net)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BreakdownTable title="By symbol" data={data.bySymbol} />
        <BreakdownTable title="By setup tag" data={data.byTag} />
        <BreakdownTable title="By session" data={data.bySession} />
        <BreakdownTable title="By weekday" data={data.byWeekday} />
      </div>
    </div>
  );
}
