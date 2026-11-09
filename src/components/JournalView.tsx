'use client';

import { useRef, useState } from 'react';
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

export type JournalTab = 'log' | 'history' | 'analytics' | 'accounts' | 'review';
const tabs = [
  { value: 'log', label: 'Log Trade', icon: PencilSimpleLine },
  { value: 'history', label: 'History', icon: ClockCounterClockwise },
  { value: 'analytics', label: 'Analytics', icon: ChartBar },
  { value: 'review', label: 'Weekly Review', icon: CheckCircle },
  { value: 'accounts', label: 'Connect Account', icon: PlugsConnected },
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
      'Connect MT5 with a journal API key. Your broker password stays with you.',
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.14 }}
            >
              {tab === 'log' ? (
                <div className="journal-content-grid">
                  <section className="journal-form-panel">
                    <h2>Capture the trade</h2>
                    <p>The setup, the execution, and what you learned.</p>
                    <LogTradeForm />
                  </section>
                  <aside className="journal-aside">
                    <span className="mini-bars mb-5" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <h2>A good journal captures more than the outcome.</h2>
                    <ol>
                      <li>
                        <span>01</span>What was the context?
                      </li>
                      <li>
                        <span>02</span>Why did you take the setup?
                      </li>
                      <li>
                        <span>03</span>Did you follow your plan?
                      </li>
                    </ol>
                    <p>
                      Consistency comes from reviewing the process, one trade at
                      a time.
                    </p>
                    <Link href="/" className="text-link">
                      Check the market context
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </Link>
                  </aside>
                </div>
              ) : (
                <>
                  <div className="journal-tab-heading">
                    <h2>{headings[tab].title}</h2>
                    <p>{headings[tab].description}</p>
                  </div>
                  {tab === 'history' && (
                    <div className="journal-history-content">
                      <TradeHistory />
                    </div>
                  )}
                  {tab === 'analytics' && <Analytics />}
                  {tab === 'review' && <WeeklyReview />}
                  {tab === 'accounts' && <ConnectAccount />}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
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
