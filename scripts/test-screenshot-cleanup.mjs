import { createClient } from '@supabase/supabase-js';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { runScreenshotCleanup } from '../supabase/functions/_shared/screenshot-cleanup.mjs';

const status = JSON.parse(readFileSync(path.join(tmpdir(), 'macroflow-screenshot-eval/status.json'), 'utf8').replace(/^\uFEFF/, ''));
if (status.API_URL !== 'http://127.0.0.1:55721') throw new Error('Cleanup tests require the isolated local screenshot project.');
const client = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#153e5b' } }).png().toBuffer();
const owner = checked(await client.auth.admin.createUser({ email: `cleanup-${randomUUID()}@example.test`, email_confirm: true })).user.id;
const paths = [];
const bucket = () => client.storage.from('journal-screenshots');
async function reserve(trade) {
  const result = checked(await client.rpc('reserve_journal_screenshot', {
    p_user_id: owner, p_trade_id: trade, p_client_upload_id: randomUUID(),
    p_content_hash: createHash('sha256').update(image).digest('hex'),
    p_mime_type: 'image/png', p_byte_size: image.length, p_width: 4, p_height: 4,
  }));
  assert.equal(result.status, 'reserved');
  paths.push(result.screenshot.object_path);
  return result.screenshot;
}
async function drainUntilDone(objectPath) {
  for (let page = 0; page < 20; page++) {
    await runScreenshotCleanup(client, bucket);
    const job = checked(await client.from('journal_screenshot_cleanup').select('completed_at').eq('object_path', objectPath).single());
    if (job.completed_at) return;
  }
  throw new Error('Cleanup did not settle within bounded local test batches');
}

try {
  const trade = checked(await client.from('trades').insert({ user_id: owner, symbol: 'XAUUSD', direction: 'long', entry_price: 2600 }).select('id').single()).id;
  const first = await reserve(trade);
  checked(await bucket().upload(first.object_path, image, { contentType: 'image/png', upsert: false }));
  const operation = { p_user_id: owner, p_trade_id: trade, p_image_id: first.id, p_upload_token: first.upload_token };
  assert.equal(checked(await client.rpc('finalize_journal_screenshot', operation)).status, 'ready');
  checked(await client.rpc('delete_journal_screenshot', { p_user_id: owner, p_trade_id: trade, p_image_id: first.id }));
  await drainUntilDone(first.object_path);
  assert.ok((await bucket().download(first.object_path)).error);
  console.log('PASS production cleanup worker removes the actual private Storage object');

  const second = await reserve(trade);
  const secondOperation = { p_user_id: owner, p_trade_id: trade, p_image_id: second.id, p_upload_token: second.upload_token };
  checked(await client.rpc('delete_journal_screenshot', { p_user_id: owner, p_trade_id: trade, p_image_id: second.id }));
  await runScreenshotCleanup(client, bucket);
  let job = checked(await client.from('journal_screenshot_cleanup').select('completed_at,available_at').eq('object_path', second.object_path).single());
  assert.equal(job.completed_at, null);
  assert.ok(Date.parse(job.available_at) > Date.now());
  checked(await bucket().upload(second.object_path, image, { contentType: 'image/png', upsert: false }));
  assert.equal(checked(await client.rpc('finalize_journal_screenshot', secondOperation)).status, 'cancelled');
  // Advance only this disposable fixture's deadline instead of sleeping 150s.
  checked(await client.from('journal_screenshot_cleanup').update({ available_at: new Date(Date.now() - 1000).toISOString() }).eq('object_path', second.object_path));
  await drainUntilDone(second.object_path);
  assert.ok((await bucket().download(second.object_path)).error);
  console.log('PASS deletion preserves the upload fence and cleans bytes that arrive after deletion');

  const third = await reserve(trade);
  checked(await bucket().upload(third.object_path, image, { contentType: 'image/png', upsert: false }));
  checked(await client.rpc('finalize_journal_screenshot', { p_user_id: owner, p_trade_id: trade, p_image_id: third.id, p_upload_token: third.upload_token }));
  checked(await client.auth.admin.deleteUser(owner));
  const retained = checked(await client.from('journal_trade_screenshots').select('state').eq('id', third.id).single());
  assert.equal(retained.state, 'deleting');
  await drainUntilDone(third.object_path);
  assert.ok((await bucket().download(third.object_path)).error);
  console.log('PASS cleanup completes without a user session after Auth deletion');
} finally {
  await client.auth.admin.deleteUser(owner);
  if (paths.length) {
    checked(await bucket().remove(paths));
    checked(await client.from('journal_trade_screenshots').delete().eq('user_id', owner));
    checked(await client.from('journal_screenshot_cleanup').delete().in('object_path', paths));
  }
}
