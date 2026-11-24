import type { AssetSymbol, EventCategory, ScoredEvent } from './types';

export interface MacroCoverage {
  requiredCountries: string[];
  coveredCountries: string[];
  missingCountries: string[];
  supportingCountries: string[];
  opposingCountries: string[];
}

type Country = 'US' | 'GB' | 'EU' | 'JP' | 'CH' | 'AU' | 'CA' | 'NZ';

export const COUNTRY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  US: 'United States', GB: 'United Kingdom', EU: 'Euro area', JP: 'Japan',
  CH: 'Switzerland', AU: 'Australia', CA: 'Canada', NZ: 'New Zealand',
});

const REQUIRED_COUNTRIES: Record<AssetSymbol, readonly Country[]> = {
  XAUUSD: ['US'], US100: ['US'], US500: ['US'], DJ30: ['US'], BTCUSD: ['US'],
  GBPUSD: ['US', 'GB'], EURUSD: ['US', 'EU'], USDJPY: ['US', 'JP'],
  USDCHF: ['US', 'CH'], AUDUSD: ['US', 'AU'], USDCAD: ['US', 'CA'], NZDUSD: ['US', 'NZ'],
};

/** Shared country dependencies for data health and structured coverage. */
export function requiredMacroCountries(symbol: AssetSymbol): readonly string[] {
  return REQUIRED_COUNTRIES[symbol];
}

const COUNTRY_ALIASES: Readonly<Record<string, Country>> = {
  US: 'US', USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US',
  GB: 'GB', UK: 'GB', 'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB',
  EU: 'EU', 'EURO AREA': 'EU', EUROZONE: 'EU', 'EUROPEAN UNION': 'EU',
  JP: 'JP', JAPAN: 'JP', CH: 'CH', SWITZERLAND: 'CH', AU: 'AU', AUSTRALIA: 'AU',
  CA: 'CA', CANADA: 'CA', NZ: 'NZ', 'NEW ZEALAND': 'NZ',
};
const ECONOMIC_CATEGORIES = new Set<EventCategory>(['inflation', 'employment', 'gdp', 'pmi', 'retail_sales']);
const POLICY_COUNTRIES: Partial<Record<EventCategory, Country>> = {
  fed_tone: 'US', boe_tone: 'GB', ecb_tone: 'EU', boj_tone: 'JP',
  snb_tone: 'CH', rba_tone: 'AU', boc_tone: 'CA', rbnz_tone: 'NZ',
};

/**
 * Minimum country coverage for a signal, not a claim that an economy's complete
 * macro backdrop is known. Only structured economic/policy observations count;
 * headlines and dollar/yield market observations cannot supply a missing economy.
 * Callers supply scored events after the scorer's source-expiry selection.
 */
export function assessMacroCoverage(symbol: AssetSymbol, events: ScoredEvent[], asOf: string, biasScore: number): MacroCoverage {
  const requiredCountries = [...REQUIRED_COUNTRIES[symbol]];
  const totals = new Map<Country, number>();
  const now = Date.parse(asOf);
  for (const event of events) {
    if (event.evidenceType !== 'trend' && event.evidenceType !== 'surprise') continue;
    if (!Number.isFinite(event.scoreChange) || event.scoreChange === 0) continue;
    const country = COUNTRY_ALIASES[event.country?.trim().toUpperCase() ?? ''];
    if (!country || !requiredCountries.includes(country)) continue;
    const policyCountry = POLICY_COUNTRIES[event.category];
    if (!ECONOMIC_CATEGORIES.has(event.category) && !policyCountry) continue;
    if (policyCountry && policyCountry !== country) continue;
    const age = now - Date.parse(event.timestamp ?? '');
    const maxAge = (event.evidenceType === 'trend' ? 48 : 24) * 3_600_000;
    if (!Number.isFinite(age) || age < 0 || age >= maxAge) continue;
    // These contributions already describe the pair's direction. Inverting the
    // domestic economy again would turn opposing evidence into false support.
    totals.set(country, (totals.get(country) ?? 0) + event.scoreChange);
  }
  const sign = Number.isFinite(biasScore) ? Math.sign(biasScore) : 0;
  return {
    requiredCountries,
    coveredCountries: requiredCountries.filter(country => totals.has(country)),
    missingCountries: requiredCountries.filter(country => !totals.has(country)),
    supportingCountries: requiredCountries.filter(country => sign * (totals.get(country) ?? 0) > 0),
    opposingCountries: requiredCountries.filter(country => sign * (totals.get(country) ?? 0) < 0),
  };
}
