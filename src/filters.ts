import { daysAgo, phraseMatcher, unique, windowDays } from './util.ts';
import type { Config, Job, SourceName, Window } from './types.ts';

export interface FilterStats {
  excluded: number;
  offTitle: number;
  offStack: number;
  notRemote: number;
  flagged: number;
  tooOld: number;
}

export const emptyStats = (): FilterStats => ({ excluded: 0, offTitle: 0, offStack: 0, notRemote: 0, flagged: 0, tooOld: 0 });

/** Words in a title that mark it as a JavaScript-stack role (so an off-stack word next to them is fine). */
const JS_TITLE_WORDS = ['javascript', 'typescript', 'react', 'next', 'node', 'mern', 'mean', 'express', 'nest', 'vue', 'angular', 'svelte', 'remix', 'js', 'ts'];

export function makeFilter(cfg: Config, window: Window, now = Date.now()) {
  const matchesTitle = phraseMatcher(cfg.titleGroups.flat());
  const isExcluded = phraseMatcher(cfg.excludeTitleWords);
  const offStack = phraseMatcher(cfg.offStackTitleWords);
  const onStack = phraseMatcher(JS_TITLE_WORDS);
  const dropFlags = new Set(cfg.dropFlags);
  // Date-only values and time zones blur the edge, so allow one extra day.
  const oldest = daysAgo(windowDays(window) + 1, now);

  const reasonFor = (j: Job): keyof FilterStats | null => {
    if (isExcluded(j.title)) return 'excluded';
    if (cfg.strictTitleFilter && !matchesTitle(j.title)) return 'offTitle';
    if (cfg.dropOffStackTitles && offStack(j.title) && !onStack(j.title)) return 'offStack';
    if (cfg.dropHybridOnsite && (j.remote === 'Hybrid' || j.remote === 'On-site')) return 'notRemote';
    if (j.flags && j.flags.split(', ').some((f) => dropFlags.has(f))) return 'flagged';
    if (j.posted_date && j.posted_date < oldest) return 'tooOld';
    return null;
  };

  return (jobs: Job[], stats: FilterStats): Job[] =>
    jobs.filter((j) => {
      const reason = reasonFor(j);
      if (reason) stats[reason]++;
      return reason === null;
    });
}

/** Source preference when the same job shows up in several places (richer data first). */
const PRIORITY: SourceName[] = ['linkedin', 'wellfound', 'jobicy', 'wwr', 'glassdoor', 'indeed', 'remoteok', 'workingnomads', 'arbeitnow'];
const FILL: (keyof Job)[] = ['salary', 'salary_usd_year_est', 'apply_url', 'posted_date', 'recruiter_name', 'recruiter_url', 'company_url', 'skills', 'candidate_location', 'remote_scope', 'employment_type', 'seniority', 'description'];

const addList = (current: string, item: string, max: number, sep = '; '): string => {
  if (!item) return current;
  const list = current ? current.split(sep) : [];
  if (list.includes(item) || list.length >= max) return current;
  return [...list, item].join(sep);
};

/** Merge rows with the same job_key. Keeps the richest row and folds the others' links/locations into it. */
export function dedupe(jobs: Job[]): Job[] {
  const sorted = [...jobs].sort((a, b) => PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source));
  const byKey = new Map<string, Job>();
  for (const j of sorted) {
    const kept = byKey.get(j.job_key);
    if (!kept) {
      byKey.set(j.job_key, { ...j });
      continue;
    }
    if (j.source !== kept.source) kept.also_found_on = unique([...(kept.also_found_on ? kept.also_found_on.split(', ') : []), j.source]).join(', ');
    if (j.job_url !== kept.job_url) kept.other_job_urls = addList(kept.other_job_urls, j.job_url, 5);
    if (j.location && j.location !== kept.location) kept.other_locations = addList(kept.other_locations, j.location, 6);
    for (const f of FILL) if (!kept[f] && j[f]) (kept as any)[f] = j[f];
    // Longer tech/flag lists win (the duplicate may have had the fuller description).
    if (j.tech.length > kept.tech.length) {
      kept.tech = j.tech;
      kept.stack_match = j.stack_match;
    }
    if (j.flags.length > kept.flags.length) kept.flags = j.flags;
    if (kept.remote !== 'Remote' && j.remote === 'Remote') kept.remote = j.remote;
  }
  return [...byKey.values()];
}
