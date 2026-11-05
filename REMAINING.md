# REMAINING.md — handoff for the next Claude session

Written 2026-11-05 by the session that built this project. Read `README.md` first (what it does, columns, score), then this file.

## 0. Update 2026-11-06: web UI + Google Sheets (read this first)

- The project moved to `C:\apify-project\job-scraper` (standalone, not a git repo). The `F:\my-next-app` tsconfig rule in §2 no longer applies.
- **New: `npm start`** (`src/server.ts` + `src/ui.html`): local server on 127.0.0.1:4321 with one button per command (`src/runs.ts#COMMANDS`). Each runs `src/cli.ts` as a child process. Each button works **once per local day** (a running/OK entry in `data/ui-history.json` locks it; failed or interrupted runs don't). The page shows the live log, each run's output files with paths and Open / Show in folder / Open in Google Sheets, and the full history, including terminal runs found in `output/*/run.json`.
- **Google Sheets** (`src/google.ts`): OAuth Desktop client + PKCE + loopback redirect, scope `drive.file` only. Credentials go in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); the refresh token and file IDs are in `data/google.json`. After each UI scrape: one spreadsheet per run (tabs New jobs / All jobs) in Drive folder `Job Scraper`, and the run's new jobs are appended to the `Job Tracker` spreadsheet. Each run is added once, deduped by `Job key`, and existing rows are never overwritten. Both have a Status dropdown (`config.ts → sheets.statuses`), date pickers for Applied on / Follow-up on, status colours, a follow-up-due highlight, links and a filter. Scraped text goes in as `stringValue`, so it can't be read as a formula.
- **File names changed** for new runs: folder `YYYY-MM-DD_HHMM_<window>_<all|free|paid|a+b>`, files `<runId>_new-jobs.csv`, `<runId>_all-jobs.csv`, `<runId>_top-jobs.md`. `run.json` now has `runId` and `files`. Legacy folders still work (`LEGACY_RUN_FILES`), including in `rescore`.
- **Not verified live:** the Google API calls. The user hasn't created an OAuth client yet (SETUP.md §8), so only the request shapes are unit-tested (`test/google.test.ts`). The first real connect + upload is the remaining check.
- Tests: 87 (was 68). Ideas: sync tracker statuses back into `master.csv`; skip jobs marked "Not interested" in later runs; desktop notification when a run finishes.

## 1. State at handoff (2026-11-05): working and verified

| Check | Result |
|---|---|
| `npx tsc -p .` | clean |
| `npm test` | 68/68 pass, 22 suites, ~2 s, no network |
| Full live run `npm run scrape:24h` (all 9 sources) | 2026-11-05 23:41, 253 s, **0 failures**, 1,490 raw → 303 unique jobs, **$0.363 charged** (read from the Apify account before/after) |
| Free-only run `scrape:7d --sources free --no-db` | 746 raw → 66 jobs, $0 |
| Apify account | token in `.env`, free plan, ≈$3.70 of $5 left for November |

Output of that run is in `output/2026-11-05_2341_24h/` and `output/master.csv`; history in `data/jobs-db.json` (303 jobs, 1,237 raw IDs recorded for skipping). Score spread after `npm run rescore`: 6 jobs at 100, 25 at 90–99, 49 at 80–89, 62 at 70–79, 67 at 60–69, 94 below 60.

Nothing is broken. Everything below is optional improvement or review.

## 2. Ground rules for working on this project

