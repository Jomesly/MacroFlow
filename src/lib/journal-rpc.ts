import 'server-only';
import { supabase } from './supabase';
import { TradingAccountError } from './trading-account-types';

export async function journalRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (['22023', '23514', '22003', '22007'].includes(error.code)) throw new TradingAccountError(error.code === '22023' ? error.message : 'Check the amounts and dates, then try again.', 400);
    if (error.code === '42501' || error.code === 'P0002') throw new TradingAccountError('Account or record was not found.', 404);
    if (error.code === '40001' || error.code === '23505') throw new TradingAccountError(error.code === '40001' ? error.message : 'This request conflicts with an existing record. Refresh and try again.', 409);
    throw new TradingAccountError('Journal update unavailable. Please retry.');
  }
  return data as T;
}
