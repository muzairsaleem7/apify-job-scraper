# Job Scraper

Finds remote Full Stack jobs on demand from 9 sources, scores each one for fit, and writes CSV files with the best matches on top. Nothing is deployed: you run it when you need it.

| Source | How | Cost (Apify free plan) |
|---|---|---|
| LinkedIn Jobs | Apify Actor `valig/linkedin-jobs-scraper` | $0.0004 / job |
| Indeed | Apify Actor `valig/indeed-jobs-scraper` | $0.0001 / job |
| Glassdoor | Apify Actor `valig/glassdoor-jobs-scraper` | $0.0004 / job |
| Wellfound | Apify Actor `blackfalcondata/wellfound-scraper` | $0.003 / job |
| RemoteOK | public API, 8 tag feeds | free |
| Jobicy | public API | free |
| We Work Remotely | RSS feeds | free |
| Working Nomads | public API | free |
| Arbeitnow (EU) | public API | free |

## Setup (once)

```bash
cd C:\apify-project\job-scraper
npm install
copy .env.example .env      # then paste your Apify token(s) into .env
npm run tokens              # checks each token: account, plan, monthly usage left
```

You need Node.js 22.18 or newer. It runs TypeScript directly, with no build step. See `SETUP.md` for installing on another computer, and `SETUP.md → 8. Google Sheets` to turn on the Sheets export.

## Web UI (the easy way)

```bash
npm start                   # or double-click "Start Job Scraper.cmd"
```

