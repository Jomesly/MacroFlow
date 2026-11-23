import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { runScreenshotCleanup, screenshotCleanupHandler } from '../../supabase/functions/_shared/screenshot-cleanup.mjs';

const statusPath = process.env.MACROFLOW_SCREENSHOT_TEST_STATUS || path.join(tmpdir(), 'macroflow-screenshot-eval/status.json');
const local = JSON.parse(readFileSync(statusPath, 'utf8').replace(/^\uFEFF/, ''));
assert.equal(local.API_URL, 'http://127.0.0.1:55721', 'Only the isolated screenshot evaluator is allowed');
const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = () => client.storage.from('journal-screenshots');
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const sql = statement => execFileSync('docker', ['exec', '-i', 'supabase_db_macroflow-screenshot-eval', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', timeout: 15_000 }).trim();
const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#567890' } }).png().toBuffer();
const owner = checked(await client.auth.admin.createUser({ email: `cleanup-${randomUUID()}@example.test`, password: 'Screenshot-Cleanup-Local-2026!', email_confirm: true })).user.id;
const trade = randomUUID();
checked(await client.from('trades').insert({ id: trade, user_id: owner, symbol: 'XAUUSD', direction: 'long', entry_price: 2600, notes: 'Disposable storage-worker integration trade' }));
const create = async (ready = true) => {
  const result = checked(await client.rpc('reserve_journal_screenshot', { p_user_id: owner, p_trade_id: trade, p_client_upload_id: randomUUID(), p_content_hash: createHash('sha256').update(bytes).digest('hex'), p_mime_type: 'image/png', p_byte_size: bytes.length, p_width: 32, p_height: 24 }));
  assert.equal(result.status, 'reserved');
  const row = result.screenshot;
  checked(await bucket().upload(row.object_path, bytes, { contentType: 'image/png', upsert: false }));
  if (ready) assert.equal(checked(await client.rpc('finalize_journal_screenshot', { p_user_id: owner, p_trade_id: trade, p_image_id: row.id, p_upload_token: row.upload_token })).status, 'ready');
  return row;
};
const exists = async objectPath => !(await bucket().download(objectPath)).error;
const drain = async () => {
  for (let i = 0; i < 100; i++) { const result = await runScreenshotCleanup(client, bucket); if (!result.claimed) return; }
  throw new Error('Cleanup did not drain within its bounded local test limit');
};

try {
  await drain();
  // Exercise the upgrade with a real pre-feature fixed-slot Storage object.
  // This test project is disposable; resetting this maintenance cursor never
  // changes objects, and backfill skips every already-managed attachment.
  const legacyPath = `${owner}/${trade}/0`;
  checked(await bucket().upload(legacyPath, bytes, { contentType: 'image/png', upsert: false }));
  checked(await client.from('journal_screenshot_maintenance').update({ cursor: '', completed_at: null }).eq('name', 'legacy-backfill'));
  let done = false;
  for (let i = 0; i < 100 && !done; i++) {
    const backfill = checked(await client.rpc('backfill_journal_screenshots', { p_limit: 2 }));
    assert.deepEqual(backfill.invalid, []); done = backfill.done;
  }
  assert.equal(done, true);
  const legacy = checked(await client.from('journal_trade_screenshots').select('*').eq('object_path', legacyPath).single());
  assert.equal(legacy.state, 'ready');
  assert.equal(legacy.slot, 0);
  assert.equal(await exists(legacyPath), true);
  assert.equal(checked(await client.rpc('backfill_journal_screenshots', { p_limit: 2 })).added, 0);
  checked(await client.rpc('delete_journal_screenshot', { p_user_id: owner, p_trade_id: trade, p_image_id: legacy.id }));
  await drain();
  assert.equal(await exists(legacyPath), false);
  console.log('PASS paginated legacy backfill preserves real image bytes and is repeatable');

  const first = await create();
  const guard = await create();
  checked(await client.rpc('delete_journal_screenshot', { p_user_id: owner, p_trade_id: trade, p_image_id: first.id }));
  assert.equal(await exists(first.object_path), true);
  const failed = await runScreenshotCleanup(client, () => ({ remove: async () => ({ error: { message: 'Injected local transport outage' } }) }));
  assert.ok(failed.failed >= 1);
  const queued = checked(await client.from('journal_screenshot_cleanup').select('*').eq('object_path', first.object_path).single());
  assert.equal(queued.completed_at, null);
  assert.equal(queued.claim_token, null);
  assert.ok(Date.parse(queued.available_at) > Date.now());
  checked(await client.from('journal_screenshot_cleanup').update({ available_at: new Date(0).toISOString() }).eq('id', queued.id));
  const concurrent = await Promise.all([runScreenshotCleanup(client, bucket), runScreenshotCleanup(client, bucket)]);
  assert.equal(concurrent.reduce((sum, result) => sum + result.removed, 0), 1);
  assert.equal(await exists(first.object_path), false);
  assert.equal(await exists(guard.object_path), true);
  console.log('PASS real Storage removal retries an outage and concurrent workers claim once');

  const replacement = await create();
  assert.equal(replacement.slot, first.slot);
  assert.notEqual(replacement.object_path, first.object_path);
  checked(await client.from('journal_screenshot_cleanup').update({ completed_at: null, available_at: new Date(0).toISOString() }).eq('id', queued.id));
  await drain();
  assert.equal(await exists(replacement.object_path), true);
  console.log('PASS delayed cleanup cannot remove a replacement in the same display slot');

  // Model a very late Storage completion after an earlier deletion. Only the
  // disposable test object's metadata timestamp is advanced; production code
  // reads Storage metadata and always deletes bytes through the Storage API.
  checked(await bucket().upload(first.object_path, bytes, { contentType: 'image/png', upsert: false }));
  sql(`update storage.objects set created_at=clock_timestamp()-interval '11 minutes' where bucket_id='journal-screenshots' and name='${first.object_path}'; update public.journal_screenshot_maintenance set cursor='' where name='orphan-scan';`);
  await drain();
  assert.equal(await exists(first.object_path), false);
  assert.equal(await exists(replacement.object_path), true);
  console.log('PASS reconciliation removes a late arriving object after completed cleanup');

  const unfinished = await create(false);
  sql(`update public.journal_trade_screenshots set upload_expires_at=clock_timestamp()-interval '3 minutes' where id='${unfinished.id}';`);
  await drain();
  assert.equal(await exists(unfinished.object_path), false);
  assert.equal(checked(await client.from('journal_trade_screenshots').select('state').eq('id', unfinished.id).single()).state, 'deleting');
  console.log('PASS expired upload with stored bytes is reconciled after request-process failure');

  // Exercise missing-parent cleanup after the identity has disappeared. Cleanup
  // paths survive Auth cascades; this has no user session dependency.
  checked(await client.auth.admin.deleteUser(owner));
  await drain();
  assert.equal(await exists(guard.object_path), false);
  assert.equal(await exists(replacement.object_path), false);
  assert.equal(checked(await client.from('journal_trade_screenshots').select('state').eq('id', guard.id).single()).state, 'deleting');
  console.log('PASS Auth deletion preserves durable jobs and real bytes are removed');

  const secret = 'local-screenshot-worker-integration-secret';
  const bad = await screenshotCleanupHandler(new Request('http://localhost/cleanup', { method: 'POST' }), { client, bucket, secret });
  assert.equal(bad.status, 401);
  const good = await screenshotCleanupHandler(new Request('http://localhost/cleanup', { method: 'POST', headers: { authorization: `Bearer ${secret}` } }), { client, bucket, secret });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).failed, 0);
  console.log('PASS scheduled worker handler requires authorization and runs without feature/session state');
} finally {
  await client.auth.admin.deleteUser(owner);
  await drain();
}
