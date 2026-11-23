import { createClient } from '@supabase/supabase-js';

if (process.env.SUPABASE_URL !== 'http://127.0.0.1:55721') throw new Error('Screenshot evaluation seed only accepts the disposable local project on port 55721.');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const email = 'screenshot-evaluator@macroflow.test';
const password = 'MacroFlow-Screenshots-Local-2026!';
const users = checked(await admin.auth.admin.listUsers({ perPage: 1000 })).users;
let owner = users.find(user => user.email === email);
if (!owner) owner = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user;
checked(await admin.from('profiles').update({ display_name: 'Screenshot evaluator', onboarding_completed_at: new Date().toISOString() }).eq('id', owner.id));
const trades = checked(await admin.from('trades').select('id').eq('user_id', owner.id).limit(1));
if (!trades.length) checked(await admin.from('trades').insert({
  user_id: owner.id, symbol: 'XAUUSD', direction: 'long', entry_price: 2600, exit_price: 2610,
  result: 'win', pnl_percent: 0.38, notes: 'Local screenshot sample. Open Edit, then paste a screenshot with Ctrl+V.',
}));
console.log(`Local screenshot evaluator: ${email} / ${password}`);
