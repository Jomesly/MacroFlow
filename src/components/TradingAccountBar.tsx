'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, PencilSimpleLine, X, Wallet, CaretDown } from '@phosphor-icons/react';
import { journalFetch } from '@/lib/journal-fetch';
import { BROKER_CHOICES, tradingAccountLabel, type TradingAccount } from '@/lib/trading-account-types';

interface Props {
  accounts: TradingAccount[];
  selected: string;
  onSelect: (id: string) => void;
  onSaved: (account: TradingAccount) => void;
  allowAll: boolean;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onManageFunds: (account: TradingAccount) => void;
  onImport: () => void;
  captureAccounts?: string[];
  onCaptureChange: (ids: string[]) => void;
  disabled: boolean;
}

export default function TradingAccountBar({ accounts, selected, onSelect, onSaved, allowAll, loading, error, onRetry, onManageFunds, onImport, captureAccounts, onCaptureChange, disabled }: Props) {
  const [editing, setEditing] = useState<TradingAccount | null | undefined>(undefined);
  const current = accounts.find(a => a.id === (captureAccounts ? captureAccounts.length === 1 ? captureAccounts[0] : undefined : selected));
  return <>
    <section className="trading-account-bar" aria-label="Trading account selection">
      <div className="trading-account-picker">
        <label htmlFor="journal-trading-account">Trading account</label>
        {captureAccounts ? <CaptureAccountPicker accounts={accounts} selected={captureAccounts} onChange={onCaptureChange} disabled={loading || !!error || disabled} loading={loading} /> : <select id="journal-trading-account" value={selected} onChange={event => onSelect(event.target.value)} disabled={loading || !!error || disabled}>
          {loading ? <option value="">Loading accounts…</option> : <>
            <option value="" disabled={!allowAll}>{allowAll ? 'All accounts' : 'Choose an account'}</option>
            {accounts.map(account => <option key={account.id} value={account.id}>{tradingAccountLabel(account)}</option>)}
          </>}
        </select>}
      </div>
      <div className="trading-account-actions">
        {current && <button type="button" className="account-secondary-button" disabled={disabled} onClick={() => onManageFunds(current)}><Wallet size={16} aria-hidden="true" /><span>Manage funds</span></button>}
        {current && <button type="button" className="account-secondary-button" disabled={disabled} onClick={() => setEditing(current)} aria-label={current.currency ? 'Edit account nickname' : 'Edit account details'}><PencilSimpleLine size={16} aria-hidden="true" /><span>{current.currency ? 'Nickname' : 'Account details'}</span></button>}
        <button type="button" className="account-primary-button" onClick={() => setEditing(null)} disabled={loading || !!error || disabled}><Plus size={16} aria-hidden="true" />Add account</button>
      </div>
      {error && <div className="trading-account-error" role="alert"><p>{error}</p><button type="button" className="text-link" onClick={onRetry}>Retry accounts</button></div>}
      {!loading && !error && accounts.length === 0 && <p className="trading-account-hint">Add your broker and account ID to start your journal. A nickname makes each account easier to find.</p>}
    </section>
    {editing !== undefined && <AccountDialog key={editing?.id ?? 'new'} account={editing} accounts={accounts} onClose={() => setEditing(undefined)} onImport={() => { setEditing(undefined); onImport(); }} onSaved={account => { onSaved(account); setEditing(undefined); }} />}
  </>;
}

