import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_SYMBOLS } from '../src/lib/engine';
import { FORECAST_VERSION } from '../src/lib/forecast';
import type { BiasApiResponse } from '../src/lib/types';

async function main() {
  const urlArgument = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
  if (!urlArgument) throw new Error('Pass --url=http://localhost:3000/api/bias for the running MacroFlow app.');
  const endpoint = new URL(urlArgument);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('The forecast URL must use HTTP or HTTPS.');
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(90_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Forecast API returned HTTP ${response.status}`);
  const body = await response.json() as BiasApiResponse;
  if (!Array.isArray(body.data) || body.source === 'baseline' || body.stale) throw new Error('Live forecast data is unavailable or stale.');
  const symbols = new Set(body.data.map(result => result.symbol));
  if (body.data.length !== ALL_SYMBOLS.length || symbols.size !== ALL_SYMBOLS.length || ALL_SYMBOLS.some(symbol => !symbols.has(symbol))) {
    throw new Error('The live response must cover every supported market exactly once.');
  }
  const checkedAt = new Date().toISOString();
  for (const result of body.data) {
    const forecast = result.forecast;
    if (!forecast || forecast.modelVersion !== FORECAST_VERSION) throw new Error(`${result.symbol}: the running app uses an outdated forecast model.`);
    const issuedAt = Date.parse(forecast.issuedAt);
    const age = Date.parse(checkedAt) - issuedAt;
    if (!Number.isFinite(age) || age < -5000 || age > 300_000) throw new Error(`${result.symbol}: forecast issue time is missing, stale, or in the future.`);
    if (forecast.horizonHours !== 4 || Date.parse(forecast.expiresAt) - issuedAt !== 4 * 3_600_000) throw new Error(`${result.symbol}: invalid four-hour forecast window.`);
    const latestEvidenceAt = Date.parse(forecast.latestEvidenceAt ?? '');
    if (forecast.basis === 'unavailable' || !result.eventCount || !Number.isFinite(latestEvidenceAt) || latestEvidenceAt > issuedAt) {
      throw new Error(`${result.symbol}: no usable forecast evidence.`);
    }
    const components = Object.values(forecast.components ?? {}).filter(component => component !== null);
    if (!components.length || Math.abs(components.reduce((sum, component) => sum + component.weight, 0) - 1) > 1e-6
      || components.some(component => !Number.isFinite(component.score) || Math.abs(component.score) > 100 || !Number.isFinite(component.weight) || component.weight <= 0 || component.weight > 1)
      || Math.round(components.reduce((sum, component) => sum + component.score * component.weight, 0)) !== result.biasScore) {
      throw new Error(`${result.symbol}: invalid forecast component arithmetic.`);
    }
    if (process.argv.includes('--require-price') && (!forecast.marketMove || !forecast.components?.momentum)) {
      throw new Error(`${result.symbol}: no fresh own-market price quote.`);
    }
    if (!Number.isFinite(result.biasScore) || Math.abs(result.biasScore) > 100 || forecast.probability !== null) throw new Error(`${result.symbol}: invalid forecast score or probability claim.`);
  }
  const outputDirectory = path.resolve('.artifacts', 'forecasts');
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${checkedAt.replace(/[:.]/g, '-')}.json`);
  // A separate immutable capture preserves what was issued before outcomes are known.
  await writeFile(outputFile, JSON.stringify({ schemaVersion: 1, checkedAt, endpoint: `${endpoint.origin}${endpoint.pathname}`,
    accuracyValidated: false, response: body }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'passed', model: FORECAST_VERSION, markets: symbols.size,
    marketsWithPrice: body.data.filter(result => result.forecast?.marketMove).length,
    directionalForecasts: body.data.filter(result => result.direction !== 'neutral').length,
    checkedAt, sourceHealth: body.sourceHealth, snapshot: outputFile, accuracyValidated: false }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Live forecast check failed.'); process.exitCode = 1; });
