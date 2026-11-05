/** Turns a source's RawJob into a full Job row: classifications, tech, seniority, salary estimate, key. */
import { annualUsd, eligibilityFlags, extractTech, parseSalary, remoteScope, seniorityOf, stackMatch, workplace } from './text.ts';
import { normalizeText, plainText } from './util.ts';
import type { Config, Job, RawJob } from './types.ts';

const COMPANY_SUFFIX = / (inc|llc|ltd|limited|gmbh|corp|corporation|co|plc|bv|ag|sa|pvt|pty|srl|sas)$/;

/** Same company + same title = same job, whichever site it came from. */
export function jobKey(company: string, title: string, url: string): string {
  const c = normalizeText(company).replace(COMPANY_SUFFIX, '').trim();
  const t = normalizeText(title);
  return c && t ? `${c}|${t}` : `url|${url}`;
}

export interface EnrichMeta {
  query: string;
  location: string;
  scrapedAt: string;
}

export function enrich(raw: RawJob, cfg: Config, meta: EnrichMeta): Job {
  const fullText = [raw.title, raw.location, raw.candidate_location, raw.employment_type, raw.description].join(' \n ');

  // Workplace: trust the source's label, but if the text also talks hybrid/on-site, say so.
  const textWorkplace = workplace(fullText);
  let remote = raw.remote;
  if (!remote) remote = textWorkplace;
  else if (remote === 'Remote' && textWorkplace && textWorkplace !== 'Remote') remote = 'Remote + hybrid/on-site';

  const scope = remoteScope(fullText, raw.candidate_location);
  const flags = eligibilityFlags(fullText, { employmentType: raw.employment_type, industry: raw.industry, company: raw.company });
  const tech = extractTech(`${raw.title}. ${raw.skills}. ${raw.description}`);
  const matched = stackMatch(tech, cfg.candidate.stack);
  const level = seniorityOf(raw.title, raw.seniority);
  const seniority = level ? (raw.seniority && /\d/.test(raw.seniority) ? `${level} (${raw.seniority})` : level) : /not applicable|^any$/i.test(raw.seniority) ? '' : raw.seniority;
  const usd = annualUsd(parseSalary(raw.salary));

  const { industry: _industry, ...rest } = raw;
  return {
    ...rest,
    remote,
    seniority,
    description: plainText(raw.description, cfg.descriptionChars),
    score: 0,
    score_reasons: '',
    remote_scope: scope.label,
    salary_usd_year_est: usd ? String(usd) : '',
    other_locations: '',
    first_seen: '',
    last_seen: '',
    times_seen: 0,
    also_found_on: '',
    tech: tech.join(', '),
    stack_match: matched.join(', '),
    flags: flags.join(', '),
    other_job_urls: '',
    search_query: meta.query,
    search_location: meta.location,
    job_key: jobKey(raw.company, raw.title, raw.job_url),
    scraped_at: meta.scrapedAt,
  };
}
