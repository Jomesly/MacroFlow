import 'server-only';
import { supabase } from './supabase';
import { accountIdSchema, tradingAccountSchema, TradingAccountError, type TradingAccount } from './trading-account-types';
export { TradingAccountError } from './trading-account-types';

const columns = 'id,broker_name,account_number,nickname,server,currency,broker_account_id,is_default';
interface AccountRow {
  id: string; broker_name: string | null; account_number: string | null;
  nickname: string | null; server: string | null; currency: string | null;
  broker_account_id: number | null; is_default: boolean;
}
function fromRow(row: AccountRow): TradingAccount {
  return { id: row.id, brokerName: row.broker_name, accountNumber: row.account_number,
    nickname: row.nickname, server: row.server, currency: row.currency,
    brokerAccountId: row.broker_account_id, isDefault: row.is_default };
}

export async function listTradingAccounts(userId: string): Promise<TradingAccount[]> {
  const { data, error } = await supabase.from('journal_accounts').select(columns)
    .eq('user_id', userId).order('created_at').order('id');
  if (error) throw new TradingAccountError('Trading accounts are temporarily unavailable. Please retry.');
  return ((data ?? []) as AccountRow[]).map(fromRow);
}

export async function requireOwnedTradingAccount(userId: string, id: unknown): Promise<TradingAccount> {
  if (!accountIdSchema.safeParse(id).success) throw new TradingAccountError('Invalid trading account.', 400);
  const { data, error } = await supabase.from('journal_accounts').select(columns)
    .eq('user_id', userId).eq('id', id as string).maybeSingle();
  if (error) throw new TradingAccountError('Trading account could not be checked. Please retry.');
  if (!data) throw new TradingAccountError('Trading account was not found.', 404);
  return fromRow(data as AccountRow);
}

export async function createTradingAccount(userId: string, input: unknown): Promise<TradingAccount> {
  const parsed = tradingAccountSchema.safeParse(input);
  if (!parsed.success) throw new TradingAccountError(parsed.error.issues[0]?.message ?? 'Invalid account details.', 400);
  const value = parsed.data;
  const { data, error } = await supabase.rpc('run_managed_journal_rpc', { p_user_id: userId, p_operation: 'create_journal_account', p_arguments: { p_values: {
    broker_name: value.brokerName, account_number: value.accountNumber,
    nickname: value.nickname || null, server: value.server || null, currency: value.currency,
  } } });
  if (error?.code === '23505') throw new TradingAccountError('This broker account already exists. Select it above, or include a different server.', 409);
  if (error || !data) throw new TradingAccountError('Account could not be created. Please retry.');
  return fromRow(data as AccountRow);
}

export async function renameTradingAccount(userId: string, id: string, input: unknown): Promise<TradingAccount> {
  const current = await requireOwnedTradingAccount(userId, id);
  const parsed = tradingAccountSchema.pick({ nickname: true, currency: true }).partial({ currency: true }).strict().safeParse(input);
  if (!parsed.success) throw new TradingAccountError('Use a nickname of 60 characters or fewer.', 400);
  if (parsed.data.currency && current.currency && parsed.data.currency !== current.currency) throw new TradingAccountError('Account currency is fixed once selected.', 400);
  const { data, error } = await supabase.rpc('run_managed_journal_rpc', { p_user_id: userId, p_operation: 'rename_journal_account', p_arguments: { p_account_id: id, p_values: {
    nickname: parsed.data.nickname || null,
    ...(!current.currency && parsed.data.currency ? { currency: parsed.data.currency } : {}),
  } } });
  if (error || !data) throw new TradingAccountError('Nickname could not be saved. Please retry.');
  return fromRow(data as AccountRow);
}
