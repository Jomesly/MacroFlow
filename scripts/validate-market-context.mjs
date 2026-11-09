import assert from 'node:assert/strict';

// Use a fresh Vercel preview URL for hosted proof. No production writes.
const base = new URL(process.argv[2] ?? 'http://localhost:3000').origin;
const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
const results = await Promise.allSettled(['calendar', 'macro-context'].map(async (route) => {
  const started = Date.now();
  const response = await fetch(`${base}/api/${route}`, { headers, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${route} HTTP status`);
  const body = await response.json();
  if (route === 'calendar') {
    assert.ok(body.data, 'Calendar unavailable');
    assert.deepEqual(body.data.sources.map((s) => s.name).sort(), ['BEA', 'BLS', 'ONS']);
    assert.ok(body.data.sources.every((s) => ['fresh', 'empty'].includes(s.status)), 'An agency is stale/unavailable');
    assert.ok(body.data.events.every((e) => e.forecast === null && e.previous === null && e.actual === null && Number.isFinite(Date.parse(e.date))), 'Invalid official release');
    return { route, ms: Date.now() - started, status: body.meta.status, events: body.data.events.length, sources: body.data.sources };
  }
  const two = body.treasury2y, ten = body.treasury10y;
  assert.ok(two.data && ten.data, 'Treasury observations unavailable');
  assert.equal(two.meta.observedAt, ten.meta.observedAt, 'Mismatched yield dates');
  assert.equal(two.meta.provider, 'U.S. Department of the Treasury');
  assert.equal(body.spread.data.value, Math.round((ten.data.value - two.data.value) * 10000) / 100);
  assert.equal(body.dxy.data, null, 'DXY must remain disabled');
  assert.equal(body.vix.data, null, 'VIX must remain disabled');
  assert.ok(Date.now() - Date.parse(two.meta.observedAt) <= 7 * 86_400_000, 'Observation is too old');
  return { route, ms: Date.now() - started, observedAt: two.meta.observedAt, treasury2y: two.data.value, treasury10y: ten.data.value, spreadBps: body.spread.data.value };
}));
for (const result of results) {
  if (result.status === 'fulfilled') console.log(JSON.stringify(result.value));
  else { console.error(result.reason.message); process.exitCode = 1; }
}
