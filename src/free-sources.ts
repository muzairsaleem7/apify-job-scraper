/** Free, remote-first job boards with public APIs or RSS feeds. No Apify, no cost, no login. */
import { blankRaw } from './sources.ts';
import { decodeEntities, isoDate, formatSalary, plainText, sleep, str } from './util.ts';
import type { FreeSource, FreeSourceName, RawJob } from './types.ts';

const HEADERS = { 'User-Agent': 'personal-job-scraper/1.0 (local, non-commercial)', Accept: 'application/json, application/rss+xml;q=0.9, */*;q=0.8' };

export async function getText(url: string, timeoutMs = 45_000): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.text();
}

export async function getJson<T = any>(url: string): Promise<T> {
  const text = await getText(url);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`non-JSON response from ${new URL(url).host} (blocked or down)`);
  }
}

/** Minimal RSS 2.0 reader: returns each <item> as a map of tag -> decoded text. */
export function rssItems(xml: string): Record<string, string>[] {
  return xml
    .split(/<item\b[^>]*>/)
    .slice(1)
    .map((chunk) => {
      const out: Record<string, string> = {};
      for (const m of chunk.matchAll(/<([a-zA-Z:_]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
        const val = m[2].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
        if (!(m[1] in out)) out[m[1]] = decodeEntities(val);
      }
      return out;
    });
}

// ---------------------------------------------------------------- RemoteOK (public API; terms ask for a link back if you republish)
export const remoteok: FreeSource = {
  name: 'remoteok',
  describe: (cfg) => `${cfg.sources.remoteok.tags.length} tag feeds (latest ~100 jobs each)`,
  async fetch(cfg) {
    const byId = new Map<string, RawJob>();
    for (const [i, tag] of cfg.sources.remoteok.tags.entries()) {
      if (i) await sleep(600);
      const data = await getJson<any[]>(tag ? `https://remoteok.com/api?tags=${encodeURIComponent(tag)}` : 'https://remoteok.com/api');
      for (const it of data) {
        if (!it?.position || !it?.id || byId.has(String(it.id))) continue;
        byId.set(String(it.id), {
          ...blankRaw('remoteok'),
          source_id: String(it.id),
          title: plainText(it.position, 200),
          company: str(it.company),
          job_url: str(it.url),
          apply_url: str(it.apply_url),
          location: str(it.location) || 'Worldwide',
          remote: 'Remote',
          candidate_location: str(it.location),
          salary: formatSalary(it.salary_min, it.salary_max, 'USD', 'YEAR'),
          posted_date: isoDate(it.date ?? it.epoch),
          skills: Array.isArray(it.tags) ? it.tags.join(', ') : '',
          description: plainText(it.description),
        });
      }
    }
    return [...byId.values()];
  },
};

// ---------------------------------------------------------------- Jobicy (public API v2)
export const jobicy: FreeSource = {
  name: 'jobicy',
  describe: (cfg) => `${cfg.sources.jobicy.tags.length} searches (up to 50 jobs each)`,
  async fetch(cfg) {
    const byId = new Map<string, RawJob>();
    for (const [i, tag] of cfg.sources.jobicy.tags.entries()) {
      if (i) await sleep(400);
      const param = tag.includes('=') ? tag : `tag=${encodeURIComponent(tag)}`;
      const data = await getJson<{ jobs?: any[] }>(`https://jobicy.com/api/v2/remote-jobs?count=50&${param}`);
      for (const it of data.jobs ?? []) {
        if (!it?.jobTitle || !it?.id || byId.has(String(it.id))) continue;
        byId.set(String(it.id), {
          ...blankRaw('jobicy'),
          source_id: String(it.id),
          title: plainText(it.jobTitle, 200),
          company: str(it.companyName),
          job_url: str(it.url),
          location: str(it.jobGeo) || 'Remote',
          remote: 'Remote',
          candidate_location: str(it.jobGeo),
          salary: formatSalary(it.annualSalaryMin, it.annualSalaryMax, it.salaryCurrency, 'YEAR'),
          posted_date: isoDate(it.pubDate),
          employment_type: Array.isArray(it.jobType) ? it.jobType.join(', ') : str(it.jobType),
          seniority: str(it.jobLevel),
          skills: Array.isArray(it.jobIndustry) ? it.jobIndustry.join(', ') : '',
          description: plainText(it.jobDescription ?? it.jobExcerpt),
        });
      }
    }
    return [...byId.values()];
  },
};

// ---------------------------------------------------------------- We Work Remotely (RSS)
export const wwr: FreeSource = {
  name: 'wwr',
  describe: (cfg) => `${cfg.sources.wwr.feeds.length} RSS feeds`,
  async fetch(cfg) {
    const byId = new Map<string, RawJob>();
    for (const [i, feed] of cfg.sources.wwr.feeds.entries()) {
      if (i) await sleep(500);
      const xml = await getText(`https://weworkremotely.com/categories/${feed}.rss`);
      for (const it of rssItems(xml)) {
        const link = str(it.link);
        const id = str(it.guid) || link;
        if (!it.title || !id || byId.has(id)) continue;
        const sep = it.title.indexOf(': ');
        const company = sep > 0 ? it.title.slice(0, sep).trim() : '';
        const title = sep > 0 ? it.title.slice(sep + 2).trim() : it.title.trim();
        byId.set(id, {
          ...blankRaw('wwr'),
          source_id: id.replace(/.*\//, '') || id,
          title: plainText(title, 200),
          company,
          job_url: link,
          location: [str(it.country), str(it.state)].filter(Boolean).join(', ') || str(it.region),
          remote: 'Remote',
          candidate_location: str(it.region),
          posted_date: isoDate(it.pubDate),
          employment_type: str(it.type),
          skills: str(it.skills),
          description: plainText(it.description),
        });
      }
    }
    return [...byId.values()];
  },
};

// ---------------------------------------------------------------- Working Nomads (public API)
export const workingnomads: FreeSource = {
  name: 'workingnomads',
  describe: () => '1 request (development category)',
  async fetch() {
    const data = await getJson<any[]>('https://www.workingnomads.com/api/exposed_jobs/');
    return data
      .filter((it) => it?.title && it?.url && /develop|engineer|programm/i.test(str(it.category_name)))
      .map((it) => ({
        ...blankRaw('workingnomads'),
        source_id: /\/(\d+)\/?$/.exec(str(it.url))?.[1] ?? str(it.url),
        title: plainText(it.title, 200),
        company: str(it.company_name),
        job_url: str(it.url),
        location: str(it.location) || 'Remote',
        remote: 'Remote',
        candidate_location: str(it.location),
        posted_date: isoDate(it.pub_date),
        skills: str(it.tags),
        description: plainText(it.description),
      }));
  },
};

// ---------------------------------------------------------------- Arbeitnow (public API, mostly EU/Germany)
export const arbeitnow: FreeSource = {
  name: 'arbeitnow',
  describe: (cfg) => `${cfg.sources.arbeitnow.pages} pages (remote jobs only)`,
  async fetch(cfg) {
    const out: RawJob[] = [];
    for (let page = 1; page <= cfg.sources.arbeitnow.pages; page++) {
      if (page > 1) await sleep(800);
      const data = await getJson<{ data?: any[] }>(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      const rows = data.data ?? [];
      if (!rows.length) break;
      for (const it of rows) {
        if (!it?.remote || !it?.title) continue;
        out.push({
          ...blankRaw('arbeitnow'),
          source_id: str(it.slug),
          title: plainText(it.title, 200),
          company: str(it.company_name),
          job_url: str(it.url),
          location: str(it.location) || 'Remote',
          remote: 'Remote',
          posted_date: isoDate(it.created_at),
          employment_type: Array.isArray(it.job_types) ? it.job_types.join(', ') : '',
          skills: Array.isArray(it.tags) ? it.tags.join(', ') : '',
          description: plainText(it.description),
        });
      }
    }
    return out;
  },
};

export const FREE_SOURCES: Record<FreeSourceName, FreeSource> = { remoteok, jobicy, wwr, workingnomads, arbeitnow };
