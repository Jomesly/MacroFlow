'use client';

import { useState } from 'react';
import Link from 'next/link';
import LogTradeForm from '@/components/LogTradeForm';
import TradeHistory from '@/components/TradeHistory';
import Analytics from '@/components/Analytics';
import ConnectAccount from '@/components/ConnectAccount';

export type JournalTab = 'log' | 'history' | 'analytics' | 'accounts';

const TAB_STYLES = (active: boolean): string =>
  `px-4 py-3 text-sm font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
    active
      ? 'border-blue-500 text-white'
      : 'border-transparent text-zinc-500 hover:text-zinc-300'
  }`;

export default function JournalView({ initialTab }: { initialTab: JournalTab }) {
  const [tab, setTab] = useState<JournalTab>(initialTab);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xl font-bold text-white tracking-tight hover:text-zinc-200 transition-colors"
            >
              MacroFlow
            </Link>
            <span className="text-[10px] font-medium text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800 uppercase tracking-wider">
              Trading Journal
            </span>
          </div>
          <Link
            href="/"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            ← Dashboard
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        <div className="flex gap-1 border-b border-zinc-800 mb-6">
          <button
            type="button"
            onClick={() => setTab('log')}
            className={TAB_STYLES(tab === 'log')}
          >
            Log Trade
          </button>
          <button
            type="button"
            onClick={() => setTab('history')}
            className={TAB_STYLES(tab === 'history')}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setTab('analytics')}
            className={TAB_STYLES(tab === 'analytics')}
          >
            Analytics
          </button>
          <button
            type="button"
            onClick={() => setTab('accounts')}
            className={TAB_STYLES(tab === 'accounts')}
          >
            Connect Account
          </button>
        </div>

        {tab === 'log' && <LogTradeForm />}
        {tab === 'history' && <TradeHistory />}
        {tab === 'analytics' && <Analytics />}
        {tab === 'accounts' && <ConnectAccount />}
      </main>

      <footer className="border-t border-zinc-800 px-6 py-4">
        <p className="max-w-6xl mx-auto text-[10px] text-zinc-700">
          Trading journal for personal record-keeping. This is not financial advice.
        </p>
      </footer>
    </div>
  );
}
