'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowUpRight,
  ChartBar,
  CheckCircle,
  ClockCounterClockwise,
  PencilSimpleLine,
  PlugsConnected,
} from '@phosphor-icons/react';
import LogTradeForm from '@/components/LogTradeForm';
import TradeHistory from '@/components/TradeHistory';
import Analytics from '@/components/Analytics';
import WeeklyReview from '@/components/WeeklyReview';
import ConnectAccount from '@/components/ConnectAccount';
import BetaNotice from '@/components/BetaNotice';
import TradingAccountBar from '@/components/TradingAccountBar';
import JournalImportDialog from '@/components/JournalImportDialog';
import ImportHistory from '@/components/ImportHistory';
import { AccountFundsCard, AccountFundsDialog } from '@/components/AccountFunds';
import { type TradingAccount } from '@/lib/trading-account-types';
import { journalFetch } from '@/lib/journal-fetch';
import { getJournalUser } from '@/lib/journal-session';

export type JournalTab = 'log' | 'history' | 'analytics' | 'accounts' | 'review';
const tabs = [
  { value: 'log', label: 'Log Trade', icon: PencilSimpleLine },
  { value: 'history', label: 'History', icon: ClockCounterClockwise },
  { value: 'analytics', label: 'Analytics', icon: ChartBar },
  { value: 'review', label: 'Weekly Review', icon: CheckCircle },
  { value: 'accounts', label: 'Accounts', icon: PlugsConnected },
] as const;
const headings = {
  review: { title: 'Review the week', description: 'Connect your results to the decisions behind them.' },
  history: {
    title: 'Your trading history',
    description:
      'Every decision, recorded. Revisit the setups and outcomes behind your results.',
  },
  analytics: {
    title: 'See the patterns in your performance',
    description: 'Review results across markets, setups, and sessions.',
  },
  accounts: {
    title: 'Bring your trades together',
    description:
      'Choose an account above, give it a nickname, or connect MT5 below.',
  },
};

