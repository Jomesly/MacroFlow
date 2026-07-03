import { EventCategory, EventImpact, MacroEvent } from '../types';

type SentimentResult = {
  category: EventCategory;
  value: string;
  impact: EventImpact;
  title: string;
  description: string;
  country?: string;
};

const COUNTRY_SENSITIVE_CATEGORIES = new Set<EventCategory>([
  'inflation', 'employment', 'gdp', 'pmi', 'retail_sales',
]);

function inferCountry(text: string): string | undefined {
  const t = text.toLowerCase();
  const usMatch = /\b(us|united states|america|federal reserve|fed)\b/.test(t);
  const ukMatch = /\b(uk|united kingdom|britain|boe|bank of england)\b/.test(t);
  if (usMatch && !ukMatch) return 'US';
  if (ukMatch && !usMatch) return 'GB';
  return undefined;
}

const RULES: { patterns: RegExp[]; category: EventCategory; value: string; impact: EventImpact }[] = [
  // ── Fed Tone ──
  { patterns: [/fed\s*(cut|dovish|ease|lower|pause|hold)/i], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [/fed\s*(hike|hawkish|tighten|raise|taper)/i], category: 'fed_tone', value: 'hawkish', impact: 'high' },
  { patterns: [/federal reserve.*(dovish|cut|ease)/i], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [/federal reserve.*(hawkish|hike|tighten)/i], category: 'fed_tone', value: 'hawkish', impact: 'high' },

  // ── BoE Tone ──
  { patterns: [/bank of england.*(dovish|cut|ease|hold)/i], category: 'boe_tone', value: 'dovish', impact: 'high' },
  { patterns: [/bank of england.*(hawkish|hike|tighten)/i], category: 'boe_tone', value: 'hawkish', impact: 'high' },
  { patterns: [/boe.*(dovish|cut|ease)/i], category: 'boe_tone', value: 'dovish', impact: 'medium' },
  { patterns: [/boe.*(hawkish|hike|tighten)/i], category: 'boe_tone', value: 'hawkish', impact: 'medium' },

  // ── Generic Central Bank (defaults to Fed for US-centric assets) ──
  // Only matches when no non-Fed central bank is named in the text
  { patterns: [/central bank.*(cut|ease|dovish|lower|hold)/i], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [/central bank.*(hike|raise|hawkish|tighten)/i], category: 'fed_tone', value: 'hawkish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*rate (cut|ease|lower|dovish|hold)`, 'i')], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*rate (hike|rise|raise|hawkish|tighten)`, 'i')], category: 'fed_tone', value: 'hawkish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*interest rate.*(cut|lower|ease|hold)`, 'i')], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*interest rate.*(hike|rise|raise|tighten)`, 'i')], category: 'fed_tone', value: 'hawkish', impact: 'high' },

  // ── Inflation ──
  { patterns: [/cpi.*(high|hot|beat|rise|up|surge|climb)/i], category: 'inflation', value: 'high', impact: 'high' },
  { patterns: [/cpi.*(low|cool|miss|fall|drop|down|slide)/i], category: 'inflation', value: 'low', impact: 'high' },
  { patterns: [/inflation.*(high|hot|rise|up|surge|sticky|climb)/i], category: 'inflation', value: 'high', impact: 'high' },
  { patterns: [/inflation.*(low|cool|moderate|fall|drop|down|slow)/i], category: 'inflation', value: 'low', impact: 'high' },
  { patterns: [/core.*(cpi|inflation).*(rise|up|beat|hot)/i], category: 'inflation', value: 'high', impact: 'high' },
  { patterns: [/core.*(cpi|inflation).*(fall|drop|miss|cool|low)/i], category: 'inflation', value: 'low', impact: 'high' },
  { patterns: [/pp[iI].*(rise|up|beat|high)/i], category: 'inflation', value: 'high', impact: 'medium' },
  { patterns: [/pp[iI].*(fall|drop|miss|low)/i], category: 'inflation', value: 'low', impact: 'medium' },

  // ── Employment ──
  { patterns: [/(nonfarm|payroll|nfp).*(beat|strong|rise|surge|up)/i], category: 'employment', value: 'strong', impact: 'high' },
  { patterns: [/(nonfarm|payroll|nfp).*(miss|weak|fall|drop|disappoint)/i], category: 'employment', value: 'weak', impact: 'high' },
  { patterns: [/unemployment.*(low|fall|drop|down)/i], category: 'employment', value: 'strong', impact: 'medium' },
  { patterns: [/unemployment.*(high|rise|up|climb)/i], category: 'employment', value: 'weak', impact: 'medium' },
  { patterns: [/jobless claims.*(rise|up|high|climb)/i], category: 'employment', value: 'weak', impact: 'medium' },
  { patterns: [/jobless claims.*(fall|drop|down|low)/i], category: 'employment', value: 'strong', impact: 'medium' },
  { patterns: [/jobs.*(beat|strong|surge|up)/i], category: 'employment', value: 'strong', impact: 'medium' },
  { patterns: [/jobs.*(miss|weak|fall|drop|disappoint)/i], category: 'employment', value: 'weak', impact: 'medium' },

  // ── GDP ──
  { patterns: [/gdp.*(beat|above|strong|up|revised.*up|growth)/i], category: 'gdp', value: 'beat', impact: 'high' },
  { patterns: [/gdp.*(miss|below|weak|down|contraction|revised.*down)/i], category: 'gdp', value: 'miss', impact: 'high' },
  { patterns: [/economic.*(growth|expansion|strong)/i], category: 'gdp', value: 'beat', impact: 'medium' },
  { patterns: [/economic.*(slow|contraction|weak|recession)/i], category: 'gdp', value: 'miss', impact: 'medium' },
  { patterns: [/recession/i], category: 'gdp', value: 'miss', impact: 'high' },

  // ── PMI ──
  { patterns: [/pmi.*(beat|above|expansion|strong|rise|up)/i], category: 'pmi', value: 'beat', impact: 'medium' },
  { patterns: [/pmi.*(miss|below|contraction|weak|fall|drop)/i], category: 'pmi', value: 'miss', impact: 'medium' },
  { patterns: [/manufacturing.*(expansion|strong|grow)/i], category: 'pmi', value: 'beat', impact: 'medium' },
  { patterns: [/manufacturing.*(contraction|weak|slow)/i], category: 'pmi', value: 'miss', impact: 'medium' },
  { patterns: [/services.*(pmi|sector).*(expansion|strong|grow)/i], category: 'pmi', value: 'beat', impact: 'medium' },
  { patterns: [/services.*(pmi|sector).*(contraction|weak|slow)/i], category: 'pmi', value: 'miss', impact: 'medium' },

  // ── Retail Sales ──
  { patterns: [/retail sales.*(beat|up|rise|strong|surge)/i], category: 'retail_sales', value: 'beat', impact: 'medium' },
  { patterns: [/retail sales.*(miss|down|fall|weak|drop)/i], category: 'retail_sales', value: 'miss', impact: 'medium' },
  { patterns: [/consumer.*spend.*(up|rise|strong)/i], category: 'retail_sales', value: 'beat', impact: 'low' },
  { patterns: [/consumer.*spend.*(down|fall|weak)/i], category: 'retail_sales', value: 'miss', impact: 'low' },

  // ── Risk Sentiment ──
  { patterns: [/safe.?haven|risk.?off|turmoil|crisis|fear|panic/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/risk.?on|rally|optimism|bullish|euphoria/i], category: 'risk_sentiment', value: 'risk_on', impact: 'high' },
  { patterns: [/market.*(fear|plunge|sell.?off|crash|turmoil|retreat|decline)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/market.*(rally|surge|climb|optimism|rebound|gains|advance|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/stock.*(fall|drop|plunge|sell.?off|decline|retreat)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/stock.*(rally|surge|climb|gain|rise|advance)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/(equities|shares).*(fall|drop|plunge|decline)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },
  { patterns: [/(equities|shares).*(rally|surge|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/wall.?street.*(lower|fall|drop|decline)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/wall.?street.*(higher|rise|rally|gain)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'high' },
  { patterns: [/trade.*(war|tension|escalat)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/trade.*(deal|truce|agreement)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/safe haven|safe-haven/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },

  // ── Dollar Strength (additional generic patterns) ──
  { patterns: [/(usd|dollar).*(pressure|retreat|slip|soft|ease)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/(usd|dollar).*(strength|support|firm|gain|climb)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/(pound|sterling|cable).*(gain|rise|rally|strong)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/(pound|sterling|cable).*(fall|drop|weak|decline)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/(euro|eur).*(gain|rise|rally|strong)/i], category: 'dollar_strength', value: 'weak', impact: 'low' },
  { patterns: [/(euro|eur).*(fall|drop|weak|decline)/i], category: 'dollar_strength', value: 'strong', impact: 'low' },
  { patterns: [/(forex|currency).*(dollar|usd).*(weak|lower|soft)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/(forex|currency).*(dollar|usd).*(strong|higher|firm)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },

  // ── Yields (additional) ──
  { patterns: [/(treasuries|bonds).*(sell.?off|yield.*up)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/(treasuries|bonds).*(rally|yield.*down)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/yield.*(curve|spread).*(steepen|widen)/i], category: 'yields', value: 'rising', impact: 'low' },
  { patterns: [/yield.*(curve|spread).*(flatten|narrow)/i], category: 'yields', value: 'falling', impact: 'low' },

  // ── Gold-specific ──
  { patterns: [/gold.*(price|demand|buying|safe).*(rise|surge|climb|rally|gain)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },
  { patterns: [/gold.*(drop|fall|decline|slide|retreat)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'low' },
  { patterns: [/(xau|gold).*(usd|dollar)/i], category: 'dollar_strength', value: 'weak', impact: 'low' },

  // ── Bitcoin/Crypto specific ──
  { patterns: [/bitcoin.*(surge|rally|climb|gain|rise|bull)/i], category: 'crypto_regulation', value: 'positive', impact: 'medium' },
  { patterns: [/bitcoin.*(drop|crash|fall|decline|bear)/i], category: 'crypto_regulation', value: 'negative', impact: 'medium' },
  { patterns: [/(crypto|digital asset).*(surge|rally|gain|rise)/i], category: 'crypto_regulation', value: 'positive', impact: 'medium' },
  { patterns: [/(crypto|digital asset).*(crash|drop|fall|decline)/i], category: 'crypto_regulation', value: 'negative', impact: 'medium' },

  // ── Geopolitical ──
  { patterns: [/geopolitical.*(tension|risk|escalat|conflict|war)/i], category: 'geopolitical', value: 'tension', impact: 'high' },
  { patterns: [/sanction.*(new|escalat|tighten)/i], category: 'geopolitical', value: 'tension', impact: 'medium' },
  { patterns: [/sanction.*(ease|lift|remove)/i], category: 'geopolitical', value: 'easing', impact: 'medium' },
  { patterns: [/(ceasefire|truce|peace).*(deal|agreement)/i], category: 'geopolitical', value: 'easing', impact: 'medium' },

  // ── Dollar Strength ──
  { patterns: [/dollar.*(surge|rally|strength|climb|up|bullish)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/dollar.*(weak|slide|fall|drop|down|retreat)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/(dxy|usd index).*(up|high|rise|surge)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/(dxy|usd index).*(down|low|fall|drop)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/greenback.*(strong|surge|rally|climb)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/greenback.*(weak|slide|fall|drop)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },

  // ── Yields ──
  { patterns: [/yield.*(surge|spike|rise|climb|up|jump)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/yield.*(fall|drop|slide|down|plunge|tumble)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/treasury.*(yield|rate).*(up|rise|high|climb)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/treasury.*(yield|rate).*(down|fall|drop|low)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/bond.*(sell.?off|yield.*up|rate.*rise)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/bond.*(rally|yield.*down|rate.*fall)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/10.?year.*(rise|up|climb|jump)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/10.?year.*(fall|drop|down|slide)/i], category: 'yields', value: 'falling', impact: 'medium' },

  // ── Crypto Regulation ──
  { patterns: [/sec.*(approve|approval|greenlight|allow)/i], category: 'crypto_regulation', value: 'positive', impact: 'high' },
  { patterns: [/sec.*(reject|deny|crack.?down|sue|suit|penalty)/i], category: 'crypto_regulation', value: 'negative', impact: 'high' },
  { patterns: [/crypto.*(etf|approve|regulation.*clear)/i], category: 'crypto_regulation', value: 'positive', impact: 'high' },
  { patterns: [/crypto.*(ban|crack.?down|restrict|regulate)/i], category: 'crypto_regulation', value: 'negative', impact: 'high' },
  { patterns: [/bitcoin.*(etf|approve|institutional)/i], category: 'crypto_regulation', value: 'positive', impact: 'high' },
  { patterns: [/bitcoin.*(ban|restrict|crack.?down)/i], category: 'crypto_regulation', value: 'negative', impact: 'high' },
  { patterns: [/regulatory.*(clear|approve|greenlight)/i], category: 'crypto_regulation', value: 'positive', impact: 'medium' },
  { patterns: [/regulatory.*(crack.?down|restrict|tighten)/i], category: 'crypto_regulation', value: 'negative', impact: 'medium' },

  // ── Nasdaq / Tech specific ──
  { patterns: [/(nasdaq|tech stock|technology).*(rally|surge|climb|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/(nasdaq|tech stock|technology).*(fall|drop|decline|retreat|plunge)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },
  { patterns: [/(dow|djia|industrial).*(rally|surge|climb|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/(dow|djia|industrial).*(fall|drop|decline|retreat|plunge)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },
  { patterns: [/(s&p|sp500|index).*(record|high|rally|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/(s&p|sp500|index).*(fall|drop|decline|retreat|plunge)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },

  // ── Earnings ──
  { patterns: [/earnings.*(beat|surge|above|record|strong|positive)/i], category: 'earnings', value: 'positive', impact: 'high' },
  { patterns: [/earnings.*(miss|below|weak|disappoint|negative)/i], category: 'earnings', value: 'negative', impact: 'high' },
  { patterns: [/profit.*(beat|surge|above|record|rise)/i], category: 'earnings', value: 'positive', impact: 'medium' },
  { patterns: [/profit.*(miss|fall|below|decline|drop)/i], category: 'earnings', value: 'negative', impact: 'medium' },
  { patterns: [/tech.*(earnings|profit|revenue).*(beat|surge|record)/i], category: 'earnings', value: 'positive', impact: 'high' },
  { patterns: [/tech.*(earnings|profit|revenue).*(miss|decline|drop)/i], category: 'earnings', value: 'negative', impact: 'high' },
  { patterns: [/(apple|google|microsoft|amazon|meta|nvidia).*(earnings|profit|revenue).*(beat|surge|growth)/i], category: 'earnings', value: 'positive', impact: 'high' },
  { patterns: [/(apple|google|microsoft|amazon|meta|nvidia).*(miss|weak|decline|drop)/i], category: 'earnings', value: 'negative', impact: 'high' },
];

export function classifyHeadline(text: string): SentimentResult[] {
  const seen = new Set<string>();
  const results: SentimentResult[] = [];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        const key = `${rule.category}:${rule.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            category: rule.category,
            value: rule.value,
            impact: rule.impact,
            title: text.length > 80 ? text.slice(0, 77) + '...' : text,
            description: text,
            country: COUNTRY_SENSITIVE_CATEGORIES.has(rule.category) ? inferCountry(text) : undefined,
          });
        }
      }
    }
  }
  return results;
}

export function createEventFromClassification(
  classified: SentimentResult,
  source: string,
  url?: string
): MacroEvent {
  const id = `live-${source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    category: classified.category,
    title: classified.title,
    description: classified.description,
    timestamp: new Date().toISOString(),
    impact: classified.impact,
    value: classified.value,
    country: classified.country,
    url,
    sourceName: source,
  };
}

export function classifyEconomicEvent(
  eventName: string,
  actual: number | null,
  forecast: number | null
): { category: EventCategory; value: string } | null {
  // Skip events with no actual data — they haven't occurred yet
  if (actual === null) return null;

  const name = eventName.toLowerCase();

  const isBeat = forecast !== null ? actual >= forecast : null;

  if (/cpi|inflation|core/i.test(name)) {
    return { category: 'inflation', value: isBeat === true ? 'high' : isBeat === false ? 'low' : 'high' };
  }
  if (/nonfarm|payroll|employment|unemployment|jobless|jobs/i.test(name)) {
    if (/unemployment|jobless/i.test(name)) {
      return { category: 'employment', value: isBeat === true ? 'weak' : isBeat === false ? 'strong' : 'strong' };
    }
    return { category: 'employment', value: isBeat === true ? 'strong' : isBeat === false ? 'weak' : 'strong' };
  }
  if (/gdp/i.test(name)) {
    return { category: 'gdp', value: isBeat === true ? 'beat' : isBeat === false ? 'miss' : 'beat' };
  }
  if (/pmi|manufacturing|services/i.test(name)) {
    return { category: 'pmi', value: isBeat === true ? 'beat' : isBeat === false ? 'miss' : 'beat' };
  }
  if (/retail sales|consumer|spending/i.test(name)) {
    return { category: 'retail_sales', value: isBeat === true ? 'beat' : isBeat === false ? 'miss' : 'beat' };
  }
  if (/fed|interest rate|central bank/i.test(name)) {
    if (/cut|lower|ease|dovish|hold/i.test(name)) {
      return { category: 'fed_tone', value: 'dovish' };
    }
    if (/hike|raise|tighten|hawkish/i.test(name)) {
      return { category: 'fed_tone', value: 'hawkish' };
    }
    return { category: 'fed_tone', value: 'dovish' };
  }

  return null;
}
