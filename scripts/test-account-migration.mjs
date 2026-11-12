import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = 'supabase_db_macroflow-account-eval';
const database = 'account_rehearsal_' + randomUUID().replaceAll('-', '');
const owner = randomUUID();
const docker = (args, input) => execFileSync('docker', ['exec', '-i', container, ...args], { input, encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
const sql = (command, db = database) => docker(['psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], command);
function apply(path) { return sql(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
try {
  sql(`create database ${database};`, 'postgres');
  // Reuse only local platform schema; no user rows or hosted data are copied.
  const schema = docker(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-privileges']);
  sql(schema);
  sql('drop schema public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role;');
  for (const path of ['schema.sql', 'subscribers.sql', 'journal-autosync.sql', 'signup-login.sql', 'trading-accounts.sql', 'journal-account-funds.sql', 'journal-imports.sql']) apply('supabase/' + path);
  // A pre-feature populated database exercises the original FK change and upgrade.
  sql(`insert into auth.users(id,email) values ('${owner}','migration-rehearsal@example.test');
    insert into public.trades(user_id,symbol,direction,entry_price) select '${owner}','XAUUSD','long',2600 from generate_series(1,20000);`);
  const baseStart = performance.now(); apply('supabase/account-management.sql');
  console.log(`PASS original migration over 20,000 synthetic trades: ${Math.round(performance.now() - baseStart)} ms (includes docker/psql startup)`);
  const hardeningStart = performance.now(); apply('supabase/account-management-hardening.sql');
  console.log(`PASS forward hardening migration: ${Math.round(performance.now() - hardeningStart)} ms`);
  apply('supabase/account-management-journal-compat.sql');
  sql(`select public.ingest_managed_journal('${owner}','{"account_login":"rehearsal","server":"Local"}','[]');
    select public.manage_broker_account_v2('${owner}',(select id from public.broker_accounts where user_id='${owner}'),'pause',1,'${randomUUID()}');`);
  const before = sql(`select row_to_json(b) from public.broker_accounts b where user_id='${owner}';`);
  apply('supabase/account-management-hardening.sql');
  assert.equal(sql(`select row_to_json(b) from public.broker_accounts b where user_id='${owner}';`), before);
  assert.equal(sql(`select count(*) from public.trades where user_id='${owner}';`).trim(), '20000');
  apply('supabase/account-management-journal-compat.sql');
  // SQL fixture helper has no relative includes; suitable for stdin execution.
  apply('supabase/tests/account-management.sql');
  apply('supabase/tests/account-management-journal-compat.sql');
  console.log('PASS migration rerun preserves state/receipts/data; SQL regression assertions pass');
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  sql(`drop database if exists ${database};`, 'postgres');
}
