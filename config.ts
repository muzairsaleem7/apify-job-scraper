import type { Config } from './src/types.ts';

/**
 * Everything you are likely to tweak lives here.
 * Prices are Apify FREE-plan per-result prices (Nov 2026) and are only used
 * for cost estimates and per-run spending caps.
 */
const config: Config = {
  // Default window when you run `npm run scrape` without --window. One of: 24h, 3d, 7d, 14d, 30d.
  window: '24h',

  // Your four title groups. Each group becomes one boolean (OR) search on LinkedIn and Indeed,
  // every title is sent to LinkedIn as a server-side title filter, and all titles feed the local title filter.
  // A title that appears in two groups is searched once (first group wins) so you don't pay twice.
  titleGroups: [
    ['Full Stack Developer', 'Software Engineer', 'Software Developer', 'Web Developer', 'Application Developer', 'Programmer', 'Full Stack Engineer'],
    ['Frontend Developer', 'Backend Developer', 'Full Stack Developer', 'Frontend Engineer', 'Backend Engineer', 'Full Stack Engineer', 'Web Engineer'],
    ['React Developer', 'Node.js Developer', 'JavaScript Developer', 'TypeScript Developer', 'Next.js Developer', 'MERN Stack Developer', 'Full Stack JavaScript Developer'],
    ['Software Engineer', 'Software Developer', 'Application Engineer', 'Product Engineer', 'Platform Engineer', 'Systems Developer', 'SaaS Developer', 'Technical Developer'],
  ],

  // Titles containing any of these are dropped (whole words, any order).
  excludeTitleWords: [
    // too junior for 5+ years
    'intern', 'internship', 'junior', 'entry level', 'graduate', 'trainee', 'apprentice', 'student', 'werkstudent', 'fresher',
    // management, not hands-on
    'director', 'vp', 'vice president', 'head of', 'chief', 'cto', 'manager',
    // other disciplines that still contain "engineer"/"developer"
    'qa', 'sdet', 'tester', 'in test', 'quality assurance', 'security', 'devops', 'sre', 'site reliability', 'data engineer', 'machine learning',
    'embedded', 'firmware', 'hardware', 'network engineer', 'support engineer', 'sales engineer', 'solutions engineer', 'implementation',
    'salesforce', 'sap', 'servicenow', 'sharepoint', 'dynamics 365', 'mainframe', 'cobol', 'abap', 'workday', 'game', 'unity', 'unreal',
    'ios', 'android', 'flutter', 'swift', 'kotlin',
  ],

  // A title built on one of these is dropped UNLESS it also names your stack
  // ("Java Developer" goes; "Full Stack Developer (Java/React)" stays).
  offStackTitleWords: ['dotnet', 'csharp', 'cpp', 'java', 'golang', 'go', 'rust', 'php', 'laravel', 'symfony', 'ruby', 'rails', 'python', 'django', 'flask', 'fastapi', 'scala', 'elixir', 'erlang', 'haskell', 'clojure', 'perl', 'drupal', 'magento', 'delphi'],
  dropOffStackTitles: true,

  // true = keep only jobs whose title matches one of the titles above
  // (word order and hyphens don't matter: "Engineer, Full-Stack" matches "Full Stack Engineer").
  strictTitleFilter: true,

  // Job sites don't label remote reliably, so the workplace type is also read from the description.
  // true = drop jobs that say hybrid/on-site and never mention remote.
  dropHybridOnsite: true,

  // Jobs carrying any of these flags are dropped. Others only lower the score. See README for the list.
  dropFlags: ['clearance'],

  candidate: {
    // Used for the "stack match" column and score. Spell them like a job post would.
    stack: ['JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Express', 'NestJS', 'MongoDB', 'PostgreSQL', 'GraphQL', 'REST', 'Redux', 'Tailwind', 'Prisma', 'AWS', 'Docker'],
    // Regions where you can legally work without sponsorship, e.g. ['Worldwide', 'EU', 'UK'].
    // Jobs restricted to other regions get a score penalty (they are not dropped: check the remote_scope column).
    eligibleRegions: [],
    // Below this estimated annual USD salary the score is penalised.
    minSalaryUsdYear: 30_000,
  },

  // A job seen again after this many days counts as new again (likely a new opening).
  reNewAfterDays: 45,

  // Google Sheets (web UI only: npm start). Every run is saved as a spreadsheet in `folderName`,
  // and its new jobs are added to the `trackerName` spreadsheet, where you keep each job's status.
  sheets: {
    folderName: 'Job Scraper',
    trackerName: 'Job Tracker',
    statuses: [
      { name: 'New', color: '#e8f0fe' },
      { name: 'Interested', color: '#fef7e0' },
      { name: 'Applied', color: '#d2e3fc' },
      { name: 'Recruiter contacted', color: '#e9d7fe' },
      { name: 'Interviewing', color: '#ceead6' },
      { name: 'Offer', color: '#81c995' },
      { name: 'Rejected', color: '#fad2cf' },
      { name: 'Not interested', color: '#e8eaed' },
      { name: 'Closed / expired', color: '#dadce0' },
    ],
  },

  // Characters of job description kept in the CSV.
  descriptionChars: 300,

  // Apify runs in parallel. The free plan allows 8 GB of Actor memory in total.
  concurrency: 6,

  // Safety net: the scrape is refused if the worst-case estimate is higher (override with --force).
  maxCostPerScrapeUsd: 1.0,

  // A token whose remaining monthly credit is below this is skipped.
  minTokenBalanceUsd: 0.05,

  sources: {
    linkedin: {
      enabled: true,
      actorId: 'valig/linkedin-jobs-scraper',
      pricePerItemUsd: 0.0004,
      limitPerSearch: 25,
      locations: ['United States', 'Canada', 'United Kingdom', 'European Union', 'United Arab Emirates', 'Australia'],
      remoteOnly: true,
    },
    indeed: {
      enabled: true,
      actorId: 'valig/indeed-jobs-scraper',
      pricePerItemUsd: 0.0001,
      limitPerSearch: 25,
      // Indeed country sites (searched with location "remote").
      countries: ['us', 'ca', 'uk', 'de', 'nl', 'ae', 'au'],
    },
    glassdoor: {
      enabled: true,
      actorId: 'valig/glassdoor-jobs-scraper',
      pricePerItemUsd: 0.0004,
      limitPerSearch: 15,
      // Glassdoor does not support OR searches, so it uses a few core titles.
      keywords: ['Full Stack Developer', 'Software Engineer', 'Frontend Developer', 'Backend Developer'],
      locations: ['United States', 'Canada', 'United Kingdom', 'Germany', 'United Arab Emirates'],
    },
    wellfound: {
      enabled: true,
      actorId: 'blackfalcondata/wellfound-scraper',
      pricePerItemUsd: 0.003,
      maxResults: 50,
      roles: ['full-stack-engineer', 'software-engineer', 'frontend-engineer', 'backend-engineer'],
      query: 'full stack',
    },

    // ---- Free boards (no Apify). All remote-first; the title/date filters do the rest.
    // RemoteOK's API returns its latest ~100 jobs per tag.
    remoteok: { enabled: true, tags: ['dev', 'engineer', 'backend', 'javascript', 'react', 'typescript', 'full stack', 'front end'] },
    // Jobicy: free-text tag searches (an entry containing "=" is passed as a raw query parameter).
    jobicy: { enabled: true, tags: ['full-stack', 'javascript', 'react', 'node', 'typescript', 'software engineer', 'web developer', 'industry=engineering'] },
    // We Work Remotely RSS categories.
    wwr: { enabled: true, feeds: ['remote-full-stack-programming-jobs', 'remote-back-end-programming-jobs', 'remote-front-end-programming-jobs'] },
    workingnomads: { enabled: true },
    // Arbeitnow: EU/Germany board, remote jobs only; 300 jobs per page.
    arbeitnow: { enabled: true, pages: 2 },
  },
};

export default config;
