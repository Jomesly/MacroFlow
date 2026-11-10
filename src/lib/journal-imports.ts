import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { supabase } from './supabase';
import { journalRpc } from './journal-rpc';
import { requireOwnedTradingAccount } from './trading-accounts';
import { TradingAccountError, tradingAccountLabel } from './trading-account-types';
import { normalizeMoney } from './account-money';
import { importSignature, normalizeImportRows } from './journal-import-parser';
import { importPreviewSchema, type ImportBatchSummary, type ImportPreview } from './journal-import-types';
import type { AccountFunds } from './account-funds-types';
import { SETUP_TAGS } from './types';

export async function previewImport(userId: string, input: unknown): Promise<ImportPreview> {
  const parsed = importPreviewSchema.safeParse(input);
  if (!parsed.success) throw new TradingAccountError(parsed.error.issues[0]?.message ?? 'Check the import details.', 400);
  const body = parsed.data;
  const account = 'accountId' in body.target ? await requireOwnedTradingAccount(userId, body.target.accountId) : null;
  const currency = account?.currency ?? ('newAccount' in body.target ? body.target.newAccount.currency : null);
  if (!currency || account?.brokerAccountId != null) throw new TradingAccountError('Choose a manual account with a known currency.', 400);
  const funds = account ? await journalRpc<AccountFunds>('read_journal_funds', { p_user: userId, p_account: account.id }) : null;
  if (body.opening && funds?.opening) throw new TradingAccountError('This account already has a balance snapshot. Imports keep it.', 409);
  let amount: string | null = null;
  try { if (body.opening) amount = normalizeMoney(body.opening.amount, currency); }
  catch (error) { throw new TradingAccountError(error instanceof Error ? error.message : 'Check the balance amount.', 400); }
  if (body.opening && Date.parse(body.opening.effectiveAt) > Date.now() + 60_000) throw new TradingAccountError('The balance date cannot be in the future.', 400);
  let rows;
  try { rows = normalizeImportRows(body.content, body.options, currency, body.edits); }
  catch (error) { throw new TradingAccountError(error instanceof Error ? error.message : 'Check the CSV.', 400); }
  const registry = await supabase.from('journal_setup_tags').select('name').eq('user_id', userId).limit(1000);
  if (registry.error) throw new TradingAccountError('Setup tags could not be checked. Please retry.');
  const tagNames = new Map<string, string>();
  for (const name of [...SETUP_TAGS, ...(registry.data ?? []).map(tag => tag.name)]) if (!tagNames.has(name.toLowerCase())) tagNames.set(name.toLowerCase(), name);
  const effectiveAt = funds?.opening?.effectiveAt ?? body.opening?.effectiveAt ?? null;
  const sourceIds = new Set<string>(), signatures = new Set<string>();
  for (const row of rows) {
    const trade = row.trade;
    if (!trade) continue;
    trade.setupTags = trade.setupTags.map(name => { const key = name.toLowerCase(); if (!tagNames.has(key)) tagNames.set(key, name); return tagNames.get(key)!; });
    if (body.opening?.mode === 'starting' && Date.parse(body.opening.effectiveAt) >= Date.parse(trade.timestamp)) row.errors.push('Starting capital must be dated before this trade.');
    if (effectiveAt && trade.netPnl !== null && trade.closedAt && trade.closedPrecision === 'date' && DateTime.fromISO(effectiveAt).setZone(trade.timezone).toISODate() === DateTime.fromISO(trade.closedAt).setZone(trade.timezone).toISODate()) row.errors.push('Closing time is unknown on the balance snapshot day. Supply a closing time or use a different snapshot date.');
    const signature = importSignature(trade);
    if (trade.sourceId && sourceIds.has(trade.sourceId)) { row.status = 'duplicate'; row.warnings.push('Original ID is repeated in this file.'); }
    else if (signatures.has(signature)) { row.status = 'possible'; row.warnings.push('A matching trade appears earlier in this file. Select only if this is a separate trade.'); }
    if (trade.sourceId) sourceIds.add(trade.sourceId);
    signatures.add(signature);
    if (row.errors.length) row.status = 'invalid';
  }
  const id = randomUUID();
  await journalRpc('stage_journal_import', { p_user: userId, p_id: id, p_payload: {
    accountId: account?.id ?? null, newAccount: 'newAccount' in body.target ? body.target.newAccount : null,
    filename: body.filename, fileHash: createHash('sha256').update(body.content).digest('hex'), options: body.options,
    opening: body.opening ? { ...body.opening, amount } : null, openingVersion: funds?.opening?.version ?? 0, rows,
  } });
  const staged = await supabase.from('journal_import_rows').select('row_number,status').eq('batch_id', id).order('row_number');
  if (staged.error || !staged.data) throw new TradingAccountError('Preview could not be loaded. Please retry.');
  const statuses = new Map(staged.data.map(row => [row.row_number, row.status]));
  rows = rows.map(row => ({ ...row, status: statuses.get(row.row) ?? row.status }));
  return { id, filename: body.filename, accountLabel: account ? tradingAccountLabel(account) : [body.target && 'newAccount' in body.target ? body.target.newAccount.nickname || body.target.newAccount.brokerName : '', 'New account'].join(' · '), currency, rows,
    balance: { amount: funds?.opening?.amount ?? amount, effectiveAt, current: funds?.summary.balance ?? amount, version: funds?.opening?.version ?? 0 }, expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString() };
}

export async function importHistory(userId: string): Promise<ImportBatchSummary[]> {
  const { data, error } = await supabase.from('journal_import_batches').select('id,filename,account_id,created_at,status,result').eq('user_id', userId).neq('status', 'preview').order('created_at', { ascending: false }).limit(50);
  if (error) throw new TradingAccountError('Import history is unavailable.');
  return Promise.all((data ?? []).map(async batch => {
    const trades = await supabase.from('trades').select('revision').eq('user_id', userId).eq('import_batch_id', batch.id);
    if (trades.error) throw new TradingAccountError('Import history is unavailable.');
    const count = Number(batch.result?.count ?? 0), untouched = (trades.data ?? []).filter(t => t.revision === 1).length, edited = (trades.data ?? []).filter(t => t.revision > 1).length;
    return { id: batch.id, filename: batch.filename, accountId: batch.account_id, createdAt: batch.created_at, count, status: batch.status, untouched, edited, removed: count - untouched - edited };
  }));
}
