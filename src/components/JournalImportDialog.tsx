'use client';

import { useEffect, useRef, useState } from 'react';
import { X, ArrowRight, UploadSimple, CheckCircle, DownloadSimple } from '@phosphor-icons/react';
import { journalFetch } from '@/lib/journal-fetch';
import { readImportCsv, suggestImportMapping, importReportCsv } from '@/lib/journal-import-parser';
import { IMPORT_BYTES, IMPORT_FIELDS, IMPORT_LABELS, type ImportOptions, type ImportPreview } from '@/lib/journal-import-types';
import { tradingAccountLabel, type TradingAccount } from '@/lib/trading-account-types';
import { formatMoney, isoDateTime, localDateTime, moneyUnits, unitsMoney } from '@/lib/account-money';
import { TRADE_SYMBOLS } from '@/lib/types';
import type { AccountFunds } from '@/lib/account-funds-types';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const initialOptions = (): ImportOptions => ({ mapping: suggestImportMapping([]), delimiter: ',', dateFormat: 'ISO', dateMeaning: 'close', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', decimal: '.', moneyMode: 'signed', netConfirmed: true, defaultStatus: 'closed', aliases: {} });

export default function JournalImportDialog({ accounts, initialAccount, onClose, onImported }: { accounts: TradingAccount[]; initialAccount: string; onClose: () => void; onImported: (accountId: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const manual = accounts.filter(a => a.brokerAccountId === null && a.currency);
  const [target, setTarget] = useState(manual.some(a => a.id === initialAccount) ? initialAccount : '__new');
  const [newAccount, setNewAccount] = useState({ brokerName: '', accountNumber: '', nickname: '', server: '', currency: 'USD' });
  const [funds, setFunds] = useState<AccountFunds | null>(null), [fundsLoading, setFundsLoading] = useState(false), [fundsError, setFundsError] = useState('');
  const [balanceMode, setBalanceMode] = useState('later'), [balanceAmount, setBalanceAmount] = useState(''), [balanceDate, setBalanceDate] = useState(localDateTime());
  const [filename, setFilename] = useState(''), [content, setContent] = useState(''), [headers, setHeaders] = useState<string[]>([]);
  const [options, setOptions] = useState<ImportOptions>(initialOptions), [netConfirmed, setNetConfirmed] = useState(false);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({}), [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null), [selected, setSelected] = useState<number[]>([]), [page, setPage] = useState(0);
  const [aliasFrom, setAliasFrom] = useState(''), [aliasTo, setAliasTo] = useState<string>(TRADE_SYMBOLS[0]);
  const [result, setResult] = useState<{ accountId: string; count: number; skipped: number; from: string; to: string } | null>(null);
  const currency = target === '__new' ? newAccount.currency : manual.find(a => a.id === target)?.currency ?? 'USD';
  const labels = ['Account', 'CSV file', 'Match columns', 'Review'];
  useEffect(() => {
    const element = dialog.current, previous = document.body.style.overflow, focus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden'; element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previous; focus?.focus(); };
  }, []);
  useEffect(() => { heading.current?.focus(); dialog.current?.querySelector('.import-body')?.scrollTo(0, 0); }, [step, result]);
  useEffect(() => {
    if (target === '__new') return;
    let cancelled = false;
    async function load() {
      setFundsLoading(true); setFundsError(''); setFunds(null);
      try {
        const response = await journalFetch(`/api/journal/trading-accounts/${target}/funds`), body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Balance could not be loaded.');
        if (!cancelled) setFunds(body);
      } catch (e) { if (!cancelled) setFundsError(e instanceof Error ? e.message : 'Balance unavailable.'); }
      finally { if (!cancelled) setFundsLoading(false); }
    }
    void load(); return () => { cancelled = true; };
  }, [target]);

  function go(next: number) { setError(''); setStep(next); }
  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError(''); setPreview(null); setEdits({});
    try {
      if (file.size > IMPORT_BYTES) throw new Error('Choose a CSV smaller than 2 MB.');
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('Extract your Notion export and choose its .csv file.');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('Save the CSV with UTF-8 encoding, then upload it again.'); }
      const csv = readImportCsv(text, options.delimiter);
      setFilename(file.name); setContent(text); setHeaders(csv.headers); setOptions(current => ({ ...current, mapping: suggestImportMapping(csv.headers) }));
    } catch (e) { setContent(''); setFilename(''); setError(e instanceof Error ? e.message : 'CSV could not be read.'); }
  }
  function delimiter(value: string) {
    setOptions(current => ({ ...current, delimiter: value as ImportOptions['delimiter'] }));
    if (!content) return;
    try { const csv = readImportCsv(content, value); setHeaders(csv.headers); setOptions(current => ({ ...current, mapping: suggestImportMapping(csv.headers) })); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Check the delimiter.'); }
  }
  async function review() {
    setBusy(true); setError('');
    try {
      if (!netConfirmed && options.mapping.pnl) throw new Error('Confirm that the cash amounts are after fees, or unmatch the cash column.');
      const opening = !(target !== '__new' && funds?.opening) && balanceMode !== 'later' ? { mode: balanceMode, amount: balanceAmount, effectiveAt: isoDateTime(balanceDate) } : null;
      const response = await journalFetch('/api/journal/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, content, target: target === '__new' ? { newAccount } : { accountId: target }, opening, options, edits }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Preview unavailable.');
      const next = body.preview as ImportPreview;
      setPreview(next); setSelected(next.rows.filter(row => row.status === 'ready').map(row => row.row)); setDirty(false); setPage(0); go(3); dialog.current?.querySelector('.import-body')?.scrollTo(0, 0);
    } catch (e) { setError(e instanceof Error ? e.message : 'Preview unavailable.'); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview || dirty || busy) return;
    setBusy(true); setError('');
    try {
      const response = await journalFetch('/api/journal/imports/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: preview.id, rows: selected, keepDuplicates: preview.rows.filter(row => row.status === 'possible' && selected.includes(row.row)).map(row => row.row) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Import could not be saved.');
      setResult(body.result); window.dispatchEvent(new Event('macroflow:journal-updated')); window.dispatchEvent(new Event('journal-tags-changed'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Import could not be saved.'); }
    finally { setBusy(false); }
  }
  let impact = 0n, before = 0, unknown = 0;
  for (const row of preview?.rows ?? []) {
    if (!selected.includes(row.row) || !row.trade) continue;
    const t = row.trade;
    if (t.result && (t.netPnl === null || !t.closedAt)) unknown++;
    if (t.closedAt && preview?.balance.effectiveAt) {
      if (Date.parse(t.closedAt) > Date.parse(preview.balance.effectiveAt) && t.netPnl !== null) impact += moneyUnits(t.netPnl);
      else if (Date.parse(t.closedAt) <= Date.parse(preview.balance.effectiveAt)) before++;
    }
  }
  const balanceAfter = preview?.balance.current != null ? unitsMoney(moneyUnits(preview.balance.current, undefined, true) + impact) : null;
  return <dialog ref={dialog} className="account-dialog import-dialog" aria-labelledby="import-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => { if (!dialog.current?.open) onClose(); }}>
    <div className="import-shell">
      <header className="import-header"><div><span className="account-dialog-kicker">Bring your history with you</span><h2 id="import-title" tabIndex={-1} ref={heading}>{result ? 'Journal imported' : 'Import your journal'}</h2></div><button type="button" className="account-icon-button" aria-label="Close import" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      {!result && <ol className="import-steps" aria-label="Import progress">{labels.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={index <= step ? 'is-current' : ''}><span>{index + 1}</span>{label}</li>)}</ol>}
      <div className="import-body" aria-busy={busy}>
        {result ? <div className="import-success"><CheckCircle size={40} aria-hidden="true" /><h3>{result.count} trades added</h3><p>{preview?.accountLabel}</p><p>{new Date(result.from).toLocaleDateString(undefined, { timeZone: options.timezone })} – {new Date(result.to).toLocaleDateString(undefined, { timeZone: options.timezone })} · {result.skipped} rows skipped</p><p>Your history is ready. You can review or undo this batch in Accounts → Import history. Undo keeps trades you have edited.</p><p>Any balance snapshot set during import stays in Manage funds.</p></div> : <>
          {step === 0 && <form id="import-account-form" onSubmit={event => { event.preventDefault(); go(1); }}>
            <p className="import-intro">Choose where this journal belongs. Each import goes into one account. Split files covering several accounts before uploading.</p>
            <label className="account-field">Trading account<select value={target} disabled={busy} onChange={event => { setTarget(event.target.value); setPreview(null); }}>{manual.map(a => <option key={a.id} value={a.id}>{tradingAccountLabel(a)}</option>)}<option value="__new">+ Create a new account with this import</option></select></label>
            {target === '__new' && <div className="account-field-grid">{(['brokerName', 'accountNumber', 'nickname', 'currency'] as const).map(field => <label className="account-field" key={field}>{{ brokerName: 'Broker or firm', accountNumber: 'Account number / ID', nickname: 'Nickname (optional)', currency: 'Currency' }[field]}{field === 'currency' ? <select value={newAccount.currency} onChange={e => setNewAccount({ ...newAccount, currency: e.target.value })}>{['USD', 'EUR', 'GBP', 'PHP', 'AUD', 'CAD', 'CHF', 'JPY', 'NZD', 'SGD', 'HKD', 'ZAR', 'USDT', 'USDC', 'BTC', 'ETH'].map(code => <option key={code}>{code}</option>)}</select> : <input required={field !== 'nickname'} maxLength={field === 'brokerName' ? 80 : field === 'nickname' ? 60 : 64} value={newAccount[field]} onChange={e => setNewAccount({ ...newAccount, [field]: e.target.value })} />}</label>)}<label className="account-field">Server (optional)<input maxLength={128} value={newAccount.server} onChange={e => setNewAccount({ ...newAccount, server: e.target.value })} /></label></div>}
            {target !== '__new' && fundsLoading ? <p role="status">Checking balance…</p> : target !== '__new' && fundsError ? <p role="alert" className="trading-account-error">{fundsError} Close and reopen to retry.</p> : target !== '__new' && funds?.opening ? <div className="import-note">Existing balance snapshot: <strong>{formatMoney(funds.opening.amount, currency)}</strong> as of {new Date(funds.opening.effectiveAt).toLocaleString()}. Earlier profits will not be added again.</div> : <>
              <label className="account-field">How should we handle capital?<select value={balanceMode} onChange={e => setBalanceMode(e.target.value)}><option value="later">Set balance later</option><option value="starting">Starting capital — before these trades</option><option value="current">Known balance — as of a date</option></select><small>A known balance already includes results up to its date.</small></label>
              {balanceMode !== 'later' && <div className="account-field-grid"><label className="account-field">Balance · {currency}<input required inputMode="decimal" value={balanceAmount} onChange={e => setBalanceAmount(e.target.value)} /></label><label className="account-field">Balance as of<input required type="datetime-local" value={balanceDate} onChange={e => setBalanceDate(e.target.value)} /></label></div>}
            </>}
            <p className="account-dialog-note">A new account is created only when you confirm the import.</p>
          </form>}
          {step === 1 && <>
            <p className="import-intro">Upload the CSV from your Notion trading database.</p>
            <div className="import-upload"><UploadSimple size={28} aria-hidden="true" /><label className="account-field">Choose CSV file<input type="file" accept=".csv,text/csv" onChange={e => void loadFile(e.target.files?.[0])} /></label><p>One file · up to 2 MB · 1,000 trades</p>{filename && <strong>{filename}</strong>}</div>
            <label className="account-field">Column separator<select value={options.delimiter} onChange={e => delimiter(e.target.value)}><option value=",">Comma</option><option value=";">Semicolon</option><option value={'\t'}>Tab</option></select></label>
            <details className="import-help"><summary>How to export from Notion</summary><p>Open your trading database as a full page → ••• → Export → Markdown &amp; CSV. Unzip the download and select the database’s CSV file here.</p><p>Only the CSV’s columns are imported. Page bodies, images, attachments and linked database content stay in Notion.</p><a className="text-link" href="https://www.notion.com/help/export-your-content" target="_blank" rel="noreferrer">Notion export instructions</a></details>
            <button type="button" className="text-link import-template" onClick={() => download('journal-template.csv', 'Date,Symbol,Direction,Result,Net P&L,Currency,Tags,Notes,Trade ID\r\n2025-01-10,XAUUSD,Buy,Win,125.50,USD,Pullback,Patient entry,example-1\r\n2025-01-11,GBPUSD,Sell,Loss,-50,USD,Breakout,Review this setup,example-2\r\n')}><DownloadSimple size={16} />Download CSV template</button>
          </>}
          {step === 2 && <>
            <p className="import-intro">Match your columns, then check how dates and amounts should be read.</p>
            <div className="import-mapping">{IMPORT_FIELDS.map(field => <label className="account-field" key={field}>{IMPORT_LABELS[field]}{['date', 'symbol', 'direction'].includes(field) && ' *'}<select value={options.mapping[field]} onChange={e => setOptions({ ...options, mapping: { ...options.mapping, [field]: e.target.value } })}><option value="">{['date', 'symbol', 'direction'].includes(field) ? 'Choose column' : 'Not in my CSV'}</option>{headers.map(header => <option key={header}>{header}</option>)}</select></label>)}</div>
            {headers.some(header => !Object.values(options.mapping).includes(header)) && <p className="account-dialog-note">Columns kept as source values only: {headers.filter(header => !Object.values(options.mapping).includes(header)).join(', ')}. These do not affect reports.</p>}
            <div className="import-format"><label className="account-field">Date format<select value={options.dateFormat} onChange={e => setOptions({ ...options, dateFormat: e.target.value as ImportOptions['dateFormat'] })}><option value="ISO">YYYY-MM-DD / ISO timestamp</option><option value="DMY">Day / Month / Year</option><option value="MDY">Month / Day / Year</option><option value="Notion">Month name — January 10, 2025</option></select></label><label className="account-field">Trade date represents<select value={options.dateMeaning} onChange={e => setOptions({ ...options, dateMeaning: e.target.value as 'entry' | 'close' })}><option value="close">Closing date</option><option value="entry">Entry date</option></select></label><label className="account-field">Timezone<input value={options.timezone} onChange={e => setOptions({ ...options, timezone: e.target.value })} placeholder="Asia/Manila" /></label><label className="account-field">Number format<select value={options.decimal} onChange={e => setOptions({ ...options, decimal: e.target.value as '.' | ',' })}><option value=".">1,234.56 — dot decimals</option><option value=",">1.234,56 — comma decimals</option></select></label><label className="account-field">Cash amounts<select value={options.moneyMode} onChange={e => setOptions({ ...options, moneyMode: e.target.value as ImportOptions['moneyMode'] })}><option value="signed">Signed P&amp;L (+win / −loss)</option><option value="result-amount">Win / Loss + positive amount</option></select></label><label className="account-field">Without a status column<select value={options.defaultStatus} onChange={e => setOptions({ ...options, defaultStatus: e.target.value as 'open' | 'closed' })}><option value="closed">Trades are closed</option><option value="open">Trades are open</option></select></label></div>
            {options.mapping.pnl && <label className="import-check"><input type="checkbox" checked={netConfirmed} onChange={e => setNetConfirmed(e.target.checked)} /><span>Cash amounts are net of fees, in {currency}.</span></label>}
            <details className="import-help"><summary>Match a different symbol name</summary><p>Supported: {TRADE_SYMBOLS.join(', ')}. Common names such as Gold and NAS100 are recognized.</p><div className="account-field-grid"><label className="account-field">Symbol in CSV<input value={aliasFrom} onChange={e => setAliasFrom(e.target.value)} maxLength={100} /></label><label className="account-field">Match to<select value={aliasTo} onChange={e => setAliasTo(e.target.value)}>{TRADE_SYMBOLS.map(s => <option key={s}>{s}</option>)}</select></label></div><button type="button" className="account-secondary-button" disabled={!aliasFrom.trim()} onClick={() => { setOptions({ ...options, aliases: { ...options.aliases, [aliasFrom.trim()]: aliasTo } }); setAliasFrom(''); }}>Add symbol match</button>{Object.entries(options.aliases).map(([from, to]) => <p key={from}>{from} → {to} <button type="button" className="text-link" aria-label={`Remove symbol match ${from}`} onClick={() => setOptions({ ...options, aliases: Object.fromEntries(Object.entries(options.aliases).filter(([key]) => key !== from)) })}>Remove</button></p>)}</details>
            <p className="account-dialog-note">Missing prices and cash results stay unknown. Date-only records keep their original day; no entry time is invented.</p>
          </>}
          {step === 3 && preview && <>
            <div className="import-review-heading"><div><h3>{selected.length} of {preview.rows.length} trades selected</h3><p>{preview.accountLabel}</p></div><button type="button" className="text-link" onClick={() => download('import-review.csv', importReportCsv(preview.rows))}>Download review</button></div>
            <div className="import-counts"><span>{preview.rows.filter(r => r.status === 'ready').length} ready</span><span>{preview.rows.filter(r => r.status === 'invalid').length} need fixing</span><span>{preview.rows.filter(r => r.status === 'duplicate').length} already imported</span><span>{preview.rows.filter(r => r.status === 'possible').length} possible duplicates</span></div>
            <div className="import-note">{balanceAfter !== null ? <><strong>Balance after selected trades: {formatMoney(balanceAfter, preview.currency)}</strong><p>Selected cash impact: {formatMoney(unitsMoney(impact), preview.currency)}. {before > 0 && `${before} trades fall on or before your snapshot and will not be added again.`}</p></> : <p>No balance set. Trades will be recorded; you can set capital in Manage funds.</p>}{unknown > 0 && <p>{unknown} selected trades have unknown cash results or closing dates. Balance coverage will be incomplete.</p>}</div>
            <label className="import-check"><input type="checkbox" checked={preview.rows.some(r => r.status === 'ready') && preview.rows.filter(r => r.status === 'ready').every(r => selected.includes(r.row))} disabled={dirty} onChange={e => setSelected(e.target.checked ? preview.rows.filter(r => r.status === 'ready').map(r => r.row) : [])} /><span>Select all ready trades</span></label>
            <div className="import-rows" key={preview.id}>{preview.rows.slice(page * 20, (page + 1) * 20).map(row => <article className={`import-row is-${row.status}`} key={row.row}><div className="import-row-heading"><label className="import-check"><input type="checkbox" aria-label={`${row.status === 'possible' ? 'Keep possible duplicate' : 'Import'} row ${row.row}`} disabled={dirty || row.status === 'invalid' || row.status === 'duplicate'} checked={selected.includes(row.row)} onChange={e => setSelected(e.target.checked ? [...selected, row.row] : selected.filter(n => n !== row.row))} /><span><strong>Row {row.row} · {row.trade?.symbol ?? row.cells[options.mapping.symbol]}</strong><span>{row.trade ? `${row.trade.sourceDate} · ${row.trade.direction} · ${row.trade.result ?? 'open'} · ${row.trade.netPnl === null ? 'Cash unknown' : formatMoney(row.trade.netPnl, currency)}` : 'Check the values below'}</span></span></label><span className="import-status">{{ ready: 'Ready', invalid: 'Needs fixing', possible: 'Possible duplicate', duplicate: 'Already imported' }[row.status]}</span></div>{[...row.errors, ...row.warnings, ...(row.status === 'possible' ? ['Select this row only if it represents a separate trade.'] : [])].map((message, i) => <p className="import-row-message" key={i}>{message}</p>)}<details><summary>View or correct source values</summary><div className="import-mapping">{headers.map(header => <label className="account-field" key={header}>{header}<textarea aria-label={header} rows={header === options.mapping.notes ? 3 : 1} value={edits[row.row]?.[header] ?? row.cells[header] ?? ''} maxLength={10000} onChange={e => { setEdits(current => ({ ...current, [row.row]: { ...current[row.row], [header]: e.target.value } })); setDirty(true); }} /></label>)}</div></details></article>)}</div>
            {preview.rows.length > 20 && <div className="import-pagination"><button type="button" className="account-secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(preview.rows.length / 20)}</span><button type="button" className="account-secondary-button" disabled={(page + 1) * 20 >= preview.rows.length} onClick={() => setPage(page + 1)}>Next</button></div>}
            {dirty && <p role="status" className="import-note">Source values changed. Refresh the preview to validate corrections before importing.</p>}
          </>}
        </>}
        {error && <p className="trading-account-error" role="alert">{error}</p>}
      </div>
      <footer className="import-footer">{result ? <><button type="button" className="account-secondary-button" onClick={() => { onImported(result.accountId); onClose(); }}>Done</button><button type="button" className="account-primary-button" onClick={() => { onImported(result.accountId); onClose(); window.dispatchEvent(new Event('journal-open-history')); }}>View imported trades<ArrowRight size={16} /></button></> : <><button type="button" className="account-secondary-button" disabled={busy} onClick={() => step ? go(step - 1) : onClose()}>{step ? 'Back' : 'Cancel'}</button>{step === 0 ? <button type="submit" form="import-account-form" className="account-primary-button" disabled={target !== '__new' && (fundsLoading || !!fundsError)}>Continue<ArrowRight size={16} /></button> : step === 1 ? <button type="button" className="account-primary-button" disabled={!content || !!error} onClick={() => go(2)}>Match columns<ArrowRight size={16} /></button> : step === 2 || dirty ? <button type="button" className="account-primary-button" disabled={busy} onClick={() => void review()}>{busy ? 'Validating…' : dirty ? 'Refresh preview' : 'Preview import'}</button> : <button type="button" className="account-primary-button" disabled={busy || !selected.length} onClick={() => void commit()}>{busy ? 'Importing…' : `Import ${selected.length} trades`}</button>}</>}</footer>
    </div>
  </dialog>;
}