function CaptureAccountPicker({ accounts, selected, onChange, disabled, loading }: { accounts: TradingAccount[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const chosen = accounts.filter(account => selected.includes(account.id));
  const visible = accounts.filter(account => tradingAccountLabel(account).toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const focusOutside = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); };
  }, [open]);

  return <div ref={root} className="account-dropdown" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} id="journal-trading-account" type="button" className="account-dropdown-trigger" aria-label="Trading account" aria-expanded={open} aria-controls="capture-account-options" disabled={disabled} onClick={() => { setOpen(!open); setSearch(''); }}>
      <span>{loading ? 'Loading accounts…' : chosen.length === 1 ? tradingAccountLabel(chosen[0]) : chosen.length > 1 ? chosen.map(account => account.nickname || account.accountNumber || account.brokerName || 'My journal').join(', ') : 'Choose an account'}</span>
      {chosen.length > 1 && <span className="account-dropdown-count">{chosen.length} selected</span>}
      <CaretDown size={16} aria-hidden="true" />
    </button>
    {open && <div id="capture-account-options" className="account-dropdown-panel" role="group" aria-label="Trading accounts">
      {accounts.length > 5 && <input className="account-dropdown-search" type="search" aria-label="Find an account" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nickname, broker or account ID" />}
      <div className="account-dropdown-options">
        {visible.map(account => <label key={account.id} className={`account-dropdown-option${selected.includes(account.id) ? ' is-selected' : ''}`}>
          <input type="checkbox" checked={selected.includes(account.id)} disabled={disabled || account.brokerAccountId !== null || (!selected.includes(account.id) && selected.length >= 20)} onChange={() => onChange(selected.includes(account.id) ? selected.filter(id => id !== account.id) : [...selected, account.id])} />
          <span className="destination-identity"><strong>{account.nickname || account.brokerName || 'My journal'}</strong><span>{[account.brokerName, account.accountNumber, account.server === account.brokerName ? null : account.server].filter(Boolean).join(' · ') || 'Manual journal'}{account.brokerAccountId !== null && ' · MT5 sync'}</span></span>
          <span className="destination-currency">{account.currency || 'Currency unset'}</span>
        </label>)}
        {!visible.length && <p className="account-dropdown-help">{accounts.length ? 'No matching accounts.' : 'Add an account to get started.'}</p>}
      </div>
      <p className="account-dropdown-help">Select the accounts for this trade.{selected.length >= 20 && ' Maximum 20 accounts.'}</p>
    </div>}
  </div>;
}

