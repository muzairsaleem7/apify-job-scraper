import type { Window } from './types.ts';

export const WINDOWS: Window[] = ['24h', '3d', '7d', '14d', '30d'];
export const windowDays = (w: Window): number => (w === '24h' ? 1 : Number(w.slice(0, -1)));
export const isWindow = (s: string): s is Window => (WINDOWS as string[]).includes(s);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', euro: '€', pound: '£' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (ENTITIES[e]) return ENTITIES[e];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16) || 32);
    if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)) || 32);
    return m;
  });
}

/** HTML/markdown -> plain text with collapsed whitespace, optionally truncated. */
export function plainText(input: unknown, maxChars = 0): string {
  let s = str(input);
  // Double-escaped HTML (RSS feeds) decodes to tags, so decode, strip, decode again.
  if (/&lt;\w|&amp;/.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/ul|\/ol)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`#]{2,}/g, ' ')
    .replace(/^\s*[#*]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = decodeEntities(s);
  if (maxChars > 0 && s.length > maxChars) s = s.slice(0, maxChars).trimEnd() + '…';
  return s;
}

/** Any date-ish value -> YYYY-MM-DD ('' if unknown). Accepts ISO strings, RFC 2822, epoch seconds/ms. */
export function isoDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  let d: Date;
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else if (/^\d{9,13}$/.test(String(v).trim())) return isoDate(Number(v));
  else d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export function daysAgo(n: number, from = Date.now()): string {
  return new Date(from - n * 86_400_000).toISOString().slice(0, 10);
}

const PERIOD: Record<string, string> = { YEAR: 'year', ANNUAL: 'year', MONTH: 'month', MONTHLY: 'month', WEEK: 'week', DAY: 'day', HOUR: 'hour', HOURLY: 'hour' };

export function formatSalary(min: unknown, max: unknown, currency?: unknown, period?: unknown): string {
  const fmt = (n: unknown) => (typeof n === 'number' && n > 0 ? n.toLocaleString('en-US') : '');
  const lo = fmt(min);
  const hi = fmt(max);
  if (!lo && !hi) return '';
  const range = lo && hi && lo !== hi ? `${lo}-${hi}` : lo || hi;
  const per = PERIOD[str(period).toUpperCase()];
  return [str(currency) || '', range].filter(Boolean).join(' ') + (per ? ` / ${per}` : '');
}

/**
 * Lowercase, unify common spellings, keep only words. Used for title matching and dedupe keys.
 * "Sr. Full-Stack Engineer (Node.js/C#)" -> "senior fullstack engineer node js csharp"
 */
export function normalizeText(s: string): string {
  return ` ${s.toLowerCase()} `
    .replace(/c\+\+/g, ' cpp ')
    .replace(/c#/g, ' csharp ')
    .replace(/\.net\b/g, ' dotnet ')
    .replace(/\b(node|next|react|vue|nuxt|nest|express|angular)\.?js\b/g, '$1 js')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/ full stack /g, ' fullstack ')
    .replace(/ front end /g, ' frontend ')
    .replace(/ back end /g, ' backend ')
    .replace(/ sr /g, ' senior ')
    .replace(/ jr /g, ' junior ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const words = (s: string): string[] => normalizeText(s).split(' ').filter(Boolean);

/** A phrase matches when every word of the phrase is in the text (any order). Returns the phrase that matched. */
export function phraseMatcher(phrases: string[]): (text: string) => string | null {
  const sets = [...new Set(phrases.map((p) => normalizeText(p)))].filter(Boolean).map((p) => ({ p, ws: p.split(' ') }));
  return (text: string) => {
    const t = new Set(words(text));
    const hit = sets.find(({ ws }) => ws.every((w) => t.has(w)));
    return hit ? hit.p : null;
  };
}

export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));
  return results;
}

export const unique = <T>(arr: T[]): T[] => [...new Set(arr)];
