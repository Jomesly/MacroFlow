import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// Fixed disposable project: never accepts a hosted connection or arbitrary container.
const container = 'supabase_db_macroflow-screenshot-eval';
const args = ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const owner = randomUUID();
const appName = `screenshot-${randomUUID()}`;
const active = [];
function sql(command) { return execFileSync('docker', args, { input: command, encoding: 'utf8', timeout: 15_000 }).trim(); }
function session() {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '';
  const changed = new Set();
  child.stdout.on('data', chunk => { output += chunk; for (const resolve of changed) resolve(); });
  child.stderr.on('data', chunk => { errors += chunk; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, output, errors })); });
  const result = {
    send(command) { child.stdin.write(command + '\n'); },
    finish(command = '') { child.stdin.end(command + '\n'); return done; },
    async marker(marker) {
      const deadline = Date.now() + 10_000;
      while (!output.includes(marker)) {
        if (Date.now() > deadline) throw new Error(`Missing marker ${marker}: ${errors}`);
        await new Promise(resolve => { changed.add(resolve); setTimeout(() => { changed.delete(resolve); resolve(); }, 30); });
      }
    },
    stop() { child.kill(); },
  };
  active.push(result);
  return result;
}
async function held() {
  const a = session();
  a.send(`set statement_timeout='10s'; begin; select public.lock_journal_owner('${owner}');\n\\echo LOCKED`);
  await a.marker('LOCKED');
  return a;
}
async function waiting(command) {
  const b = session();
  b.send(`set application_name='${appName}'; set statement_timeout='10s'; ${command};`);
  const deadline = Date.now() + 5_000;
  while (sql(`select count(*) from pg_stat_activity where application_name='${appName}' and wait_event='advisory'`) !== '1') {
    if (Date.now() > deadline) throw new Error('Screenshot RPC did not wait for the owner lock');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  return b;
}
function reserve(trade) {
  return `select public.reserve_journal_screenshot('${owner}','${trade}','${randomUUID()}','${'a'.repeat(64)}','image/png',100,10,10)`;
}
function finalize(trade, s) {
  return `select public.finalize_journal_screenshot('${owner}','${trade}','${s.id}','${s.upload_token}')`;
}
function createTrade() {
  const trade = randomUUID();
  sql(`insert into public.trades(id,user_id,symbol,direction,entry_price) values('${trade}','${owner}','XAUUSD','long',2600)`);
  return trade;
}
try {
  sql(`insert into auth.users(id,email) values('${owner}','race-${owner}@example.test')`);
  let trade = createTrade();
  let s = JSON.parse(sql(reserve(trade))).screenshot;
  let a = await held();
  let b = await waiting(finalize(trade, s));
  assert.equal((await a.finish(`select public.write_journal_trade('${owner}','delete','${trade}'); commit;`)).code, 0);
  let result = await b.finish();
  assert.equal(result.code, 0, result.errors);
  assert.equal(JSON.parse(result.output).status, 'cancelled');
  assert.equal(sql(`select count(*) from public.journal_screenshot_cleanup where object_path='${s.object_path}'`), '1');
  console.log('PASS upload finalization waits behind trade deletion, rejects it, and retains cleanup');

  trade = createTrade();
  a = await held();
  b = await waiting(reserve(trade));
  assert.equal((await a.finish(`select public.write_journal_trade('${owner}','delete','${trade}'); commit;`)).code, 0);
  result = await b.finish();
  assert.notEqual(result.code, 0);
  assert.match(result.errors, /TRADE_NOT_FOUND/);
  assert.doesNotMatch(result.errors, /deadlock|statement timeout/i);
  console.log('PASS reservation queued behind deletion cannot write Storage afterwards');

  trade = createTrade();
  s = JSON.parse(sql(reserve(trade))).screenshot;
  a = await held();
  const legacy = session();
  result = await legacy.finish(`set statement_timeout='3s'; delete from public.trades where id='${trade}'`);
  assert.notEqual(result.code, 0);
  assert.match(result.errors, /JOURNAL_WRITE_BUSY/);
  assert.doesNotMatch(result.errors, /deadlock|statement timeout/i);
  assert.equal((await a.finish(`${finalize(trade, s)}; commit;`)).code, 0);
  assert.equal(sql(`select state from public.journal_trade_screenshots where id='${s.id}'`), 'ready');
  console.log('PASS direct row-first deletion fails promptly without deadlocking upload finalization');

  trade = createTrade();
  s = JSON.parse(sql(reserve(trade))).screenshot;
  a = await held();
  b = await waiting(finalize(trade, s));
  assert.equal((await a.finish(`select public.prepare_journal_user_deletion('${owner}'); commit;`)).code, 0);
  result = await b.finish();
  assert.equal(result.code, 0, result.errors);
  assert.equal(JSON.parse(result.output).status, 'cancelled');
  sql(`delete from auth.users where id='${owner}'`);
  assert.equal(sql(`select state from public.journal_trade_screenshots where id='${s.id}'`), 'deleting');
  console.log('PASS pending user deletion fences queued finalization and Auth cascade preserves tombstones');
} finally {
  for (const worker of active) worker.stop();
  sql(`delete from auth.users where id='${owner}'; delete from public.journal_trade_screenshots where user_id='${owner}'; delete from public.journal_screenshot_cleanup where object_path like '${owner}/%';`);
}