function AccountDialog({ account, accounts, onClose, onSaved, onImport }: { account: TradingAccount | null; accounts: TradingAccount[]; onClose: () => void; onSaved: (account: TradingAccount) => void; onImport: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [broker, setBroker] = useState('');
  const [customBroker, setCustomBroker] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [nickname, setNickname] = useState(account?.nickname ?? '');
  const [server, setServer] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const brokers = [...new Set([...BROKER_CHOICES, ...accounts.map(a => a.brokerName).filter((name): name is string => !!name)])].sort((a, b) => a.localeCompare(b));
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    setWorking(true); setError('');
    try {
      const response = await journalFetch(account ? `/api/journal/trading-accounts/${account.id}` : '/api/journal/trading-accounts', {
        method: account ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(account ? { nickname, ...(!account.currency ? { currency } : {}) } : { brokerName: broker === '__custom' ? customBroker : broker, accountNumber, nickname, server, currency }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Account could not be saved.');
      onSaved(body.account);
    } catch (e) { setError(e instanceof Error ? e.message : 'Account could not be saved.'); setWorking(false); }
  }

  const brokerName = broker === '__custom' ? customBroker.trim() : broker;
  return <dialog ref={dialog} className="account-dialog" aria-labelledby="account-dialog-title" onCancel={event => { if (working) event.preventDefault(); }} onClose={() => { if (!dialog.current?.open) onClose(); }}>
    <form className="account-dialog-panel" onSubmit={save}>
      <div className="account-dialog-heading"><div><span className="account-dialog-kicker">Your trading workspace</span><h2 id="account-dialog-title">{account ? 'Edit nickname' : 'Add trading account'}</h2></div><button type="button" className="account-icon-button" aria-label="Close account dialog" onClick={onClose} disabled={working}><X size={20} aria-hidden="true" /></button></div>
      <p className="account-dialog-description">{account ? 'Your broker and account ID stay the same.' : 'Keep each broker account separate, with a name you recognize.'}</p>
      {!account && <div className="account-import-choice"><span>Already keeping a journal in Notion?</span><button type="button" className="text-link" onClick={onImport}>Import existing journal →</button></div>}
      {account ? <p className="account-identity-preview">{tradingAccountLabel(account)}</p> : <>
        <div className="account-field">
          <label htmlFor="account-broker">Broker or firm</label>
          <select id="account-broker" autoFocus required value={broker} onChange={event => setBroker(event.target.value)} disabled={working}>
            <option value="" disabled>Choose your broker</option>
            {brokers.map(name => <option key={name}>{name}</option>)}
            <option value="__custom">+ Add a different broker</option>
          </select>
        </div>
        {broker === '__custom' && <div className="account-field">
          <label htmlFor="account-custom-broker">Broker or firm name</label>
          <input id="account-custom-broker" required maxLength={80} value={customBroker} onChange={event => setCustomBroker(event.target.value)} placeholder="Enter broker name" disabled={working} />
        </div>}
        <div className="account-field-grid">
          <div className="account-field">
            <label htmlFor="account-number">Account number / ID</label>
            <input id="account-number" required type="text" maxLength={64} autoComplete="off" spellCheck={false} value={accountNumber} onChange={event => setAccountNumber(event.target.value)} placeholder="e.g. 00123456 or cddcab62" disabled={working} />
          </div>
          <div className="account-field">
            <label htmlFor="account-currency">Currency</label>
            <select id="account-currency" value={currency} onChange={event => setCurrency(event.target.value)} disabled={working}>
              {['USD', 'EUR', 'GBP', 'PHP', 'AUD', 'CAD', 'CHF', 'JPY', 'NZD', 'SGD', 'HKD', 'ZAR', 'USDT', 'USDC', 'BTC', 'ETH'].map(code => <option key={code}>{code}</option>)}
            </select>
          </div>
        </div>
      </>}
      {account && !account.currency && <label className="account-field">Account currency<select value={currency} onChange={event => setCurrency(event.target.value)} disabled={working}>{['USD', 'EUR', 'GBP', 'PHP', 'AUD', 'CAD', 'CHF', 'JPY', 'NZD', 'SGD', 'HKD', 'ZAR', 'USDT', 'USDC', 'BTC', 'ETH'].map(code => <option key={code}>{code}</option>)}</select><small>Choose the currency used for this account’s cash results and funds.</small></label>}
      <div className="account-field">
        <label htmlFor="account-nickname">Nickname <span>(optional)</span></label>
        <input id="account-nickname" aria-describedby="account-nickname-help" autoFocus={!!account} maxLength={60} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="e.g. Funded account or London setups" disabled={working} />
        <small id="account-nickname-help">Shown alongside your broker and account ID.</small>
      </div>
      {!account && <>
        <details className="account-server-details"><summary>Use a broker server to distinguish matching account IDs</summary><label className="account-field">Server <span>(optional)</span><input maxLength={128} value={server} onChange={event => setServer(event.target.value)} placeholder="e.g. Broker-Live01" disabled={working} /></label></details>
        <div className="account-identity-preview"><span>Account label preview</span><strong>{[nickname.trim(), brokerName, accountNumber.trim(), server.trim(), currency].filter(Boolean).join(' · ')}</strong></div>
        <p className="account-dialog-note">This creates a journal account. Set up automatic syncing separately in Accounts.</p>
      </>}
      {error && <p className="trading-account-error" role="alert">{error}</p>}
      <div className="account-dialog-footer"><button type="button" className="account-secondary-button" onClick={onClose} disabled={working}>Cancel</button><button type="submit" className="account-primary-button" disabled={working}>{working ? 'Saving…' : account ? 'Save nickname' : 'Create account'}</button></div>
    </form>
  </dialog>;
}
