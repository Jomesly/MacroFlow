import { describe, expect, it } from 'vitest';
import { runScreenshotCleanup, screenshotCleanupHandler } from '../../../supabase/functions/_shared/screenshot-cleanup.mjs';

function fixture(count = 3) {
  const objects = new Set(Array.from({ length: count }, (_, index) => `owner/trade/image-${index}`));
  const jobs = [...objects].map((object_path, index) => ({ id: `job-${index}`, object_path, claim_token: `token-${index}`, attempts: 1 }));
  const completed = new Map<string, boolean>();
  let active = 0;
  let maxActive = 0;
  let reconciled = false;
  let failPath = '';
  let staleJob = '';
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === 'reconcile_journal_screenshots') { reconciled = true; return { data: { expired: 1, orphans: 2 }, error: null }; }
      if (name === 'claim_journal_screenshot_cleanup') {
        if (!reconciled) throw new Error('must reconcile before claiming');
        return { data: jobs.slice(0, Number(args.p_limit)), error: null };
      }
      if (name === 'finish_journal_screenshot_cleanup') {
        if (args.p_job_id === staleJob) return { data: false, error: null };
        completed.set(String(args.p_job_id), Boolean(args.p_success));
        return { data: true, error: null };
      }
      throw new Error('Unexpected RPC');
    },
  };
  const bucket = () => ({
    async remove(paths: string[]) {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (paths.includes(failPath)) return { error: { message: 'provider details that must not escape' } };
      paths.forEach(path => objects.delete(path));
      return { error: null };
    },
  });
  return { client, bucket, objects, completed, get maxActive() { return maxActive; },
    fail(path: string) { failPath = path; }, stale(job: string) { staleJob = job; } };
}

describe('durable screenshot cleanup worker', () => {
  it('removes exact objects and confirms completed cleanup claims', async () => {
    const f = fixture();
    const result = await runScreenshotCleanup(f.client, f.bucket);
    expect(f.objects.size).toBe(0);
    expect([...f.completed.values()]).toEqual([true, true, true]);
    expect(result).toMatchObject({ claimed: 3, removed: 3, failed: 0, expired: 1, orphans: 2 });
  });
  it('records failed deletions for retry without exposing provider errors', async () => {
    const f = fixture(); f.fail('owner/trade/image-1');
    const result = await runScreenshotCleanup(f.client, f.bucket);
    expect(f.objects).toEqual(new Set(['owner/trade/image-1']));
    expect(f.completed.get('job-1')).toBe(false);
    expect(result).toMatchObject({ removed: 2, failed: 1 });
    expect(JSON.stringify(result)).not.toContain('provider details');
  });
  it('bounds claims and concurrency to finish before the database claim lease', async () => {
    const f = fixture(20);
    const result = await runScreenshotCleanup(f.client, f.bucket);
    expect(result.claimed).toBe(8);
    expect(f.objects.size).toBe(12);
    expect(f.maxActive).toBeLessThanOrEqual(4);
  });
  it('does not count a stale completion as a successfully settled job', async () => {
    const f = fixture(); f.stale('job-1');
    const result = await runScreenshotCleanup(f.client, f.bucket);
    expect(result).toMatchObject({ removed: 2, stale: 1 });
    expect(f.completed.has('job-1')).toBe(false);
  });
  it('retries safely when objects have already disappeared', async () => {
    const f = fixture(); f.objects.clear();
    const result = await runScreenshotCleanup(f.client, f.bucket);
    expect(result).toMatchObject({ removed: 3, failed: 0 });
  });
  it('requires a configured secret and exact authorized POST before cleanup', async () => {
    const f = fixture();
    const secret = 'a-long-local-only-secret-for-unit-tests';
    const options = { client: f.client, bucket: f.bucket, secret };
    const req = (method: string, token?: string) => new Request('http://localhost/cleanup', { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    expect((await screenshotCleanupHandler(req('GET', secret), options)).status).toBe(405);
    expect((await screenshotCleanupHandler(req('POST'), options)).status).toBe(401);
    expect((await screenshotCleanupHandler(req('POST', 'wrong'), options)).status).toBe(401);
    expect((await screenshotCleanupHandler(req('POST', secret), { ...options, secret: '' })).status).toBe(503);
    expect(f.objects.size).toBe(3);
    const result = await screenshotCleanupHandler(req('POST', secret), options);
    expect(result.status).toBe(200);
    expect(f.objects.size).toBe(0);
  });
});
