export type Window = '24h' | '3d' | '7d' | '14d' | '30d';

export type ApifySourceName = 'linkedin' | 'indeed' | 'glassdoor' | 'wellfound';
export type FreeSourceName = 'remoteok' | 'jobicy' | 'wwr' | 'workingnomads' | 'arbeitnow';
export type SourceName = ApifySourceName | FreeSourceName;

/** What a source adapter returns for one listing. `description` is the FULL plain text (used for classification). */
export interface RawJob {
  source: SourceName;
  source_id: string;
  title: string;
  company: string;
  job_url: string;
  apply_url: string;
  location: string;
  /** Workplace type if the source states it ('Remote', 'Hybrid', 'On-site'); '' = unknown. */
  remote: string;
  /** Where candidates must live, if the source states it (e.g. "USA Only", "Anywhere in the World"). */
  candidate_location: string;
  salary: string;
  posted_date: string;
  employment_type: string;
  seniority: string;
  company_url: string;
  recruiter_name: string;
  recruiter_url: string;
  applicants: string;
  easy_apply: string;
  skills: string;
  description: string;
  /** Company industry, when the source gives it (used to spot staffing agencies). */
  industry: string;
}

/** One row of the CSV. Column order is CSV_COLUMNS in store.ts. */
export interface Job extends Omit<RawJob, 'industry'> {
  score: number;
  score_reasons: string;
  remote_scope: string;
  salary_usd_year_est: string;
  other_locations: string;
  first_seen: string;
  last_seen: string;
  times_seen: number;
  also_found_on: string;
  tech: string;
  stack_match: string;
  flags: string;
  other_job_urls: string;
  search_query: string;
  search_location: string;
  job_key: string;
  scraped_at: string;
}

/** One Apify Actor run to perform. */
export interface SearchTask {
  source: ApifySourceName;
  actorId: string;
  input: Record<string, unknown>;
  query: string;
  location: string;
  maxItems: number;
  pricePerItemUsd: number;
  timeoutSecs: number;
}

export interface PlanContext {
  /** IDs of jobs already in the history for a source, newest first (sent to Actors that can skip them). */
  seenIds(source: ApifySourceName): string[];
  /** Optional cap on items per search (the --limit flag). */
  limitCap?: number;
}

export interface ApifySource {
  name: ApifySourceName;
  plan(config: Config, window: Window, ctx: PlanContext): SearchTask[];
  normalize(item: any, task: SearchTask): RawJob | null;
}

export interface FreeSource {
  name: FreeSourceName;
  /** Human description of what is fetched (for the plan printout). */
  describe(config: Config): string;
  fetch(config: Config, window: Window): Promise<RawJob[]>;
}

export interface Config {
  window: Window;
  titleGroups: string[][];
  excludeTitleWords: string[];
  offStackTitleWords: string[];
  dropOffStackTitles: boolean;
  strictTitleFilter: boolean;
  dropHybridOnsite: boolean;
  dropFlags: string[];
  candidate: {
    stack: string[];
    eligibleRegions: string[];
    minSalaryUsdYear: number;
  };
  reNewAfterDays: number;
  /** Google Sheets export used by the web UI (npm start). */
  sheets: {
    /** Drive folder that holds every spreadsheet the app makes. */
    folderName: string;
    /** One spreadsheet that collects every new job across runs; your statuses live here. */
    trackerName: string;
    /** Choices in the Status dropdown, first = default for new rows. `color` is a hex background. */
    statuses: { name: string; color: string }[];
  };
  descriptionChars: number;
  concurrency: number;
  maxCostPerScrapeUsd: number;
  minTokenBalanceUsd: number;
  sources: {
    linkedin: { enabled: boolean; actorId: string; pricePerItemUsd: number; limitPerSearch: number; locations: string[]; remoteOnly: boolean };
    indeed: { enabled: boolean; actorId: string; pricePerItemUsd: number; limitPerSearch: number; countries: string[] };
    glassdoor: { enabled: boolean; actorId: string; pricePerItemUsd: number; limitPerSearch: number; keywords: string[]; locations: string[] };
    wellfound: { enabled: boolean; actorId: string; pricePerItemUsd: number; maxResults: number; roles: string[]; query: string };
    remoteok: { enabled: boolean; tags: string[] };
    jobicy: { enabled: boolean; tags: string[] };
    wwr: { enabled: boolean; feeds: string[] };
    workingnomads: { enabled: boolean };
    arbeitnow: { enabled: boolean; pages: number };
  };
}
