import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

if (!['http://127.0.0.1:55421', 'http://127.0.0.1:55621'].includes(process.env.SUPABASE_URL)) throw new Error('Evaluation seed requires an isolated local project on port 55421 or 55621.');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const email = 'evaluator@macroflow.test';
const password = 'MacroFlow-Local-2026!';
function checked(result) { if (result.error) throw result.error; return result.data; }
const users = checked(await admin.auth.admin.listUsers({ perPage: 1000 })).users;
if (!users.some((user) => user.email === email)) {
  const { user } = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  checked(await admin.from('profiles').update({ display_name: 'Local evaluator', onboarding_completed_at: new Date().toISOString() }).eq('id', user.id));
  const accounts = [
    { login: '100001', name: 'Main trading account', count: 3, state: 'active' },
    { login: '100002', name: 'Practice account', count: 2, state: 'paused' },
    { login: '100003', name: 'Previous account', count: 1, state: 'removed' },
  ];
  for (const account of accounts) {
    const rows = Array.from({ length: account.count }, (_, i) => ({
      broker_trade_id: `demo-${account.login}-${i}`, symbol: i % 2 === 0 ? 'XAUUSD' : 'EURUSD', direction: 'long',
      entry_price: i % 2 === 0 ? 2600 : 1.08, exit_price: i % 2 === 0 ? 2610 : 1.085,
      result: i === 1 ? 'loss' : 'win', pnl_amount: i === 1 ? -25 : 50,
      commission: -2, swap: 0, sl: null, tp: null, volume: 0.1, risk_amount: 25,
      r_multiple: i === 1 ? -1 : 2, logged_at: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      closed_at: new Date(Date.now() - (i + 1) * 86400000 + 3600000).toISOString(), source: 'ea',
    }));
    checked(await admin.rpc('ingest_managed_journal', { p_user_id: user.id, p_account: { account_login: account.login, server: 'MacroFlow-Demo', currency: 'USD', ea_version: 'demo' }, p_trades: rows }));
    const saved = checked(await admin.from('broker_accounts').select('id,management_version').eq('user_id', user.id).eq('account_login', account.login).single());
    checked(await admin.rpc('manage_broker_account_v2', { p_user_id: user.id, p_account_id: saved.id, p_expected_version: saved.management_version, p_operation_id: randomUUID(), p_action: 'edit', p_display_name: account.name, p_notes: 'Sample account for local evaluation. All trades are synthetic.' }));
    if (account.state !== 'active') checked(await admin.rpc('manage_broker_account_v2', { p_user_id: user.id, p_account_id: saved.id, p_expected_version: saved.management_version + 1, p_operation_id: randomUUID(), p_action: account.state === 'paused' ? 'pause' : 'remove' }));
  }
  checked(await admin.from('trades').insert({ user_id: user.id, symbol: 'XAUUSD', direction: 'long', entry_price: 2600, notes: 'Manual sample trade. Removing a trading account leaves this trade intact.' }));
  checked(await admin.from('journal_api_keys').insert({ user_id: user.id, key_hash: createHash('sha256').update(randomBytes(32)).digest('hex'), key_prefix: 'mf_demo_' }));
  console.log('Created synthetic evaluation accounts and trades.');
} else console.log('Preserved existing local evaluator data.');
console.log(`Local evaluator: ${email} / ${password}`);
