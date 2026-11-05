import baseConfig from '../config.ts';
import type { Config, Job, RawJob } from '../src/types.ts';

export const testConfig = (overrides: Partial<Config> = {}): Config => ({ ...structuredClone(baseConfig), ...overrides });

export const rawJob = (o: Partial<RawJob> = {}): RawJob => ({
  source: 'linkedin', source_id: '1', title: 'Senior Full Stack Engineer', company: 'Acme Inc', job_url: 'https://example.com/j/1', apply_url: '',
  location: 'Austin, TX', remote: '', candidate_location: '', salary: '', posted_date: '2026-11-05', employment_type: 'Full-time', seniority: '',
  company_url: '', recruiter_name: '', recruiter_url: '', applicants: '', easy_apply: '', skills: '', description: 'Fully remote role. React, Node.js and TypeScript.', industry: '',
  ...o,
});

export const job = (o: Partial<Job> = {}): Job => ({
  source: 'linkedin', source_id: '1', title: 'Senior Full Stack Engineer', company: 'Acme Inc', job_url: 'https://example.com/j/1', apply_url: '',
  location: 'Austin, TX', remote: 'Remote', candidate_location: '', salary: '', posted_date: '2026-11-05', employment_type: 'Full-time', seniority: 'senior',
  company_url: '', recruiter_name: '', recruiter_url: '', applicants: '', easy_apply: '', skills: '', description: '',
  score: 0, score_reasons: '', remote_scope: '', salary_usd_year_est: '', other_locations: '', first_seen: '', last_seen: '', times_seen: 0,
  also_found_on: '', tech: '', stack_match: '', flags: '', other_job_urls: '', search_query: '', search_location: '', job_key: 'acme|senior fullstack engineer', scraped_at: '2026-11-05T00:00:00.000Z',
  ...o,
});

type FetchHandler = (url: string, init?: RequestInit) => { status?: number; body?: unknown; text?: string } | Promise<{ status?: number; body?: unknown; text?: string }>;

/** Replace global fetch with a handler for the duration of a test. Returns the list of requested URLs and a restore function. */
export function mockFetch(handler: FetchHandler) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    const r = await handler(url, init);
    const text = r.text ?? (r.body === undefined ? '' : JSON.stringify(r.body));
    return new Response(text, { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}