One command starts everything: a small local server (http://127.0.0.1:4321, this computer only) that runs the scraper and the Apify searches itself, and opens the page in your browser. Keep the terminal window open while you use it.

- **One button per command**: Scrape last 24 hours · Scrape last 7 days · Free boards, last 7 days · Preview plan & cost · Check Apify credit · Re-score history. Paid buttons ask for confirmation first.
- **Each button works once per day.** After you click it, it stays disabled until local midnight. A run that fails (or is interrupted because you closed the window) doesn't count, so you can retry.
- **While it runs** you see the live output. **When it finishes**, the output files are listed under it with their full path on this computer (click a path to copy it), plus **Open in Google Sheets**, **Open file** and **Show in folder**.
- **Run history**: every run, newest first, including scrapes you started from the terminal: time, jobs found / new, cost, duration, files, and the full output.
- **Google Sheets** (after you connect once): each scrape is saved automatically as a spreadsheet named like `Jobs 2026-11-06 09:30 · Last 24 hours · All sources · 42 new`, with tabs **New jobs** and **All jobs**, in a Drive folder **Job Scraper**. **Open in Google Sheets** opens it (an older run is uploaded the first time you click it).
- **Job Tracker**: one more spreadsheet, **Job Tracker**, collects the new jobs from every run (each job once, never overwriting your edits). Keep your statuses there:
  - **Status** dropdown: New · Interested · Applied · Recruiter contacted · Interviewing · Offer · Rejected · Not interested · Closed / expired, each with its own colour (edit the list in `config.ts → sheets.statuses`)
  - **Applied on** and **Follow-up on** date pickers; a follow-up date that has arrived turns orange
  - **Notes**; score shaded white→green; clickable **Open ↗ / Apply ↗ / Profile ↗** links; frozen header and title columns; filter buttons on every column
  - Don't reorder or delete the columns (hiding them is fine): new rows are added in this column order.
- The run spreadsheets have the same columns and dropdowns, but they're snapshots. Use the tracker for anything you want to keep.

## Run from the terminal

```bash
npm run plan              # preview: searches, worst-case cost; calls nothing
npm run scrape:24h        # jobs posted in the last 24 hours
npm run scrape:7d         # jobs posted in the last 7 days
npm run scrape -- --window 3d                 # also: 14d, 30d
npm run scrape:24h -- --sources free          # only the free boards ($0)
npm run scrape:24h -- --sources linkedin,wwr  # any mix; aliases: apify, free, all
npm run scrape:7d -- --limit 5                # cap every paid search at 5 results (cheap test)
npm run scrape:7d -- --no-db                  # don't touch the history (everything shows as new)
npm run rescore           # re-rank existing results after editing the score or config (no cost)
npm test                  # unit tests (no network, no cost)
```

The 7-day window includes the last 24 hours, so you don't need both. Run `scrape:24h` daily and `scrape:7d` after a few days off.

## Output

```
output/
  master.csv                      every unique job ever found, newest first
  2026-11-06_0930_24h_all/        one folder per run: date_time_window_sources (all | free | paid | linkedin+wwr)
    2026-11-06_0930_24h_all_new-jobs.csv   jobs you haven't seen in earlier runs, best first   <- open this
    2026-11-06_0930_24h_all_top-jobs.md    the top 30 new jobs as a readable list with links
    2026-11-06_0930_24h_all_all-jobs.csv   all matching jobs from this run, best first
    run.json                      counts, timings, cost
    raw/<source>.json             raw source data (for debugging)
    errors.json                   only if a source failed
data/jobs-db.json                 history used to detect new jobs (delete it to start fresh)
data/ui-history.json              the web UI's run history and once-per-day button locks
data/google.json                  Google sign-in and the IDs of the spreadsheets the app made (private, like .env)
```

Each file name repeats the run id, so a file still says which run it came from after you move or attach it. Runs made before 2026-11-06 keep their old names (`new_jobs.csv`, `jobs.csv`, `top_jobs.md`) and still work everywhere.

### Columns

| Column | Meaning |
|---|---|
| `score` | 0–100 fit score (see below). Rows are sorted by it. |
| `title`, `company` | |
| `remote` | `Remote` · `Remote + hybrid/on-site` (mentions both: read it) · `Unknown` (text doesn't say) · `Hybrid` / `On-site` (dropped by default) |
| `remote_scope` | Where you must live: `Worldwide`, or regions such as `US`, `EU, UK`, `Canada`, `LATAM`, `APAC`, `UAE`, `India`. Blank = not stated. From the board's own field when it has one (WWR, Jobicy, RemoteOK, Working Nomads), otherwise from phrases like "must be authorized to work in the US", "CET time zone". |
| `candidate_location` | The board's own wording, e.g. "USA Only", "Anywhere in the World" |
| `salary`, `salary_usd_year_est` | As posted, and an estimated annual USD midpoint (rough fixed exchange rates; hourly ×2080, monthly ×12) so you can sort |
| `location`, `other_locations` | Posting location(s); extra cities from merged duplicates |
| `posted_date`, `first_seen` | When the site says it was posted; when this tool first saw it |
| `source`, `also_found_on` | Where it came from; other sites that had the same job |
| `seniority` | `junior` · `mid` · `senior` · `lead` · `staff` · `principal` · `manager`, read from the title, then the site's field (Wellfound's "5+ years" is kept in brackets) |
| `employment_type` | Full-time, contract, … |
| `tech` | Technologies named in the post, in order of appearance (about 75 recognised) |
| `stack_match` | Which of your `candidate.stack` items appear |
| `flags` | `clearance` · `citizenship` · `no-sponsorship` · `sponsorship-offered` · `relocation` · `contract` · `c2c` · `1099` · `w2` · `part-time` · `tz-overlap` · `agency` |
| `job_url`, `apply_url`, `other_job_urls` | Link to the post; direct apply link when the site gives one; links of merged duplicates |
| `company_url`, `recruiter_name`, `recruiter_url` | Hiring contact (LinkedIn) — the person to message |
| `applicants`, `easy_apply` | LinkedIn/Glassdoor signals |
| `description` | First 300 characters |
| `score_reasons` | Every point added or removed, e.g. `+10 full-stack title; +12 worldwide; -8 staffing agency` |
| `search_query`, `search_location`, `source_id`, `job_key`, `times_seen`, `last_seen`, `scraped_at` | Bookkeeping |

## What it does, in order

1. **Search.** LinkedIn and Indeed get your 4 title groups as boolean (OR) searches across US, Canada, UK, EU, UAE, Australia (remote only). Duplicate titles across groups are searched once. LinkedIn also gets a server-side title filter and the IDs of jobs already in your history, so those are never paid for again (the Actor fills the slots with new jobs instead). Glassdoor and Wellfound get a few core titles. The free boards are fetched whole and filtered locally.
2. **Classify** each job from the full description: workplace type, where you must live, flags, technologies, seniority, salary estimate.
3. **Filter.** Drops, in this order: titles with words from `excludeTitleWords` (junior, management, QA, security, iOS…); titles not matching your list; titles built on another stack (`Java Developer`, `Senior .NET Full-stack Developer`) unless they also name yours (`Full Stack Developer (Java/React)` stays); hybrid/on-site; flags in `dropFlags` (clearance); older than the window.
4. **De-duplicate.** Same company + same title = one row, keeping the richest source and folding the other links/locations in.
5. **Score and sort.** See below.
6. **Compare with history.** `new_jobs.csv` holds only what you haven't seen. A job that disappears and comes back after `reNewAfterDays` (45) counts as new again.

## The score

Starts at 40. Main signals (full list in `src/score.ts`; after changing it run `npm run rescore`):

| + | − |
|---|---|
| +10 full-stack title, +8 your stack in the title | −12 built on another stack (Java/.NET/Python/Go…), −6 another stack in the title |
| up to +18 for `stack_match` (3 per item) | −25 hybrid, −30 on-site |
| +10 clearly remote, +12 worldwide | −8 restricted to a region (−12 if you set `eligibleRegions` and it's not yours; +6 if it is) |
| +8 senior/lead, +5 mid | −40 clearance, −25 citizenship, −8 staffing agency, −6 no sponsorship, −8 part-time |
| +4 salary shown, +4/+8 for ≈$80k/$120k+ | −8 below `minSalaryUsdYear` |
| +5 recruiter contact, +5 few applicants, +4 posted today, +3 on several sites | −5 many applicants, −3 two weeks old |

Set `candidate.eligibleRegions` in `config.ts` (for example `['Worldwide', 'EU']`) and region-restricted jobs are scored for you rather than generically.

## Multiple Apify tokens (failover)

Put one or more tokens in `.env`, separated by commas:

```
APIFY_TOKENS=apify_api_first,apify_api_second
```

Before a scrape, tokens that are invalid or have less than `minTokenBalanceUsd` left are skipped. During a scrape, if a token stops working (invalid, out of credit, over its limit), the failed search is retried on the next token. Temporary problems (rate limits, memory limit while runs overlap) are retried on the same token with backoff. Every run has a hard spending cap, and each search has a timeout.

Apify's terms allow one free account per person; use this for accounts that are genuinely yours (e.g. personal + paid).

## Cost

- Worst case with the default settings is about $0.58 per scrape; a real 24h run is typically $0.30–0.40, and the summary shows the amount actually charged to your account (read from Apify before and after).
- The free plan gives $5/month. Daily 24h runs on all four paid sources cost about $10/month, so either run `scrape:7d` twice a week, lower `limitPerSearch`, or use `--sources free` on the other days (the five free boards alone return 50–70 matching jobs a week).

## Configuration (`config.ts`)

- `titleGroups`, `excludeTitleWords`, `offStackTitleWords`, `dropOffStackTitles`, `strictTitleFilter`, `dropHybridOnsite`, `dropFlags`
- `candidate.stack` (what counts as your stack), `candidate.eligibleRegions`, `candidate.minSalaryUsdYear`
- `reNewAfterDays`, `descriptionChars`, `concurrency`, `maxCostPerScrapeUsd`, `minTokenBalanceUsd`
- per source: `enabled`, limits, locations/countries, keywords/roles, tag lists and feeds for the free boards

## Notes

- These are third-party Actors and public APIs. If one changes its output format, the affected fields come out empty and `raw/<source>.json` shows the new shape, so the mapper in `src/sources.ts` / `src/free-sources.ts` can be updated.
- LinkedIn's public search ignores its remote filter, so "AND remote" is added to the keywords and the description is read; expect some `Remote + hybrid/on-site` rows.
- Wellfound blocks bots heavily and is the source most likely to return few results.
- RemoteOK's terms ask you to credit Remote OK if you ever republish its data.
- The root `F:\my-next-app\tsconfig.json` excludes `lab/job-scraper`, so the Next.js build doesn't type-check this project.

## Project layout

```
config.ts              all settings
src/cli.ts             commands: scrape, tokens, plan
src/apify.ts           Apify API client, token failover, real cost
src/sources.ts         LinkedIn / Indeed / Glassdoor / Wellfound search plans and mappers
src/free-sources.ts    RemoteOK / Jobicy / WWR / Working Nomads / Arbeitnow
src/text.ts            classifiers: workplace, remote scope, flags, tech, seniority, salary
src/enrich.ts          RawJob -> Job
src/filters.ts         filters and de-duplication
src/score.ts           the score
src/store.ts           CSV (write + parse), history database, top-jobs list, run file names
src/server.ts          web UI server (npm start): buttons, live output, history, Google Sheets
src/ui.html            the page
src/runs.ts            button definitions, once-per-day locks, run history, run/sheet naming
src/google.ts          Google sign-in (OAuth, PKCE) and Sheets/Drive calls, sheet layout
test/                  unit tests (node:test, no network)
```
