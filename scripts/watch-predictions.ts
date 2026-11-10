/** Optional foreground collector. No scheduler or background service is installed automatically. */
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { readJson } from './lib/research-models';
import path from 'node:path';
import { loadLocalEnvironment } from './lib/environment';

async function main() {
  loadLocalEnvironment();
  const out = process.argv.find(arg => arg.startsWith('--out=')) ?? '--out=data/prediction-research';
  const manifest = readJson<{ protocol: { endsAt: string } }>(path.join(out.slice(6), 'manifest.json'));
  const end = Date.parse(manifest.protocol.endsAt);
  if (!Number.isFinite(end)) throw new Error('Invalid protocol end');
  while (Date.now() < end) {
    const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'scripts/prediction-research.ts', 'capture', out], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) console.error('Hourly capture failed; the gap will remain visible.');
    const now = Date.now();
    await setTimeout(Math.max(1, Math.min(end - now, 3_600_000 - now % 3_600_000 + 1000)));
  }
}
main().catch(() => { console.error('Collector unavailable; initialize its manifest first.'); process.exitCode = 1; });
