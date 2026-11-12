import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Fixed disposable projects only. Never accepts a hosted connection string.
const releaseEvaluation = process.argv.includes('--release-evaluation');
const container = releaseEvaluation ? 'supabase_db_macroflow-account-release' : 'supabase_db_macroflow-account-eval';
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const owner = randomUUID();
const trade = randomUUID();
function sql(command) { return execFileSync('docker', args, { input: command, encoding: 'utf8', timeout: 15000 }).trim(); }
function session() {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  const waits = [];
  child.stdout.on('data', (data) => { output += data; for (const resolve of waits) resolve(); });
  child.stderr.on('data', (data) => { errors += data; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code) => resolve({ code, output, errors })); });
  return {
    send: (command) => child.stdin.write(command + '\n'),
    finish: (command = '') => { child.stdin.end(command + '\n'); return done; },
    marker: async (marker) => {
      const deadline = Date.now() + 10000;
      while (!output.includes(marker)) {
        if (Date.now() > deadline) throw new Error(`Missing ${marker}: ${errors}`);
        await Promise.race([new Promise((resolve) => waits.push(resolve)), new Promise((resolve) => setTimeout(resolve, 50))]);
      }
    },
    stop: () => child.kill(),
  };
}
const active = [];
async function held() {
  const a = session(); active.push(a);
  a.send(`set statement_timeout='10s'; begin; select public.lock_journal_owner('${owner}');\n\\echo LOCKED`);
  await a.marker('LOCKED');
  return a;
}
async function waiting(command) {
  const b = session(); active.push(b);
  b.send(`set application_name='macroflow-hardening-waiter'; set statement_timeout='10s'; ${command};`);
  const deadline = Date.now() + 5000;
  while (sql("select count(*) from pg_stat_activity where application_name='macroflow-hardening-waiter' and wait_event='advisory'") !== '1') {
    if (Date.now() > deadline) throw new Error('RPC did not wait on the owner lock');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return b;
}
try {
  sql(`insert into auth.users(id,email) values ('${owner}','concurrency-${owner}@example.test');
    select public.ingest_managed_journal('${owner}','{"account_login":"race","server":"Concurrency-Test"}','[]');
    insert into public.trades(id,user_id,broker_account_id,broker_trade_id,source,symbol,direction,entry_price)
      select '${trade}','${owner}',id,'race-ticket','ea','XAUUSD','long',2600 from public.broker_accounts where user_id='${owner}';
    select public.manage_journal_api_key('${owner}','create',p_hash=>'${owner}',p_prefix=>'race');`);
  const account = sql(`select id from public.broker_accounts where user_id='${owner}'`);
  const key = sql(`select id from public.journal_api_keys where user_id='${owner}'`);
  // Legacy row-first update must abort immediately, releasing its row lock.
  let a = await held();
  const legacy = session(); active.push(legacy);
  const result = await legacy.finish(`\\set VERBOSITY verbose\nset statement_timeout='3s'; update public.trades set notes='legacy' where id='${trade}';`);
  assert.notEqual(result.code, 0);
  assert.match(result.errors, /55P03.*JOURNAL_WRITE_BUSY/s);
  assert.doesNotMatch(result.errors, /deadlock|statement timeout/i);
  assert.equal((await a.finish(`select public.write_journal_trade('${owner}','update','${trade}','{"notes":"owner-first"}'); commit;`)).code, 0);
  console.log('PASS legacy row-first writer fails fast without deadlock');
  a = await held();
  let b = await waiting(`select public.write_journal_trade('${owner}','update','${trade}','{"notes":"after sync"}')`);
  assert.equal((await a.finish(`select public.ingest_managed_journal('${owner}','{"account_login":"race","server":"Concurrency-Test"}',
    '[{"broker_trade_id":"race-ticket","symbol":"XAUUSD","direction":"long","entry_price":2700,"exit_price":2710,"result":"win","logged_at":"2026-11-01T00:00:00Z"}]'); commit;`)).code, 0);
  assert.equal((await b.finish()).code, 0);
  assert.equal(sql(`select entry_price=2700 and notes='after sync' from public.trades where id='${trade}'`), 't');
  console.log('PASS queued partial trade edit preserves concurrent sync prices');
  // New writer waits BEFORE row locks; removal retains history, then edit succeeds.
  a = await held();
  b = await waiting(`select public.write_journal_trade('${owner}','update','${trade}','{"notes":"retained edit"}')`);
  assert.equal((await a.finish(`select public.manage_broker_account_v2('${owner}',${account},'remove',1,'${randomUUID()}'); commit;`)).code, 0);
  assert.equal((await b.finish()).code, 0);
  assert.equal(sql(`select notes from public.trades where id='${trade}'`), 'retained edit');
  console.log('PASS ordinary trade edit serializes with removal and edits retained history');
  if (releaseEvaluation) {
    a = await held();
    b = await waiting(`select public.run_managed_journal_rpc('${owner}','create_journal_account','{"p_values":{"broker_name":"Test","account_number":"queued","currency":"USD"}}')`);
    assert.equal((await a.finish('commit;')).code, 0);
    assert.equal((await b.finish()).code, 0);
    assert.equal(sql(`select count(*) from public.journal_accounts where user_id='${owner}' and account_number='queued'`), '1');
    console.log('PASS production journal wrapper waits before taking row locks');
  }
  // User key touch queued before freeze cannot write after deletion starts.
  a = await held();
  b = await waiting(`select public.manage_journal_api_key('${owner}','touch',${key},'${owner}')`);
  assert.equal((await a.finish(`select public.prepare_journal_user_deletion('${owner}'); commit;`)).code, 0);
  const frozen = await b.finish();
  assert.notEqual(frozen.code, 0); assert.match(frozen.errors, /ACCOUNT_DELETING/);
  assert.equal(sql(`select revoked_at is not null from public.journal_api_keys where id=${key}`), 't');
  console.log('PASS key touch serializes with deletion and fails closed after freeze');
  if (releaseEvaluation) {
    const blockedWrapper = session(); active.push(blockedWrapper);
    const rejected = await blockedWrapper.finish(`select public.run_managed_journal_rpc('${owner}','create_journal_account','{"p_values":{"broker_name":"Late","account_number":"late","currency":"USD"}}');`);
    assert.notEqual(rejected.code, 0); assert.match(rejected.errors, /ACCOUNT_DELETING/);
    console.log('PASS production journal wrapper rejects writes after deletion freeze');
  }
  // Rehearse safe migration failure while a reader holds the target table.
  a = session(); active.push(a);
  a.send('begin; lock table public.broker_accounts in access share mode;\n\\echo TABLE_LOCKED');
  await a.marker('TABLE_LOCKED');
  b = session(); active.push(b);
  const blocked = await b.finish(readFileSync('supabase/account-management-hardening.sql', 'utf8'));
  assert.notEqual(blocked.code, 0); assert.match(blocked.errors, /lock timeout/);
  assert.equal((await a.finish('commit;')).code, 0);
  assert.equal(sql("select to_regprocedure('public.manage_broker_account_v2(uuid,bigint,text,integer,uuid,text,text,boolean,text)') is not null"), 't');
  console.log('PASS migration lock timeout aborts safely and existing hardened RPC remains');
} finally {
  for (const connection of active) connection.stop();
  sql(`delete from auth.users where id='${owner}';`);
}
