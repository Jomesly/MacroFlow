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

const POLICY_CATEGORIES = new Set<EventCategory>(['fed_tone', 'boe_tone']);

/** Chart commentary describes price, not macro, so it carries no fundamental signal. */
const TECHNICAL_ARTICLE = /\b(price (forecast|prediction|analysis)|technical (analysis|outlook)|elliott wave)\b/i;

/** A policy move that is denied, doubted or being priced out is not that move. */
const POLICY_NEGATION = /\b(no|not|unlikely|won'?t|doubts?|fad(e|es|ing)|scal(e|es|ing) back|pare[sd]?|paring|delay(s|ed|ing)?|push(es|ed|ing)? back|rul(e|es|ed|ing) out|less likely|against)\b/i;
const NEGATION_WINDOW = 30;

const FOREIGN_EQUITY = /\b(asia|asian|china|chinese|japan|japanese|nikkei|hang seng|taiwan|taiwanese|taiex|korea|korean|kospi|india|indian|sensex|europe|european|ftse|stoxx|dax|cac)\b.{0,40}\b(stocks?|shares|equities|markets?|index|indices)\b/i;
const GLOBAL_EQUITY = /\b(wall street|s&p|nasdaq|dow|global|world)\b/i;

const FOREIGN_REGIONS: [string, RegExp][] = [
  ['EU', /\b(euro\s?zone|euro area|european union|ecb|germany|german|france|french|italy|italian|spain|spanish)\b/i],
  ['JP', /\b(japan|japanese|boj|bank of japan)\b/i],
  ['CN', /\b(china|chinese|pboc|beijing)\b/i],
  ['CA', /\b(canada|canadian|bank of canada)\b/i],
  ['AU', /\b(australia|australian|rba)\b/i],
  ['CH', /\b(switzerland|swiss|snb)\b/i],
  ['OTHER', /\b(india|indian|korea|korean|taiwan|brazil|mexico|turkey|turkish|russia|russian)\b/i],
];

function inferCountry(text: string): string | undefined {
  // Require capitalized "US" to avoid matching the pronoun "us" (e.g. "surprises us")
  const regions: string[] = [];
  if (/\bUS\b|\bU\.S\./.test(text) || /\b(united states|america|federal reserve|fed)\b/i.test(text)) regions.push('US');
  if (/\b(uk|united kingdom|britain|boe|bank of england)\b/i.test(text)) regions.push('GB');
  for (const [code, pattern] of FOREIGN_REGIONS) {
    if (pattern.test(text)) regions.push(code);
  }
  if (regions.length > 1) return 'MIXED';
  return regions[0];
}

const RULES: { patterns: RegExp[]; category: EventCategory; value: string; impact: EventImpact }[] = [
  // ── Fed Tone ──
  { patterns: [/\bfed\s*(cut|dovish|ease|lower)/i], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [/\bfed\s*(hike|hawkish|tighten|raise|taper)/i], category: 'fed_tone', value: 'hawkish', impact: 'high' },
  { patterns: [/federal reserve.{0,40}\b(dovish|cut|ease)/i], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [/federal reserve.{0,40}\b(hawkish|hike|tighten)/i], category: 'fed_tone', value: 'hawkish', impact: 'high' },

  // ── BoE Tone ──
  { patterns: [/bank of england.{0,40}\b(dovish|cut|ease)/i], category: 'boe_tone', value: 'dovish', impact: 'high' },
  { patterns: [/bank of england.{0,40}\b(hawkish|hike|tighten)/i], category: 'boe_tone', value: 'hawkish', impact: 'high' },
  { patterns: [/\bboe\b.{0,40}\b(dovish|cut|ease)/i], category: 'boe_tone', value: 'dovish', impact: 'medium' },
  { patterns: [/\bboe\b.{0,40}\b(hawkish|hike|tighten)/i], category: 'boe_tone', value: 'hawkish', impact: 'medium' },

  // ── Generic Central Bank (defaults to Fed for US-centric assets) ──
  // Only matches when no non-Fed central bank is named in the text
  { patterns: [/central bank.{0,40}\b(cut|ease|dovish|lower)/i], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [/central bank.{0,40}\b(hike|raise|hawkish|tighten)/i], category: 'fed_tone', value: 'hawkish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*\\brate (cut|ease|lower|dovish)`, 'i')], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*\\brate (hike|rise|raise|hawkish|tighten)`, 'i')], category: 'fed_tone', value: 'hawkish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*interest rate.{0,40}\\b(cut|lower|ease)`, 'i')], category: 'fed_tone', value: 'dovish', impact: 'high' },
  { patterns: [new RegExp(`^(?!.*\\b(bank of england|boe|ecb|european central bank|boj|bank of japan|rba|reserve bank of australia|pboc|people's bank of china|snb|swiss national bank|bank of canada|boc)\\b).*interest rate.{0,40}\\b(hike|rise|raise|tighten)`, 'i')], category: 'fed_tone', value: 'hawkish', impact: 'high' },

  // ── Inflation ──
  { patterns: [/\bcpi\b.{0,40}\b(high|hot|beat|rise|up\b|surge|climb)/i], category: 'inflation', value: 'high', impact: 'high' },
  { patterns: [/\bcpi\b.{0,40}\b(low|cool|miss|fall|drop|down\b|slide)/i], category: 'inflation', value: 'low', impact: 'high' },
  { patterns: [/\binflation\b.{0,40}\b(high|hot|rise|up\b|surge|sticky|climb)/i], category: 'inflation', value: 'high', impact: 'high' },
  { patterns: [/\binflation\b.{0,40}\b(low|cool|moderate|fall|drop|down\b|slow)/i], category: 'inflation', value: 'low', impact: 'high' },
  { patterns: [/\b(eas|cool|soften|tam)\w*\b.{0,25}\binflation\b/i], category: 'inflation', value: 'low', impact: 'high' },
  { patterns: [/\bcore\b.{0,40}\b(cpi|inflation)\b.{0,40}\b(rise|up\b|beat|hot)/i], category: 'inflation', value: 'high', impact: 'high' },
  { patterns: [/\bcore\b.{0,40}\b(cpi|inflation)\b.{0,40}\b(fall|drop|miss|cool|low)/i], category: 'inflation', value: 'low', impact: 'high' },
  { patterns: [/\bppi\b.{0,40}\b(rise|up\b|beat|high)/i], category: 'inflation', value: 'high', impact: 'medium' },
  { patterns: [/\bppi\b.{0,40}\b(fall|drop|miss|low)/i], category: 'inflation', value: 'low', impact: 'medium' },

  // ── Employment ──
  { patterns: [/\b(nonfarm|payroll|nfp).{0,40}\b(beat|strong|rise|surge|up\b)/i], category: 'employment', value: 'strong', impact: 'high' },
  { patterns: [/\b(nonfarm|payroll|nfp).{0,40}\b(miss|weak|fall|drop|disappoint)/i], category: 'employment', value: 'weak', impact: 'high' },
  { patterns: [/\bunemployment\b.{0,40}\b(low|fall|drop|down\b)/i], category: 'employment', value: 'strong', impact: 'medium' },
  { patterns: [/\bunemployment\b.{0,40}\b(high|rise|up\b|climb)/i], category: 'employment', value: 'weak', impact: 'medium' },
  { patterns: [/\bjobless claims\b.{0,40}\b(rise|up\b|high|climb)/i], category: 'employment', value: 'weak', impact: 'medium' },
  { patterns: [/\bjobless claims\b.{0,40}\b(fall|drop|down\b|low)/i], category: 'employment', value: 'strong', impact: 'medium' },
  { patterns: [/\bjobs\b.{0,40}\b(beat|strong|surge|up\b)/i], category: 'employment', value: 'strong', impact: 'medium' },
  { patterns: [/\bjobs\b.{0,40}\b(miss|weak|fall|drop|disappoint)/i], category: 'employment', value: 'weak', impact: 'medium' },

  // ── GDP ──
  { patterns: [/\bgdp\b.{0,40}\b(beat|above|strong|up\b|revised.*up\b|growth)/i], category: 'gdp', value: 'beat', impact: 'high' },
  { patterns: [/\bgdp\b.{0,40}\b(miss|below|weak|down\b|contraction|revised.*down\b)/i], category: 'gdp', value: 'miss', impact: 'high' },
  { patterns: [/\beconomic\b.{0,40}\b(growth|expansion|strong)/i], category: 'gdp', value: 'beat', impact: 'medium' },
  { patterns: [/\beconomic\b.{0,40}\b(slow|contraction|weak|recession)/i], category: 'gdp', value: 'miss', impact: 'medium' },
  { patterns: [/\brecession\b(?!.{0,30}\b(ease|eases|easing|fade|fades|fading|recede|recedes|averted|avoid))/i], category: 'gdp', value: 'miss', impact: 'high' },

  // ── PMI ──
  { patterns: [/\bpmi\b.{0,40}\b(beat|above|expansion|strong|rise|up\b)/i], category: 'pmi', value: 'beat', impact: 'medium' },
  { patterns: [/\bpmi\b.{0,40}\b(miss|below|contraction|weak|fall|drop)/i], category: 'pmi', value: 'miss', impact: 'medium' },
  { patterns: [/\bmanufacturing\b.{0,40}\b(expansion|strong|grow)/i], category: 'pmi', value: 'beat', impact: 'medium' },
  { patterns: [/\bmanufacturing\b.{0,40}\b(contraction|weak|slow)/i], category: 'pmi', value: 'miss', impact: 'medium' },
  { patterns: [/\bservices\b.{0,40}\b(pmi|sector)\b.{0,40}\b(expansion|strong|grow)/i], category: 'pmi', value: 'beat', impact: 'medium' },
  { patterns: [/\bservices\b.{0,40}\b(pmi|sector)\b.{0,40}\b(contraction|weak|slow)/i], category: 'pmi', value: 'miss', impact: 'medium' },

  // ── Retail Sales ──
  { patterns: [/\bretail sales\b.{0,40}\b(beat|up\b|rise|strong|surge)/i], category: 'retail_sales', value: 'beat', impact: 'medium' },
  { patterns: [/\bretail sales\b.{0,40}\b(miss|down\b|fall|weak|drop)/i], category: 'retail_sales', value: 'miss', impact: 'medium' },
  { patterns: [/\bconsumer\b.*\bspend.{0,40}\b(up\b|rise|strong)/i], category: 'retail_sales', value: 'beat', impact: 'low' },
  { patterns: [/\bconsumer\b.*\bspend.{0,40}\b(down\b|fall|weak)/i], category: 'retail_sales', value: 'miss', impact: 'low' },

  // ── Risk Sentiment ──
  { patterns: [/\bsafe.?haven (demand|flows?|bid|buying)|\brisk.?off\b|\bturmoil\b|\bcrisis\b|\bpanic\b/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/\brisk.?on\b|\beuphoria\b/i], category: 'risk_sentiment', value: 'risk_on', impact: 'high' },
  { patterns: [/\bmarkets?\b.{0,40}\b(fear|plunge|sell.?off|crash|turmoil|retreat|decline)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/\bmarkets?\b.{0,40}\b(rally|surge|climb|optimism|rebound|gains|advance|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/\bstocks?\b.{0,40}\b(fall|drop|plunge|sell.?off|decline|retreat)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/\bstocks?\b.{0,40}\b(rally|surge|climb|gain|rise|advance)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/\b(equities|shares)\b.{0,40}\b(fall|drop|plunge|decline)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },
  { patterns: [/\b(equities|shares)\b.{0,40}\b(rally|surge|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/\bwall.?street\b.{0,40}\b(lower|fall|drop|decline)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/\bwall.?street\b.{0,40}\b(higher|rise|rally|gain)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'high' },
  { patterns: [/\btrade\b.{0,40}\b(war|tension|escalat)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'high' },
  { patterns: [/\btrade\b.{0,40}\b(deal|truce|agreement)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },

  // ── Dollar Strength (additional generic patterns) ──
  { patterns: [/\b(usd|dollar)\b.{0,40}\b(pressure|retreat|slip|soft|ease)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/\b(usd|dollar)\b.{0,40}\b(strength|support|firm|gain|climb)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/\b(forex|currency)\b.{0,40}\b(dollar|usd)\b.{0,40}\b(weak|lower|soft)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/\b(forex|currency)\b.{0,40}\b(dollar|usd)\b.{0,40}\b(strong|higher|firm)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },

  // ── Yields (additional) ──
  { patterns: [/\b(treasuries|bonds)\b.{0,40}\b(sell.?off|yield.*up\b)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/\b(treasuries|bonds)\b.{0,40}\b(rally|yield.*down\b)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/\byield\b.{0,40}\b(curve|spread)\b.{0,40}\b(steepen|widen)/i], category: 'yields', value: 'rising', impact: 'low' },
  { patterns: [/\byield\b.{0,40}\b(curve|spread)\b.{0,40}\b(flatten|narrow)/i], category: 'yields', value: 'falling', impact: 'low' },

  // ── Geopolitical ──
  { patterns: [/\bgeopolitical\b.{0,40}\b(tension|risk|escalat|conflict|war)/i], category: 'geopolitical', value: 'tension', impact: 'high' },
  { patterns: [/\bsanction.{0,40}\b(new|escalat|tighten)/i], category: 'geopolitical', value: 'tension', impact: 'medium' },
  { patterns: [/\bsanction.{0,40}\b(ease|lift|remove)/i], category: 'geopolitical', value: 'easing', impact: 'medium' },
  { patterns: [/\b(ceasefire|truce|peace)\b.{0,40}\b(deal|agreement)/i], category: 'geopolitical', value: 'easing', impact: 'medium' },

  // ── Dollar Strength ──
  { patterns: [/\bdollar\b.{0,40}\b(surge|rally|strength|climb|up\b|bullish)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/\bdollar\b.{0,40}\b(weak|slide|fall|drop|down\b|retreat|tumble)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/\b(dxy|usd index)\b.{0,40}\b(up\b|high|rise|surge)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/\b(dxy|usd index)\b.{0,40}\b(down\b|low|fall|drop)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },
  { patterns: [/\bgreenback\b.{0,40}\b(strong|surge|rally|climb)/i], category: 'dollar_strength', value: 'strong', impact: 'medium' },
  { patterns: [/\bgreenback\b.{0,40}\b(weak|slide|fall|drop)/i], category: 'dollar_strength', value: 'weak', impact: 'medium' },

  // ── Yields ──
  { patterns: [/\byields?\b.{0,40}\b(surge|spike|rise|climb|up\b|jump)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/\byields?\b.{0,40}\b(fall|drop|slide|down\b|plunge|tumble)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/\btreasury\b.{0,40}\b(yield|rate)s?\b.{0,40}\b(up\b|rise|high|climb)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/\btreasury\b.{0,40}\b(yield|rate)s?\b.{0,40}\b(down\b|fall|drop|low)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/\bbonds?\b.{0,40}\b(sell.?off|yield.*up\b|rate.*rise)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/\bbonds?\b.{0,40}\b(rally|yield.*down\b|rate.*fall)/i], category: 'yields', value: 'falling', impact: 'medium' },
  { patterns: [/\b10.?year\b.{0,40}\b(rise|up\b|climb|jump)/i], category: 'yields', value: 'rising', impact: 'medium' },
  { patterns: [/\b10.?year\b.{0,40}\b(fall|drop|down\b|slide)/i], category: 'yields', value: 'falling', impact: 'medium' },

  // ── Crypto Regulation ──
  // Price moves are deliberately absent: a falling coin is not a regulatory event.
  { patterns: [/\bSEC\b.{0,40}\b(approve|approval|greenlight|allow)/], category: 'crypto_regulation', value: 'positive', impact: 'high' },
  { patterns: [/\bSEC\b.{0,40}\b(reject|deny|crack.?down|sue|suit|penalty)/], category: 'crypto_regulation', value: 'negative', impact: 'high' },
  { patterns: [/\bcrypto\b.{0,40}\b(etf.{0,20}\bapprov|approv|regulation.*\bclear)/i], category: 'crypto_regulation', value: 'positive', impact: 'high' },
  { patterns: [/\bcrypto\b.{0,40}\b(ban|crack.?down|restrict)/i], category: 'crypto_regulation', value: 'negative', impact: 'high' },
  { patterns: [/\bbitcoin\b.{0,40}\b(etf.{0,20}\bapprov|approv)/i], category: 'crypto_regulation', value: 'positive', impact: 'high' },
  { patterns: [/\bbitcoin\b.{0,40}\b(ban|restrict|crack.?down)/i], category: 'crypto_regulation', value: 'negative', impact: 'high' },
  { patterns: [/\bregulatory\b.{0,40}\b(clear|approve|greenlight)/i], category: 'crypto_regulation', value: 'positive', impact: 'medium' },
  { patterns: [/\bregulatory\b.{0,40}\b(crack.?down|restrict|tighten)/i], category: 'crypto_regulation', value: 'negative', impact: 'medium' },

  // ── Nasdaq / Tech specific ──
  { patterns: [/\b(nasdaq|tech stock|technology)\b.{0,40}\b(rally|surge|climb|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/\b(nasdaq|tech stock|technology)\b.{0,40}\b(fall|drop|decline|retreat|plunge)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },
  { patterns: [/\b(dow|djia)\b.{0,40}\b(rally|surge|climb|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/\b(dow|djia)\b.{0,40}\b(fall|drop|decline|retreat|plunge)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },
  { patterns: [/(s&p|\bsp500\b|\bindex\b).{0,40}\b(record|high|rally|gain|rise)/i], category: 'risk_sentiment', value: 'risk_on', impact: 'medium' },
  { patterns: [/(s&p|\bsp500\b|\bindex\b).{0,40}\b(fall|drop|decline|retreat|plunge)/i], category: 'risk_sentiment', value: 'risk_off', impact: 'medium' },

  // ── Earnings ──
  { patterns: [/\bearnings\b.{0,40}\b(beat|surge|above|record|strong|positive)/i], category: 'earnings', value: 'positive', impact: 'high' },
  { patterns: [/\bearnings\b.{0,40}\b(miss|below|weak|disappoint|negative)/i], category: 'earnings', value: 'negative', impact: 'high' },
  { patterns: [/\bprofits?\b.{0,40}\b(beat|surge|above|record|rise)/i], category: 'earnings', value: 'positive', impact: 'medium' },
  { patterns: [/\bprofits?\b.{0,40}\b(miss|fall|below|decline|drop)/i], category: 'earnings', value: 'negative', impact: 'medium' },
  { patterns: [/\btech\b.{0,40}\b(earnings|profit|revenue)\b.{0,40}\b(beat|surge|record)/i], category: 'earnings', value: 'positive', impact: 'high' },
  { patterns: [/\btech\b.{0,40}\b(earnings|profit|revenue)\b.{0,40}\b(miss|decline|drop)/i], category: 'earnings', value: 'negative', impact: 'high' },
  { patterns: [/\b(apple|google|microsoft|amazon|meta|nvidia)\b.{0,40}\b(earnings|profit|revenue)\b.{0,40}\b(beat|surge|growth)/i], category: 'earnings', value: 'positive', impact: 'high' },
  { patterns: [/\b(apple|google|microsoft|amazon|meta|nvidia)\b.{0,40}\b(miss|weak|decline|drop)/i], category: 'earnings', value: 'negative', impact: 'high' },
];

function isNegatedPolicyMove(text: string, match: RegExpExecArray): boolean {
  const start = Math.max(0, match.index - NEGATION_WINDOW);
  return POLICY_NEGATION.test(text.slice(start, match.index + match[0].length + NEGATION_WINDOW));
}

export function classifyHeadline(text: string): SentimentResult[] {
  if (TECHNICAL_ARTICLE.test(text)) return [];
  const foreignEquityOnly = FOREIGN_EQUITY.test(text) && !GLOBAL_EQUITY.test(text);
  const seen = new Set<string>();
  const results: SentimentResult[] = [];
  for (const rule of RULES) {
    if (rule.category === 'risk_sentiment' && foreignEquityOnly) continue;
    for (const pattern of rule.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      if (POLICY_CATEGORIES.has(rule.category) && isNegatedPolicyMove(text, match)) continue;
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
  // A text pointing both ways in one category carries no usable signal.
  return results.filter((result) => results.every((other) => other.category !== result.category || other.value === result.value));
}

export function createEventFromClassification(
  classified: SentimentResult,
  source: string,
  url?: string,
  publishedAt?: string
): MacroEvent {
  const id = `live-${source}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    category: classified.category,
    title: classified.title,
    description: classified.description,
    timestamp: publishedAt ?? new Date().toISOString(),
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