- Run `npm run check` (tsc + tests) before and after any change. Keep tests green; add a test for anything you fix.
- Tests must never touch the network: mock `globalThis.fetch` with `test/helpers.ts#mockFetch`.
- Cheap live testing: `--sources free` ($0), `--limit 3` (caps paid searches), `--no-db` (doesn't touch history). A full paid run is ≈$0.36; the account has ≈$3.70 left this month.
- After editing `src/score.ts` or `config.ts` run `npm run rescore` (re-ranks existing results, no scraping).
- Style: TypeScript run directly by Node ≥ 22.18 (no build), `erasableSyntaxOnly` + `verbatimModuleSyntax` (no enums, use `import type`), no runtime dependencies. Keep it that way.
- `F:\my-next-app\tsconfig.json` excludes `lab/job-scraper` so the Next.js build ignores this folder. Don't remove that.
- The user's Apify token was pasted into a chat; recommend regenerating it in the Apify Console and updating `.env`. Never print it.
- Don't create multiple free Apify accounts for credit (ToS); the token-failover feature is for accounts the user genuinely owns.

## 3. Facts learned by probing (save yourself the experiments)

- **LinkedIn Actor `valig/linkedin-jobs-scraper`**: LinkedIn's public search now ignores `f_WT` (workplace filter) — verified identical results with/without. "AND remote" in `keywords` works (≈75 % remote). `titleInclude` filters server-side (you don't pay for off-title rows). `skipJobId` makes the Actor **refill** with new jobs (verified: 10 skipped → 10 different returned), so passing history IDs is pure gain. `datePosted` r86400/r604800/r2592000 is honoured. Output fields: `id, url, title, location, companyName, companyUrl, recruiterName, recruiterUrl, experienceLevel, contractType, workType, sector, salary, applyType, postedDate, applicationsCount, description`; `workType`/`sector` sometimes hold the company industry (e.g. "Staffing and Recruiting").
- **Indeed `valig/indeed-jobs-scraper`**: boolean `("A" OR "B")` in `title` works in all countries; `location: 'remote'` works; zeros in NL/AU/AE on a 24h window are genuine (few postings), not a bug. `datePosted` only 1/3/7/14.
- **Glassdoor `valig/glassdoor-jobs-scraper`**: `remoteWorkType: true` works; `excludeJobIds` accepted; `ageInDays` is the only date.
- **Wellfound `blackfalcondata/wellfound-scraper`**: slow (≈100 s for 10 jobs), 2 GB memory, $0.003/job; `roles` + `query` + `remote: true` + `maxAgeMinutes` all work; `excludeKeywords` filters titles server-side. Returns few jobs on 24h (3–5), more on 7d.
- **Free APIs**: Remotive now returns only 10 jobs total (useless; not included). Himalayas' API is a date-sorted firehose of all categories (hundreds/day), `q=` doesn't filter, and it Cloudflare-blocks after ~5 quick pages (not included). RemoteOK `?tags=` works but the tag is `front end` not `frontend`; tag feeds lag (newest ≈10 days old) while `dev`/`engineer` are current. Jobicy `tag=` is a loose free-text search (returns off-topic rows; our title filter handles it); `industry=engineering` works; no salary fields. WWR full-stack RSS goes back to 2024 (date filter handles it); `<region>` holds "USA Only / Anywhere in the World / EMEA Only / North America Only". Working Nomads exposes ~33 jobs total. Arbeitnow is mostly German-language, 28/300 remote per page.
- Apify's `/users/me/limits` → `current.monthlyUsageUsd` is the reliable cost source; `run.usageTotalUsd` on the run object lags/zero on the free plan.

## 4. Known weaknesses worth reviewing (prioritised)

1. **`remote_scope` is blank for 176/303 jobs.** Most posts don't state where you must live. Idea: when the text says nothing, use `search_location` (the LinkedIn/Glassdoor country searched) as a weak hint, shown as e.g. `US?` and scored at half the restriction penalty. Code: `src/enrich.ts` (scope) + `src/score.ts`. Add tests in `test/filters.test.ts`.
2. **Dedupe key** is `company|title`. Titles like "Senior Software Engineer (Remote)" vs "Senior Software Engineer" at the same company become two rows, while genuinely different teams with the same title merge into one (their links are kept in `other_job_urls`). Consider stripping `(remote)`, `- remote`, `(all levels)` etc. from the key in `src/enrich.ts#jobKey`.
3. **Score ties / calibration** are hand-tuned (`src/score.ts`). Ask the user to look at the top 30 of `top_jobs.md` and say which ones are wrong; adjust weights, then `npm run rescore`. Untested signals: `applicants` text from Glassdoor, `easy_apply`.
4. **Agency detection** (`src/text.ts#eligibilityFlags`) flags company names matching `recruit*|staffing|talent (partners|solutions|group)|consultancy` and LinkedIn industry "Staffing and Recruiting". It may flag legitimate companies with "Talent" in the name. 18/303 flagged in the live run — spot-check them.
5. **Seniority**: LinkedIn's `experienceLevel` "Associate"/"Entry level" maps to `junior` (−20 score) even for roles that are really mid-level; 23 kept jobs carry `junior` from that field alone. Consider trusting the title only, or halving the penalty when it comes from the site field.
6. **`candidate.eligibleRegions` is empty** because the user's country wasn't confirmed. Ask them. With it set, region-restricted jobs are scored correctly (+6 / −12 instead of a flat −8).
7. **Region regexes** (`src/text.ts#REGION_TEXT`) are heuristic. Known gaps: "within the EU" matched via "within the (eu|europe)"; "Canada or US" fine; "North America" from text (not the WWR field) is not detected; country names other than the big regions are only detected from explicit board fields.
8. **`workplace()`** leaves 81/303 as `Unknown` (text never says remote/hybrid/on-site). All of those came from remote-filtered searches, so they're probably remote; the score gives them +3.
9. **Excluded titles**: `excludeTitleWords` contains `security`, `data engineer`, `game`, `implementation`, `manager`… Verified on live data that only ~20 title-matching jobs were removed by it, all legitimately. But phrase matching is whole-word any-order, so "Software Engineer, Data" is removed by `data engineer`. Acceptable; mention to the user.
10. **Daily cost** on all four paid sources is ≈$10/month vs $5 free credit. Options already documented in README (7d runs twice a week, lower `limitPerSearch`, `--sources free` on other days). A smarter option: make LinkedIn skip search groups whose last run returned < 5 new jobs for that location.

