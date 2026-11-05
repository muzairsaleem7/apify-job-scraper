/**
 * Relevance score (0–100) for a job, with the reasons that produced it.
 * Starts at 40; every signal adds or subtracts. Tune the numbers here, not elsewhere.
 * After changing anything here run `npm run rescore` to re-rank existing results.
 */
import { JS_ECOSYSTEM, OTHER_STACKS } from './text.ts';
import { normalizeText, phraseMatcher, str } from './util.ts';
import type { Config, Job } from './types.ts';

export interface Scored {
  score: number;
  reasons: string[];
}

const SOURCE_PRIOR: Partial<Record<Job['source'], number>> = { wellfound: 3, wwr: 3, remoteok: 2, jobicy: 1, workingnomads: 1 };

/** Languages and frameworks (the things that define a stack), from both ecosystems. */
const PRIMARY_TECH = new Set([...JS_ECOSYSTEM, ...OTHER_STACKS].filter((x) => !['MongoDB', 'Redux', 'Tailwind', 'GraphQL', 'tRPC', 'Prisma'].includes(x)));

export function scoreJob(job: Job, cfg: Config, today = new Date().toISOString().slice(0, 10)): Scored {
  const offStackInTitle = phraseMatcher(cfg.offStackTitleWords);
  let score = 40;
  const reasons: string[] = [];
  const add = (points: number, why: string) => {
    if (!points) return;
    score += points;
    reasons.push(`${points > 0 ? '+' : ''}${points} ${why}`);
  };

  // ---- title
  const t = ` ${normalizeText(job.title)} `;
  if (/ fullstack /.test(t)) add(10, 'full-stack title');
  else if (/ (frontend|backend|web) /.test(t)) add(4, 'frontend/backend/web title');
  if (/ (react|next|node|typescript|javascript|mern|js) /.test(t)) add(8, 'your stack in title');

  // ---- tech stack
  const tech = job.tech ? job.tech.split(', ') : [];
  const matched = job.stack_match ? job.stack_match.split(', ') : [];
  if (matched.length) add(Math.min(18, matched.length * 3), `stack match: ${matched.slice(0, 4).join(', ')}${matched.length > 4 ? '…' : ''}`);
  // Languages/frameworks decide the stack; databases and tools (MongoDB, Redux, AWS) are shared by every stack.
  const myPrimary = matched.filter((x) => PRIMARY_TECH.has(x));
  const otherPrimary = tech.filter((x) => OTHER_STACKS.has(x));
  if (otherPrimary.length && !myPrimary.length) add(otherPrimary.length >= 2 ? -12 : -6, `built on ${otherPrimary.slice(0, 3).join('/')}`);
  if (offStackInTitle(job.title) && !myPrimary.length) add(-6, 'another stack in the title');

  // ---- workplace
  switch (job.remote) {
    case 'Remote':
      add(10, 'remote');
      break;
    case 'Remote + hybrid/on-site':
      add(-2, 'remote but also hybrid/on-site');
      break;
    case 'Hybrid':
      add(-25, 'hybrid');
      break;
    case 'On-site':
      add(-30, 'on-site');
      break;
    default:
      add(3, 'remote per search filter');
  }

  // ---- where you must live
  const scope = job.remote_scope;
  const eligible = cfg.candidate.eligibleRegions.map((r) => r.toLowerCase());
  if (scope === 'Worldwide') add(12, 'worldwide');
  else if (scope) {
    const regions = scope.split(', ').map((r) => r.toLowerCase());
    if (eligible.length && regions.some((r) => eligible.includes(r))) add(6, `restricted to a region you can work in (${scope})`);
    else add(eligible.length ? -12 : -8, `restricted to ${scope}`);
  }

  // ---- flags
  const flags = job.flags ? job.flags.split(', ') : [];
  for (const f of flags) {
    if (f === 'clearance') add(-40, 'security clearance');
    else if (f === 'citizenship') add(-25, 'citizenship required');
    else if (f === 'no-sponsorship') add(-6, 'no visa sponsorship');
    else if (f === 'sponsorship-offered') add(4, 'visa sponsorship offered');
    else if (f === 'agency') add(-8, 'staffing agency');
    else if (f === 'part-time') add(-8, 'part-time');
    else if (f === 'w2') add(-4, 'W-2 only (US payroll)');
    else if (f === 'tz-overlap') add(-2, 'time-zone overlap required');
  }

  // ---- seniority
  switch (job.seniority.split(' ')[0]) {
    case 'senior':
    case 'lead':
      add(8, `${job.seniority.split(' ')[0]} level`);
      break;
    case 'mid':
      add(5, 'mid level');
      break;
    case 'staff':
      add(2, 'staff level');
      break;
    case 'principal':
      add(-4, 'principal level');
      break;
    case 'junior':
    case 'intern':
      add(-20, job.seniority);
      break;
    case 'manager':
      add(-15, 'management role');
      break;
  }

  // ---- salary
  const usd = Number(job.salary_usd_year_est);
  if (job.salary) add(4, 'salary shown');
  if (usd) {
    if (usd >= 120_000) add(8, `≈$${Math.round(usd / 1000)}k/yr`);
    else if (usd >= 80_000) add(4, `≈$${Math.round(usd / 1000)}k/yr`);
    else if (usd < cfg.candidate.minSalaryUsdYear) add(-8, `≈$${Math.round(usd / 1000)}k/yr, below your minimum`);
  }

  // ---- contact & competition
  if (job.recruiter_name) add(5, 'recruiter contact');
  const a = str(job.applicants).toLowerCase();
  if (/first 25|fewer than 10|under 10|early applicant|be among the first/.test(a)) add(5, 'few applicants');
  else if (/over 200|200\+|over 100/.test(a)) add(-5, 'many applicants');
  if (job.easy_apply === 'Yes') add(1, 'easy apply');

  // ---- freshness & reach
  if (job.posted_date) {
    const age = Math.round((Date.parse(today) - Date.parse(job.posted_date)) / 86_400_000);
    if (age <= 0) add(4, 'posted today');
    else if (age <= 2) add(2, 'posted in last 2 days');
    else if (age >= 14) add(-3, `posted ${age} days ago`);
  }
  if (job.also_found_on) add(3, `also on ${job.also_found_on}`);
  add(SOURCE_PRIOR[job.source] ?? 0, 'remote-first board');

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, reasons };
}