export default function JournalView({
  initialTab,
}: {
  initialTab: JournalTab;
}) {
  const [tab, setTab] = useState<JournalTab>(initialTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduce = useReducedMotion();
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [captureAccounts, setCaptureAccounts] = useState<string[]>([]);
  const [savingTrade, setSavingTrade] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState('');
  const [visitedAccounts, setVisitedAccounts] = useState<string[]>([]);
  const [fundsAccount, setFundsAccount] = useState<TradingAccount | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importVersion, setImportVersion] = useState(0);
  useEffect(() => { const openHistory = () => setTab('history'); window.addEventListener('journal-open-history', openHistory); return () => window.removeEventListener('journal-open-history', openHistory); }, []);
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true); setAccountsError('');
    try {
      const response = await journalFetch('/api/journal/trading-accounts');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Accounts could not be loaded.');
      const items: TradingAccount[] = body.accounts;
      setAccounts(items);
      const params = new URLSearchParams(window.location.search);
      let stored: string | null = null;
      try { stored = localStorage.getItem(`macroflow:trading-account:${getJournalUser()}`); } catch { /* Storage is optional. */ }
      const requested = params.get('tradingAccount') ?? stored;
      // An explicit account that no longer exists requires a fresh selection.
      const chosen = requested !== null ? items.find(a => a.id === requested)?.id ?? '' : items[0]?.id ?? '';
      setSelectedAccount(chosen);
      setCaptureAccounts(items.some(a => a.id === chosen && a.brokerAccountId === null) ? [chosen] : []);
      if (chosen) setVisitedAccounts(current => current.includes(chosen) ? current : [...current, chosen]);
      else if (items.length) setVisitedAccounts(current => current.includes('__all') ? current : [...current, '__all']);
      return items;
    } catch (e) { setAccountsError(e instanceof Error ? e.message : 'Accounts could not be loaded.'); }
    finally { setAccountsLoading(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the account list for this signed-in journal
    void loadAccounts();
  }, [loadAccounts]);

  const selectAccount = (id: string) => {
    setSelectedAccount(id);
    setCaptureAccounts(accounts.some(a => a.id === id && a.brokerAccountId === null) ? [id] : []);
    const scope = id || '__all';
    setVisitedAccounts(current => current.includes(scope) ? current : [...current, scope]);
    try { localStorage.setItem(`macroflow:trading-account:${getJournalUser()}`, id); } catch { /* Storage is optional. */ }
    const url = new URL(window.location.href);
    url.searchParams.set('tradingAccount', id);
    window.history.replaceState(null, '', url);
  };
  const accountSaved = (account: TradingAccount) => {
    setAccounts(current => current.some(a => a.id === account.id) ? current.map(a => a.id === account.id ? account : a) : [...current, account]);
    selectAccount(account.id);
    setCaptureAccounts(account.brokerAccountId === null ? [account.id] : []);
  };
  return (
    <div className="journal-page">
      <main id="main-content" className="workspace-main journal-main">
        <div className="journal-heading">
          <div>
            <div className="page-kicker">
              <span className="accent-line" />A record of your process
            </div>
            <h1>
              Your trading journal<span className="text-accent">.</span>
            </h1>
            <p>
              Better decisions start with understanding the ones you’ve already
              made.
            </p>
          </div>
          <span className="journal-access-label">
            <CheckCircle size={16} aria-hidden="true" />
            Free beta
          </span>
        </div>
        <BetaNotice context="journal" />
        <TradingAccountBar accounts={accounts} selected={selectedAccount} onSelect={selectAccount} onSaved={accountSaved} onImport={() => setImportOpen(true)} allowAll loading={accountsLoading} error={accountsError} onRetry={() => void loadAccounts()} onManageFunds={setFundsAccount} captureAccounts={tab === 'log' ? captureAccounts : undefined} onCaptureChange={setCaptureAccounts} disabled={savingTrade} />
        <div
          className="journal-tabs"
          role="tablist"
          aria-label="Journal sections"
        >
          {tabs.map((item, index) => (
            <button
              key={item.value}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`tab-${item.value}`}
              aria-selected={tab === item.value}
              aria-controls="journal-panel"
              tabIndex={tab === item.value ? 0 : -1}
              disabled={savingTrade}
              onClick={() => setTab(item.value)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight')
                  next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft')
                  next = (index - 1 + tabs.length) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                setTab(tabs[next].value);
                tabRefs.current[next]?.focus();
              }}
            >
              <item.icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
              {tab === item.value && (
                <motion.span
                  layoutId="journal-tab-indicator"
                  className="tab-indicator"
                  transition={{ duration: reduce ? 0 : 0.18 }}
                />
              )}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="journal-panel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
          className="journal-data-panel"
        >
          {/* Keep one mounted form per visited account so switching tabs or
              accounts never carries a draft into another save destination. */}
          {visitedAccounts.map(id => {
            const account = accounts.find(a => a.id === id);
            const captureAccount = captureAccounts.length === 1 ? accounts.find(a => a.id === captureAccounts[0]) : undefined;
            if (!account && id !== '__all') return null;
            return <div key={id} hidden={tab !== 'log' || (id === '__all' ? selectedAccount !== '' : selectedAccount !== id) || accountsLoading || !!accountsError}>
              <div className="journal-content-grid">
                <section className="journal-form-panel">
                  <h2>Capture the trade</h2>
                  <p>The setup, the execution, and what you learned.</p>
                  <LogTradeForm selectedAccountIds={captureAccounts} accounts={accounts} onSavingChange={setSavingTrade} />
                </section>
                <aside className="journal-capture-aside">
                  {captureAccount && <AccountFundsCard account={captureAccount} active={tab === 'log' && (id === '__all' ? selectedAccount === '' : selectedAccount === id)} onManage={() => setFundsAccount(captureAccount)} />}
                  <div className="journal-aside">
                  <h2>A good journal captures more than the outcome.</h2>
                  <ol><li><span>01</span>What was the context?</li><li><span>02</span>Why did you take the setup?</li><li><span>03</span>Did you follow your plan?</li></ol>
                  <p>Consistency comes from reviewing the process, one trade at a time.</p>
                  <Link href="/" className="text-link">Check the market context<ArrowUpRight size={16} aria-hidden="true" /></Link>
                  </div>
                </aside>
              </div>
            </div>;
          })}
          {tab === 'log' && accounts.length === 0 && !accountsLoading && !accountsError && <div className="account-empty-state"><h2>Choose where this trade belongs</h2><p>Add your broker and account ID above to get started.</p></div>}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${tab}:${selectedAccount}`}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.14 }}
            >
              {tab !== 'log' && !accountsLoading && !accountsError ? (
                <>
                  <div className="journal-tab-heading">
                    <h2>{headings[tab].title}</h2>
                    <p>{headings[tab].description}</p>
                  </div>
                  {tab === 'history' && (
                    <div className="journal-history-content">
                      <TradeHistory journalAccountId={selectedAccount || undefined} accounts={accounts} />
                    </div>
                  )}
                  {tab === 'analytics' && <Analytics journalAccountId={selectedAccount || undefined} />}
                  {tab === 'review' && <WeeklyReview journalAccountId={selectedAccount || undefined} />}
                  {tab === 'accounts' && <><ImportHistory key={importVersion} accounts={accounts} accountId={selectedAccount} onImport={() => setImportOpen(true)} /><div className="account-funds-grid">{accounts.filter(account => !selectedAccount || account.id === selectedAccount).map(account => <AccountFundsCard key={account.id} account={account} onManage={() => setFundsAccount(account)} />)}</div><ConnectAccount /></>}
                </>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      {fundsAccount && <AccountFundsDialog key={fundsAccount.id} account={fundsAccount} onClose={() => setFundsAccount(null)} />}
      {importOpen && <JournalImportDialog accounts={accounts} initialAccount={selectedAccount} onClose={() => setImportOpen(false)} onImported={async id => { const items = await loadAccounts(); const account = items?.find(a => a.id === id); if (account) accountSaved(account); setImportVersion(value => value + 1); }} />}
      <footer className="workspace-footer">
        <div className="workspace-footer-inner">
          <p className="disclaimer">
            Your journal, your process. For personal record-keeping; this is not
            financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