## 5. Not done (ideas the user floated or that follow naturally)

- Scheduling/deployment (user said "later"): a Windows Task Scheduler entry or cron calling `npm run scrape:24h`; nothing in the code prevents it.
- Notifications (Telegram/Slack/email) of `new_jobs.csv`.
- `.xlsx` output with clickable links (CSV links are plain text in Excel; press F2+Enter on a cell). Would need a dependency (e.g. `exceljs`), which the project currently avoids.
- More sources: Upwork (no public API; Apify Actors exist but the user also wanted Wellfound/LinkedIn focus), Hacker News "Who is hiring" (Algolia API, monthly thread, free text — needs parsing), Greenhouse/Lever boards of target companies, Adzuna/Jooble (need API keys).
- Applying/outreach drafts from the CSV (cover letters per job, recruiter messages) — the user's larger goal; the `recruiter_name`/`recruiter_url` and `description` columns exist for that.
- A tracker (applied / status / follow-up date) on top of `master.csv`.
- `lab/generated-files/conversation-notes.md` (project history for the user) predates the scraper rewrite and doesn't describe it; update if the user wants a single summary.

## 6. Quick orientation

```
config.ts            all knobs (titles, exclusions, stack, regions, sources, limits, prices)
src/cli.ts           scrape | tokens | rescore | plan(--dry-run); flags --window --sources --limit --no-db --force
src/sources.ts       Apify plans + mappers (LinkedIn, Indeed, Glassdoor, Wellfound)
src/free-sources.ts  RemoteOK, Jobicy, WWR (RSS), Working Nomads, Arbeitnow
src/text.ts          workplace(), remoteScope()/geoToRegions(), eligibilityFlags(), extractTech()/stackMatch(), seniorityOf(), parseSalary()/annualUsd()
src/enrich.ts        RawJob -> Job (all derived columns, job_key)
src/filters.ts       makeFilter() drop order: excluded -> offTitle -> offStack -> notRemote -> flagged -> tooOld; dedupe()
src/score.ts         scoreJob(): start 40, see README table
src/store.ts         CSV_COLUMNS (column order), JobDb (v2 file: jobs + seen_ids, migrates v1), topMarkdown()
src/apify.ts         runActor() with caps/timeout/retry/token rotation; precheckTokens(); accountUsageUsd()
test/*.test.ts       node:test; helpers.ts has job()/rawJob()/testConfig()/mockFetch()
```

Pipeline in `cli.ts#cmdScrape`: plan → token precheck (usage before) → Apify runs (mapPool, concurrency 6) ‖ free sources → `enrich` → `makeFilter` → `dedupe` → `scoreJob` → sort → `db.merge` (new vs seen) + `db.noteSeen` + `db.prune` → write `jobs.csv`, `new_jobs.csv`, `top_jobs.md`, `raw/*.json`, `run.json`, `master.csv` → usage after → summary.
