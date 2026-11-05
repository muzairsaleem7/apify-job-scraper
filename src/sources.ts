/** Apify-backed sources: how each search is built and how each Actor's output maps to a RawJob. */
import { daysAgo, formatSalary, isoDate, plainText, str, unique, windowDays } from './util.ts';
import type { ApifySource, ApifySourceName, Config, PlanContext, RawJob, SearchTask } from './types.ts';

/** ["Full Stack Developer", "Programmer"] -> ("Full Stack Developer" OR Programmer) */
export const booleanQuery = (terms: string[]) => `(${terms.map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' OR ')})`;

/** Each term is searched once: later groups lose terms an earlier group already covers (saves paid results). */
export function dedupeGroups(groups: string[][]): string[][] {
  const seen = new Set<string>();
  return groups
    .map((g) =>
      g.filter((t) => {
        const k = t.toLowerCase().trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      }),
    )
    .filter((g) => g.length);
}

export const blankRaw = (source: RawJob['source']): RawJob => ({
  source, source_id: '', title: '', company: '', job_url: '', apply_url: '', location: '', remote: '', candidate_location: '', salary: '',
  posted_date: '', employment_type: '', seniority: '', company_url: '', recruiter_name: '', recruiter_url: '', applicants: '', easy_apply: '',
  skills: '', description: '', industry: '',
});

const cap = (n: number, ctx: PlanContext) => (ctx.limitCap ? Math.max(1, Math.min(n, ctx.limitCap)) : n);
const values = (o: unknown): string[] => (o && typeof o === 'object' ? Object.values(o as Record<string, unknown>).map(str) : []);

// ---------------------------------------------------------------- LinkedIn
export const linkedin: ApifySource = {
  name: 'linkedin',
  plan(cfg, w, ctx) {
    const s = cfg.sources.linkedin;
    const days = windowDays(w);
    const datePosted = days <= 1 ? 'r86400' : days <= 7 ? 'r604800' : 'r2592000';
    const titleInclude = unique(cfg.titleGroups.flat());
    const skipJobId = ctx.seenIds('linkedin');
    const limit = cap(s.limitPerSearch, ctx);
    return dedupeGroups(cfg.titleGroups).flatMap((group) =>
      s.locations.map(
        (location): SearchTask => ({
          source: 'linkedin',
          actorId: s.actorId,
          query: booleanQuery(group),
          location,
          maxItems: limit,
          pricePerItemUsd: s.pricePerItemUsd,
          timeoutSecs: 600,
          input: {
            // LinkedIn's public search ignores its workplace filter (f_WT), so "remote" goes in the keywords.
            keywords: s.remoteOnly ? `${booleanQuery(group)} AND remote` : booleanQuery(group),
            location,
            datePosted,
            limit,
            titleInclude, // server-side: only titles matching your list are returned (and paid for)
            titleExclude: cfg.excludeTitleWords,
            ...(skipJobId.length ? { skipJobId } : {}), // jobs already in history: the Actor skips them and fills with new ones
          },
        }),
      ),
    );
  },
  normalize(it) {
    if (!it?.title) return null;
    return {
      ...blankRaw('linkedin'),
      source_id: str(it.id),
      title: str(it.title),
      company: str(it.companyName),
      job_url: str(it.url),
      apply_url: str(it.applyUrl),
      location: str(it.location),
      salary: str(it.salary),
      posted_date: isoDate(it.postedDate),
      employment_type: str(it.contractType),
      seniority: str(it.experienceLevel),
      company_url: str(it.companyUrl),
      recruiter_name: str(it.recruiterName),
      recruiter_url: str(it.recruiterUrl),
      applicants: str(it.applicationsCount),
      easy_apply: it.applyType ? (it.applyType === 'EASY_APPLY' ? 'Yes' : 'No') : '',
      description: plainText(it.description),
      industry: [str(it.workType), str(it.sector)].filter(Boolean).join(', '),
    };
  },
};

// ---------------------------------------------------------------- Indeed
export const indeed: ApifySource = {
  name: 'indeed',
  plan(cfg, w, ctx) {
    const s = cfg.sources.indeed;
    const days = windowDays(w);
    const datePosted = days <= 1 ? '1' : days <= 3 ? '3' : days <= 7 ? '7' : '14';
    const limit = cap(s.limitPerSearch, ctx);
    return dedupeGroups(cfg.titleGroups).flatMap((group) =>
      s.countries.map(
        (country): SearchTask => ({
          source: 'indeed',
          actorId: s.actorId,
          query: booleanQuery(group),
          location: `${country.toUpperCase()} / remote`,
          maxItems: limit,
          pricePerItemUsd: s.pricePerItemUsd,
          timeoutSecs: 600,
          input: { country, title: booleanQuery(group), location: 'remote', datePosted, limit },
        }),
      ),
    );
  },
  normalize(it) {
    if (!it?.title) return null;
    const loc = it.location ?? {};
    const attrs = [...values(it.attributes), ...values(it.jobTypes), ...values(it.employerAttributes)];
    const sal = it.baseSalary ?? {};
    return {
      ...blankRaw('indeed'),
      source_id: str(it.key),
      title: str(it.title),
      company: str(it.employer?.name),
      job_url: str(it.url),
      apply_url: str(it.jobUrl),
      location: typeof loc === 'string' ? loc : [loc.city, loc.admin1Code, loc.countryName].map(str).filter(Boolean).join(', '),
      remote: attrs.some((a) => /\bremote\b/i.test(a)) ? 'Remote' : attrs.some((a) => /hybrid/i.test(a)) ? 'Hybrid' : '',
      salary: formatSalary(sal.min, sal.max, sal.currencyCode, sal.unitOfWork),
      posted_date: isoDate(it.datePublished ?? it.dateOnIndeed),
      employment_type: values(it.jobTypes).join(', '),
      seniority: attrs.find((a) => /level|years/i.test(a)) ?? '',
      company_url: str(it.employer?.corporateWebsite || it.employer?.companyPageUrl),
      skills: attrs.filter((a) => !/level|years|insurance|time off|401|holiday|hybrid|remote|full-time|part-time|degree/i.test(a)).join(', '),
      description: plainText(it.description?.text ?? it.description),
      industry: str(it.employer?.industry),
    };
  },
};

