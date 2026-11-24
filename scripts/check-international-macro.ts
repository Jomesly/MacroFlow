import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchDomesticSnapshot } from '../src/lib/api/international-fred';
import { FORECAST_VERSION } from '../src/lib/forecast';
import { buildDomesticInputs, DOMESTIC_COUNTRIES, DOMESTIC_SERIES, observationPeriodEnd } from '../src/lib/international-macro';
import { completedVintageDate } from '../src/lib/macro-context';
import { COUNTRY_NAMES } from '../src/lib/macro-coverage';
import { loadLocalEnvironment } from './lib/environment';

/** Read-only source check: no application endpoint, hosted database, or cache writes. */
async function main() {
  loadLocalEnvironment();
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY is required in the environment or .env.local.');
  const asOf = new Date().toISOString();
  const vintageDate = completedVintageDate(asOf);
  const countries = await Promise.all(DOMESTIC_COUNTRIES.map(async country => {
    const snapshot = await fetchDomesticSnapshot(country, vintageDate, apiKey);
    const result = buildDomesticInputs(snapshot, country, asOf);
    return {
      country, name: COUNTRY_NAMES[country], status: result.status,
      availableAt: snapshot.availableAt, fetchedAt: snapshot.fetchedAt,
      failedSeries: snapshot.failedSeries,
      series: DOMESTIC_SERIES[country].map(spec => {
        const latest = (snapshot.series[spec.id] ?? []).filter(row => row.date <= vintageDate)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        const contribution = result.events.find(event => event.seriesId === spec.id);
        return { id: spec.id, sourceUrl: `https://fred.stlouisfed.org/series/${spec.id}`,
          units: spec.units, frequency: spec.frequency, maxAgeDays: spec.maxAgeDays,
          observationDate: latest?.date ?? null,
          observationEnd: latest ? observationPeriodEnd(latest.date, spec.frequency) : null,
          trend: contribution?.value ?? 'no directional contribution',
          evidence: contribution?.trendEvidence ?? null };
      }),
      // These snapshots contain observation data and canonical public source identifiers only.
      snapshot,
      events: result.events,
    };
  }));

  const checkedAt = new Date().toISOString();
  const outputDirectory = path.resolve('.artifacts', 'international-macro');
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = path.join(outputDirectory, `${checkedAt.replace(/[:.]/g, '-')}.json`);
  const healthyCountries = countries.filter(country => country.status === 'ok').length;
  const report = { schemaVersion: 1, model: FORECAST_VERSION, asOf, checkedAt, vintageDate,
    healthyCountries, requiredCountries: DOMESTIC_COUNTRIES.length,
    accuracyValidated: false, countries };
  await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  for (const country of countries) {
    console.log(`${country.country}: ${country.status}; vintage ${vintageDate}; available ${country.availableAt}`);
    for (const series of country.series) {
      console.log(`  ${series.id}: ${series.observationDate ?? 'missing period'}; ${series.trend}`);
    }
  }
  console.log(JSON.stringify({ status: healthyCountries === DOMESTIC_COUNTRIES.length ? 'passed' : 'failed',
    model: FORECAST_VERSION, healthyCountries, requiredCountries: DOMESTIC_COUNTRIES.length,
    vintageDate, snapshot: outputFile, accuracyValidated: false }));
  if (healthyCountries !== DOMESTIC_COUNTRIES.length) process.exitCode = 1;
}

main().catch(error => {
  // Provider exceptions can contain credential-bearing request URLs; never echo them.
  console.error(error instanceof Error && error.message.startsWith('FRED_API_KEY')
    ? error.message : 'International economic source check failed.');
  process.exitCode = 1;
});
