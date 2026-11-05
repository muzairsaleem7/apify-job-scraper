/**
 * Text classifiers: workplace type, where candidates must live, eligibility flags,
 * technology extraction, seniority and salary parsing. Pure functions, no I/O.
 */
import { normalizeText, plainText, str, unique } from './util.ts';

const lower = (text: string) => plainText(text).toLowerCase();

// ------------------------------------------------------------------ workplace
const REMOTE = /\bremote\b|work from home|\bwfh\b|fully distributed|work from anywhere|\btelecommut/;
const NOT_REMOTE = /\b(not|no|non)[- ]remote\b|remote (work )?(is )?not (available|possible|offered|an option)|not a remote (role|position|job)/;
const HYBRID = /\bhybrid\b/;
const ONSITE = /\bon-?site\b|\bin[- ]office\b|\bin the office\b|\boffice[- ]based\b|days? (a|per) week (in|at) (the |our )?office|\bonsite\b/;

/**
 * 'Remote' = mentions remote only; 'Remote + hybrid/on-site' = mentions both (worth a look);
 * 'Hybrid' / 'On-site' = no remote mention at all; '' = nothing said.
 */
export function workplace(text: string): string {
  const t = lower(text);
  const remote = REMOTE.test(t) && !NOT_REMOTE.test(t);
  const hybrid = HYBRID.test(t);
  const onsite = ONSITE.test(t);
  if (remote) return hybrid || onsite ? 'Remote + hybrid/on-site' : 'Remote';
  if (hybrid) return 'Hybrid';
  if (onsite || NOT_REMOTE.test(t)) return 'On-site';
  return '';
}