// ---------------------------------------------------------------- Glassdoor
export const glassdoor: ApifySource = {
  name: 'glassdoor',
  plan(cfg, w, ctx) {
    const s = cfg.sources.glassdoor;
    const limit = cap(s.limitPerSearch, ctx);
    const excludeJobIds = ctx.seenIds('glassdoor');
    return s.keywords.flatMap((keywords) =>
      s.locations.map(
        (location): SearchTask => ({
          source: 'glassdoor',
          actorId: s.actorId,
          query: keywords,
          location,
          maxItems: limit,
          pricePerItemUsd: s.pricePerItemUsd,
          timeoutSecs: 600,
          input: {
            keywords,
            location,
            daysOld: windowDays(w),
            remoteWorkType: true,
            sortBy: 'date_desc',
            limit,
            ...(excludeJobIds.length ? { excludeJobIds } : {}),
          },
        }),
      ),
    );
  },
  normalize(it) {
    if (!it?.title) return null;
    const pay = it.pay ?? {};
    return {
      ...blankRaw('glassdoor'),
      source_id: str(it.id),
      title: str(it.title),
      company: str(it.employer?.name),
      job_url: str(it.seoUrl || it.url),
      location: str(it.location?.name ?? it.location),
      salary: formatSalary(pay.min, pay.max, pay.currency, pay.period),
      posted_date: typeof it.ageInDays === 'number' ? daysAgo(it.ageInDays) : '',
      company_url: str(it.employer?.url),
      easy_apply: typeof it.easyApply === 'boolean' ? (it.easyApply ? 'Yes' : 'No') : '',
      description: plainText(it.description),
    };
  },
};

// ---------------------------------------------------------------- Wellfound
const REMOTE_KIND: Record<string, string> = { ONSITE: 'On-site', HYBRID: 'Hybrid', REMOTE: 'Remote' };

export const wellfound: ApifySource = {
  name: 'wellfound',
  plan(cfg, w, ctx) {
    const s = cfg.sources.wellfound;
    return [
      {
        source: 'wellfound',
        actorId: s.actorId,
        query: [s.roles.join(', '), s.query].filter(Boolean).join(' + '),
        location: 'remote',
        maxItems: cap(s.maxResults, ctx),
        pricePerItemUsd: s.pricePerItemUsd,
        timeoutSecs: 1800,
        input: {
          roles: s.roles,
          ...(s.query ? { query: s.query } : {}),
          remote: true,
          maxResults: cap(s.maxResults, ctx),
          maxAgeMinutes: windowDays(w) * 1440,
          descriptionFormat: 'text',
          descriptionMaxLength: 6000,
          excludeKeywords: { keywords: cfg.excludeTitleWords, matchTitle: true, matchDescription: false, matchSkills: false },
        },
      },
    ];
  },
  normalize(it) {
    if (!it?.title) return null;
    return {
      ...blankRaw('wellfound'),
      source_id: str(it.id),
      title: str(it.title),
      company: str(it.companyName),
      job_url: str(it.portalUrl || it.detailUrl),
      location: Array.isArray(it.locationNames) ? it.locationNames.join('; ') : str(it.locationNames),
      remote: it.remote ? 'Remote' : (REMOTE_KIND[str(it.remoteKind)] ?? ''),
      salary: str(it.compensation) || formatSalary(it.salaryMin, it.salaryMax, it.salaryCurrency, it.salaryPeriod),
      posted_date: isoDate(it.postedAt ?? it.datePosted),
      employment_type: str(it.jobType),
      seniority: typeof it.yearsExperienceMin === 'number' ? `${it.yearsExperienceMin}+ years` : '',
      company_url: str(it.companyWebsite),
      skills: Array.isArray(it.skills) ? it.skills.join(', ') : '',
      description: plainText(it.description ?? it.descriptionMarkdown),
      industry: str(it.industry),
    };
  },
};

export const APIFY_SOURCES: Record<ApifySourceName, ApifySource> = { linkedin, indeed, glassdoor, wellfound };
