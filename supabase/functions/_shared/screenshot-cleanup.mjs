/**
 * Runtime-neutral worker used by the Edge Function and local integration tests.
 * The bucket factory must give each Storage operation a deadline <= 30 seconds.
 * Eight claims in two waves leave room for finalization inside a two-minute lease.
 */
export async function runScreenshotCleanup(client, bucket) {
  const reconciled = await client.rpc('reconcile_journal_screenshots', { p_limit: 100 });
  if (reconciled.error) throw new Error('Screenshot reconciliation unavailable');
  const claimed = await client.rpc('claim_journal_screenshot_cleanup', { p_limit: 8 });
  if (claimed.error) throw new Error('Screenshot cleanup queue unavailable');
  const jobs = claimed.data ?? [];
  const result = { expired: reconciled.data?.expired ?? 0, orphans: reconciled.data?.orphans ?? 0,
    claimed: jobs.length, removed: 0, failed: 0, stale: 0 };
  let cursor = 0;
  async function process() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      let success = false;
      try {
        const response = await bucket().remove([job.object_path]);
        success = !response.error;
      } catch { /* A transport failure remains retryable through the outbox. */ }
      try {
        const completion = await client.rpc('finish_journal_screenshot_cleanup', {
          p_job_id: job.id, p_claim_token: job.claim_token, p_success: success,
        });
        if (completion.error) result.failed++;
        else if (!completion.data) result.stale++;
        else if (success) result.removed++;
        else result.failed++;
      } catch { result.failed++; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, process));
  return result;
}

async function authorized(header, secret) {
  if (!header?.startsWith('Bearer ')) return false;
  const encode = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(header.slice(7))),
    crypto.subtle.digest('SHA-256', encode.encode(secret)),
  ]);
  const left = new Uint8Array(actual);
  const right = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function screenshotCleanupHandler(request, { client, bucket, secret }) {
  const respond = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  if (!secret || secret.length < 32) return respond({ error: 'Screenshot cleanup is not configured' }, 503);
  if (!await authorized(request.headers.get('authorization'), secret)) return respond({ error: 'Unauthorized' }, 401);
  try { return respond(await runScreenshotCleanup(client, bucket), 200); }
  catch { return respond({ error: 'Screenshot cleanup is temporarily unavailable' }, 503); }
}