// ------------------------------------------------------------------ candidate location / remote scope
const US = String.raw`(?:usa?|u\.s\.a?\.?|united states)`;
const REGION_TEXT: [string, RegExp][] = [
  ['US', new RegExp(String.raw`\b${US}[- ]?(?:only|based|residents?|citizens?)\b|\bmust (?:be |currently )?(?:reside|live|be located|be based|be physically located|be domiciled) (?:in|within) the ${US}\b|\b(?:authori[sz]ed|eligible|legally able) to work in the ${US}\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)(?:the\s+)?${US}\b|\bwithin the ${US}\b|\b${US} work authori[sz]ation\b|\bgreen card\b|\bw-?2\b|\b(?:us|u\.s\.) time ?zones?\b|\banywhere in the (?:us|u\.s\.|united states)\b|\bbased in the (?:us|u\.s\.|united states)\b|\b(?:est|pst|cst|mst)\b|\b(?:eastern|pacific|central|mountain) (?:standard |daylight )?time\b`)],
  ['Canada', /\bcanada[- ]?(?:only|based|residents?)\b|\b(?:reside|located|based|live) in canada\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)canada\b|\bcanadian (?:residents?|citizens?|work authori[sz]ation)\b|\b(?:authori[sz]ed|eligible) to work in canada\b|\banywhere in canada\b/],
  ['UK', /\buk[- ]?(?:only|based|residents?)\b|\bright to work in the uk\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)(?:the\s+)?(?:uk|united kingdom)\b|\bunited kingdom only\b|\bbased in the (?:uk|united kingdom)\b|\banywhere in the uk\b|\buk time ?zones?\b|\b(?:gmt|bst)\b/],
  ['EU', /\b(?:eu|europe|european union|emea)[- ]?(?:only|based|residents?)\b|\bbased in (?:the eu|europe|the european union)\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)(?:the\s+)?(?:eu|europe|emea|european union)\b|\bright to work in the eu\b|\b(?:cet|cest|european) time ?zones?\b|\banywhere in (?:the eu|europe)\b|\beu (?:work )?(?:permit|authori[sz]ation|citizens?)\b|\b(?:cet|cest)\b/],
  ['LATAM', /\b(?:latam|latin america)[- ]?(?:only|based)\b|\bbased in (?:latam|latin america|south america)\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)(?:latam|latin america)\b|\banywhere in (?:latam|latin america)\b/],
  ['APAC', /\b(?:apac|australia|new zealand|anz)[- ]?(?:only|based|residents?)\b|\bbased in (?:australia|apac|new zealand)\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)(?:australia|apac|new zealand)\b|\bworking rights in australia\b|\b(?:aest|aedt)\b/],
  ['UAE', /\b(?:uae|dubai|abu dhabi|gcc|middle east)[- ]?(?:only|based|residents?)\b|\bbased in (?:the uae|dubai|abu dhabi|the gcc)\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)(?:the\s+)?(?:uae|dubai|gcc)\b/],
  ['India', /\bindia[- ]?(?:only|based)\b|\bbased in india\b|\bremote\s*(?:[-–(:]\s*|in\s+|within\s+)india\b|\bpan[- ]india\b|\b(?:ist)\b/],
];
const WORLDWIDE = /\b(?:work|working) from anywhere\b|\banywhere in the world\b|\bworldwide\b|\bglobal(?:ly)? remote\b|\bremote\s*(?:[-–(:]\s*)?(?:global|worldwide|anywhere)\b|\bany (?:country|location|time ?zone)\b|\bfully remote,? (?:globally|worldwide|anywhere)\b|\bopen to (?:all|any) (?:countries|locations)\b|\blocation[- ]independent\b|\bremote from anywhere\b/;

const EU_COUNTRIES = new Set(['austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czech republic', 'czechia', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden', 'norway', 'switzerland', 'serbia', 'ukraine']);

/** Explicit candidate-location text from a job board ("USA Only", "Europe, UK", "Anywhere in the World") -> region labels. */
export function geoToRegions(geo: string): string[] {
  const g = str(geo).toLowerCase();
  if (!g) return [];
  if (/anywhere|worldwide|global|remote only|^remote$|any location/.test(g)) return ['Worldwide'];
  const out: string[] = [];
  let euCountries = 0;
  for (const raw of g.split(/[,;|/]|\band\b|\bor\b/)) {
    const t = raw.replace(/\b(only|timezones?|time zones?|the|based)\b/g, '').replace(/[^a-z. ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (/^(usa?|u\.s\.a?\.?|united states|america)$/.test(t)) out.push('US');
    else if (/^north america$/.test(t)) out.push('US', 'Canada');
    else if (/^canada$/.test(t)) out.push('Canada');
    else if (/^(uk|united kingdom|great britain|britain|england)$/.test(t)) out.push('UK');
    else if (/^(eu|europe|european union|emea|cet|cest)$/.test(t)) out.push('EU');
    else if (/^(latam|latin america|south america|central america)$/.test(t)) out.push('LATAM');
    else if (/^(apac|asia|asia pacific|australia|new zealand|anz|oceania)$/.test(t)) out.push('APAC');
    else if (/^(uae|dubai|abu dhabi|middle east|gcc|mena)$/.test(t)) out.push('UAE');
    else if (/^india$/.test(t)) out.push('India');
    else if (EU_COUNTRIES.has(t)) {
      euCountries++;
      out.push(t.replace(/\b\w/g, (c) => c.toUpperCase()));
    } else out.push(t.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  // A long list of European countries is effectively "EU".
  const result = euCountries >= 3 ? ['EU', ...out.filter((r) => !EU_COUNTRIES.has(r.toLowerCase()))] : out;
  return unique(result).slice(0, 8);
}

export interface Scope {
  /** 'worldwide' | 'restricted' | 'unknown' */
  kind: 'worldwide' | 'restricted' | 'unknown';
  regions: string[];
  label: string;
}

/**
 * Where candidates must live. An explicit board field wins; otherwise phrases in the description.
 * Time-zone mentions count as a soft restriction and are reported as regions too.
 */
export function remoteScope(text: string, explicitGeo = ''): Scope {
  const explicit = geoToRegions(explicitGeo);
  const t = lower(text);
  const fromText = REGION_TEXT.filter(([, re]) => re.test(t)).map(([name]) => name);
  const worldwideText = WORLDWIDE.test(t);

  let regions: string[];
  if (explicit.length && !(explicit.length === 1 && explicit[0] === 'Worldwide')) regions = explicit;
  else if (fromText.length) regions = fromText;
  else regions = [];

  if (regions.length) return { kind: 'restricted', regions, label: regions.join(', ') };
  if (explicit[0] === 'Worldwide' || worldwideText) return { kind: 'worldwide', regions: ['Worldwide'], label: 'Worldwide' };
  return { kind: 'unknown', regions: [], label: '' };
}

// ------------------------------------------------------------------ eligibility flags
const FLAG_PATTERNS: [string, RegExp][] = [
  ['clearance', /\b(?:security|secret|ts\/sci|top secret|dod|government) clearance\b|\bclearance (?:is )?required\b|\bpublic trust\b|\bactive (?:secret|ts|clearance)\b|\bmust (?:hold|have|obtain) (?:a |an )?(?:active )?(?:secret|clearance)/],
  ['citizenship', /\b(?:us|u\.s\.|united states|canadian|uk|british|australian) citizen(?:ship)?\b|\bcitizenship (?:is )?required\b|\bmust be a (?:us|u\.s\.|canadian|uk|british) citizen\b|\bcitizens? (?:only|or permanent residents?)\b/],
  ['no-sponsorship', /\b(?:no|not|unable to|cannot|can't|will not|won't|do not|don't|does not|doesn't) (?:provide|offer|sponsor|support)\w* (?:visa|sponsorship|work visa|h-?1b|immigration)|\bwithout (?:visa )?sponsorship\b|\bsponsorship (?:is )?not (?:available|provided|offered|possible)\b|\bno (?:visa )?sponsorship\b|\bnot (?:able|eligible) to sponsor\b/],
  ['sponsorship-offered', /\b(?:visa|work permit) sponsorship (?:is )?(?:available|offered|provided|possible)\b|\bwe (?:can|will|do) (?:offer |provide )?sponsor\w*\b|\bsponsorship available\b/],
  ['relocation', /\brelocation (?:package|assistance|support|bonus|budget)\b|\bwe (?:offer|provide) relocation\b|\bwilling to relocate\b/],
  ['c2c', /\bc2c\b|\bcorp[- ]to[- ]corp\b/],
  ['1099', /\b1099\b/],
  ['w2', /\bw-?2 (?:only|employee|basis|contract|position)\b/],
  ['contract', /\b(?:contract|contractor|freelance|b2b contract|fixed[- ]term)\b/],
  ['part-time', /\bpart[- ]time\b/],
  ['tz-overlap', /\b\d+\+? ?(?:hours?|hrs?) (?:of )?overlap\b|\btime ?zone overlap\b|\boverlap with (?:us|u\.s\.|eastern|pacific|european|uk|cet|est|pst)\b|\bworking hours (?:in|aligned)\b/],
  ['agency', /\bstaffing (?:and|&) recruiting\b|\bour client is (?:looking|seeking|hiring)\b|\bon behalf of (?:our|a) client\b|\bfor (?:our|a) client\b|\brecruitment (?:agency|consultancy)\b/],
];

/** Short lower-case flags found in the text (and in the structured fields the caller passes). */
export function eligibilityFlags(text: string, extra: { employmentType?: string; industry?: string; company?: string } = {}): string[] {
  const t = lower(text);
  const flags = FLAG_PATTERNS.filter(([, re]) => re.test(t)).map(([f]) => f);
  const et = str(extra.employmentType).toLowerCase();
  if (/contract|freelance|temporary/.test(et)) flags.push('contract');
  if (/part[- ]time/.test(et)) flags.push('part-time');
  if (/staffing|recruiting|recruitment/i.test(str(extra.industry)) || /\b(?:recruit\w*|staffing|talent (?:partners?|solutions|group)|consultancy)\b/i.test(str(extra.company))) flags.push('agency');
  return unique(flags);
}

// ------------------------------------------------------------------ technology extraction
const TECH: [string, RegExp][] = [
  ['JavaScript', /\bjavascript\b|\bes6\+?\b|\bes20\d\d\b|\bvanilla js\b/],
  ['TypeScript', /\btypescript\b/],
  ['React', /\breact(?:\.?js)?\b(?![- ]native)/],
  ['React Native', /\breact[- ]native\b/],
  ['Next.js', /\bnext\.?js\b/],
  ['Node.js', /\bnode(?:\.?js)?\b/],
  ['Express', /\bexpress\.?js\b|\bexpressjs\b|\bexpress\b(?=\W+(?:js|framework|server|api|node|and node))/],
  ['NestJS', /\bnest\.?js\b|\bnestjs\b/],
  ['Vue', /\bvue(?:\.?js)?\b/],
  ['Nuxt', /\bnuxt(?:\.?js)?\b/],
  ['Angular', /\bangular(?:\.?js)?\b/],
  ['Svelte', /\bsvelte(?:kit)?\b/],
  ['Remix', /\bremix\b/],
  ['Redux', /\bredux\b/],
  ['Tailwind', /\btailwind(?:css)?\b/],
  ['HTML/CSS', /\bhtml5?\b|\bcss3?\b/],
  ['Sass', /\bsass\b|\bscss\b/],
  ['GraphQL', /\bgraphql\b/],
  ['REST', /\brestful\b|\brest(?:ful)? apis?\b|\brest services\b/],
  ['tRPC', /\btrpc\b/],
  ['Prisma', /\bprisma\b/],
  ['WebSockets', /\bwebsockets?\b|\bsocket\.io\b/],
  ['MongoDB', /\bmongo(?:db)?\b/],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/],
  ['MySQL', /\bmysql\b/],
  ['SQL', /\bsql\b/],
  ['SQL Server', /\bsql server\b|\bmssql\b|\bt-sql\b/],
  ['Redis', /\bredis\b/],
  ['Elasticsearch', /\belastic ?search\b/],
  ['DynamoDB', /\bdynamodb\b/],
  ['Kafka', /\bkafka\b/],
  ['RabbitMQ', /\brabbitmq\b/],
  ['Supabase', /\bsupabase\b/],
  ['Firebase', /\bfirebase\b/],
  ['AWS', /\baws\b|\bamazon web services\b/],
  ['GCP', /\bgcp\b|\bgoogle cloud\b/],
  ['Azure', /\bazure\b/],
  ['Vercel', /\bvercel\b/],
  ['Docker', /\bdocker\b/],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/],
  ['Terraform', /\bterraform\b/],
  ['CI/CD', /\bci\s*\/\s*cd\b|\bcontinuous (?:integration|delivery|deployment)\b|\bgithub actions\b/],
  ['Serverless', /\bserverless\b|\baws lambda\b/],
  ['Microservices', /\bmicro-?services?\b/],
  ['Linux', /\blinux\b/],
  ['Jest', /\bjest\b/],
  ['Cypress', /\bcypress\b/],
  ['Playwright', /\bplaywright\b/],
  ['Python', /\bpython\b/],
  ['Django', /\bdjango\b/],
  ['Flask', /\bflask\b/],
  ['FastAPI', /\bfastapi\b/],
  ['Java', /\bjava\b/],
  ['Spring', /\bspring ?boot\b|\bspring framework\b|\bspring mvc\b/],
  ['Kotlin', /\bkotlin\b/],
  ['C#', /\bc#|\bcsharp\b/],
  ['.NET', /\.net\b|\bdotnet\b|\basp\.net\b/],
  ['Go', /\bgolang\b|\(go\)|\bgo\s*\/|\/\s*go\b|,\s*go\s*,|\bgo\s+(?:developer|engineer|programming|microservices|backend|services)\b/],
  ['Rust', /\brust\b/],
  ['PHP', /\bphp\b/],
  ['Laravel', /\blaravel\b/],
  ['Ruby', /\bruby\b/],
  ['Rails', /\brails\b/],
  ['Scala', /\bscala\b/],
  ['Elixir', /\belixir\b/],
  ['C++', /\bc\+\+/],
  ['Swift', /\bswift\b/],
  ['Flutter', /\bflutter\b/],
  ['Android', /\bandroid\b/],
  ['iOS', /\bios\b/],
  ['AI/LLM', /\bopenai\b|\bllms?\b|\blarge language models?\b|\blangchain\b|\bgpt-?\d?\b|\bgenerative ai\b|\brag\b|\bvector (?:db|database)\b|\bagentic\b/],
  ['Stripe', /\bstripe\b/],
  ['Shopify', /\bshopify\b/],
  ['WordPress', /\bwordpress\b/],
  ['Salesforce', /\bsalesforce\b/],
];

/** JavaScript-ecosystem technologies (used to tell "wrong stack" from "our stack"). */
export const JS_ECOSYSTEM = new Set(['JavaScript', 'TypeScript', 'React', 'React Native', 'Next.js', 'Node.js', 'Express', 'NestJS', 'Vue', 'Nuxt', 'Angular', 'Svelte', 'Remix', 'Redux', 'Tailwind', 'GraphQL', 'tRPC', 'Prisma', 'MongoDB']);
/** Other primary languages/frameworks: a job built on these (and nothing from JS_ECOSYSTEM) is off-stack. */
export const OTHER_STACKS = new Set(['Python', 'Django', 'Flask', 'FastAPI', 'Java', 'Spring', 'Kotlin', 'C#', '.NET', 'Go', 'Rust', 'PHP', 'Laravel', 'Ruby', 'Rails', 'Scala', 'Elixir', 'C++', 'Swift', 'Flutter', 'Android', 'iOS']);

/** Technologies mentioned in the text, in order of first appearance. */
export function extractTech(text: string, max = 24): string[] {
  const t = lower(text);
  const found: { name: string; at: number }[] = [];
  for (const [name, re] of TECH) {
    const m = re.exec(t);
    if (m) found.push({ name, at: m.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.name).slice(0, max);
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, '');

/** Which of the candidate's stack items appear in the extracted tech list. */
export function stackMatch(tech: string[], stack: string[]): string[] {
  const have = new Set(tech.map(key));
  return stack.filter((s) => have.has(key(s)));
}

// ------------------------------------------------------------------ seniority
export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'lead' | 'staff' | 'principal' | 'manager' | '';

export function seniorityOf(title: string, raw = ''): Seniority {
  const t = ` ${normalizeText(title)} `;
  if (/ (intern|internship|trainee|apprentice|werkstudent) /.test(t)) return 'intern';
  if (/ (junior|entry level|graduate|fresher|associate|early career) /.test(t) || / entry level /.test(t)) return 'junior';
  if (/ (director|vp|vice president|head of|chief|cto|manager) /.test(t) || / head /.test(t)) return 'manager';
  if (/ (principal|distinguished|fellow) /.test(t)) return 'principal';
  if (/ staff /.test(t)) return 'staff';
  if (/ (lead|leader) /.test(t)) return 'lead';
  if (/ (senior|iii|iv) /.test(t)) return 'senior';
  if (/ (mid|intermediate|ii|mid level) /.test(t)) return 'mid';
  const r = raw.toLowerCase();
  if (!r || /not applicable|any/.test(r)) return '';
  if (/intern/.test(r)) return 'intern';
  if (/entry|junior|associate/.test(r)) return 'junior';
  if (/director|executive/.test(r)) return 'manager';
  if (/mid-senior|mid/.test(r)) return 'mid';
  if (/senior/.test(r)) return 'senior';
  const yrs = /(\d+)\+?\s*(?:years|yrs)/.exec(r);
  if (yrs) {
    const n = Number(yrs[1]);
    return n >= 8 ? 'staff' : n >= 5 ? 'senior' : n >= 2 ? 'mid' : 'junior';
  }
  return '';
}

// ------------------------------------------------------------------ salary
export interface Salary {
  min: number;
  max: number;
  currency: string;
  period: 'hour' | 'day' | 'week' | 'month' | 'year';
}

/** Approximate USD per unit (rough, fixed; used only for sortable estimates). */
export const FX_TO_USD: Record<string, number> = { USD: 1, EUR: 1.1, GBP: 1.28, CAD: 0.72, AUD: 0.65, NZD: 0.6, AED: 0.272, INR: 0.012, CHF: 1.15, SGD: 0.75, PLN: 0.26, SEK: 0.095, DKK: 0.147, NOK: 0.093, JPY: 0.0067, BRL: 0.18, MXN: 0.055, PKR: 0.0036, PHP: 0.017, ZAR: 0.055, CZK: 0.044, HUF: 0.0028, RON: 0.22, TRY: 0.03 };
const PERIOD_FACTOR: Record<Salary['period'], number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

export function parseSalary(input: string): Salary | null {
  let s = str(input);
  if (!s) return null;
  s = s.replace(/[\d.]+\s*%/g, ' ').replace(/\bequity\b/gi, ' ');
  const sl = s.toLowerCase();

  let currency = '';
  const code = /\b(usd|eur|gbp|cad|aud|nzd|aed|inr|chf|sgd|pln|sek|dkk|nok|jpy|brl|mxn|pkr|php|zar|czk|huf|ron|try)\b/.exec(sl);
  if (code) currency = code[1].toUpperCase();
  else if (/c\$|ca\$/i.test(s)) currency = 'CAD';
  else if (/a\$|au\$/i.test(s)) currency = 'AUD';
  else if (/£/.test(s)) currency = 'GBP';
  else if (/€/.test(s)) currency = 'EUR';
  else if (/₹|rs\.?\s*\d/i.test(s)) currency = 'INR';
  else if (/\$/.test(s)) currency = 'USD';

  let period: Salary['period'] | '' = '';
  if (/\/\s*(?:yr|year|annum|a)\b|per (?:year|annum)|annual|yearly|\bp\.?a\.?\b/.test(sl)) period = 'year';
  else if (/\/\s*(?:mo|month)\b|per month|monthly/.test(sl)) period = 'month';
  else if (/\/\s*(?:hr|hour|h)\b|per hour|hourly|an hour/.test(sl)) period = 'hour';
  else if (/\/\s*day\b|per day|daily|day rate/.test(sl)) period = 'day';
  else if (/\/\s*(?:wk|week)\b|per week|weekly/.test(sl)) period = 'week';

  const nums: number[] = [];
  for (const m of sl.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/g)) {
    let n = Number(m[1].replace(/,/g, ''));
    if (m[2]) n *= 1000;
    if (Number.isFinite(n) && n > 0) nums.push(n);
    if (nums.length === 2) break;
  }
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (!period) period = max < 500 ? 'hour' : max < 10_000 ? 'month' : 'year';
  return { min, max, currency: currency || 'USD', period };
}

/** Midpoint of the range, annualised and converted to USD (rounded to $100). null if unknown. */
export function annualUsd(sal: Salary | null): number | null {
  if (!sal) return null;
  const fx = FX_TO_USD[sal.currency];
  if (!fx) return null;
  const mid = (sal.min + sal.max) / 2;
  const usd = mid * PERIOD_FACTOR[sal.period] * fx;
  if (!Number.isFinite(usd) || usd < 1000 || usd > 2_000_000) return null;
  return Math.round(usd / 100) * 100;
}
