import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import config from '../config.ts';
import { NoTokensLeftError, TokenPool, accountUsageUsd, inspectTokens, precheckTokens, runActor } from './apify.ts';
import { enrich } from './enrich.ts';
import { dedupe, emptyStats, makeFilter } from './filters.ts';
import { FREE_SOURCES } from './free-sources.ts';
import { scoreJob } from './score.ts';
import { APIFY_SOURCES } from './sources.ts';
import { sourcesTag } from './runs.ts';
import { JobDb, LEGACY_RUN_FILES, runFiles, topMarkdown, writeCsv, writeJson, writeText } from './store.ts';
import { WINDOWS, isWindow, mapPool, sleep } from './util.ts';
import type { ApifySourceName, Config, FreeSourceName, Job, PlanContext, RawJob, SearchTask, SourceName, Window } from './types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'output');
const DB_PATH = join(ROOT, 'data', 'jobs-db.json');
const APIFY_NAMES = Object.keys(APIFY_SOURCES) as ApifySourceName[];
const FREE_NAMES = Object.keys(FREE_SOURCES) as FreeSourceName[];
const ALL_SOURCES: SourceName[] = [...APIFY_NAMES, ...FREE_NAMES];

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    window: { type: 'string', short: 'w' },
    sources: { type: 'string', short: 's' },
    limit: { type: 'string', short: 'l' },
    'dry-run': { type: 'boolean', default: false },
    'no-db': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const HELP = `
Usage:
  npm run scrape                 scrape with the default window from config.ts (${config.window})
  npm run scrape:24h             jobs posted in the last 24 hours
  npm run scrape:7d              jobs posted in the last 7 days
  npm run plan                   show what would run and the worst-case cost, without calling anything
  npm run tokens                 check every Apify token: account, plan, monthly usage
  npm run rescore                re-rank existing results after editing score.ts / config.ts (no scraping, no cost)
  npm test                       run the unit tests

Options (after "--", e.g. npm run scrape -- --sources linkedin,remoteok):
  -w, --window ${WINDOWS.join('|')}   time window
  -s, --sources a,b              only these sources: ${ALL_SOURCES.join(', ')}  (aliases: apify, free, all)
  -l, --limit N                  cap every paid search at N results (cheap test runs)
      --dry-run                  plan only
      --no-db                    don't read or write the job history (results are all "new"; nothing is skipped)
      --force                    run even if the estimate is above maxCostPerScrapeUsd
`;

const usd = (n: number) => `$${n.toFixed(3)}`;
const pad = (s: string | number, n: number) => String(s).padEnd(n);

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function validateConfig(cfg: Config) {
  const problems: string[] = [];
  if (!isWindow(cfg.window)) problems.push(`window must be one of ${WINDOWS.join(', ')}`);
  if (!cfg.titleGroups.flat().length) problems.push('titleGroups is empty');
  if (!Number.isInteger(cfg.concurrency) || cfg.concurrency < 1) problems.push('concurrency must be >= 1');
  for (const n of APIFY_NAMES) if (cfg.sources[n].enabled && !/^[\w.-]+\/[\w.-]+$/.test(cfg.sources[n].actorId)) problems.push(`sources.${n}.actorId must look like "user/actor"`);
  if (!cfg.candidate?.stack?.length) problems.push('candidate.stack is empty');
  if (problems.length) throw new Error(`config.ts: ${problems.join('; ')}`);
}

function pickSources(spec: string | undefined, cfg: Config): SourceName[] {
  if (!spec) return ALL_SOURCES.filter((s) => cfg.sources[s].enabled);
  const out = new Set<SourceName>();
  for (const raw of spec.split(',')) {
    const s = raw.trim().toLowerCase();
    if (s === 'all') ALL_SOURCES.forEach((x) => out.add(x));
    else if (s === 'apify') APIFY_NAMES.forEach((x) => out.add(x));
    else if (s === 'free') FREE_NAMES.forEach((x) => out.add(x));
    else if ((ALL_SOURCES as string[]).includes(s)) out.add(s as SourceName);
    else throw new Error(`Unknown source "${raw.trim()}". Known: ${ALL_SOURCES.join(', ')}, apify, free, all`);
  }
  return ALL_SOURCES.filter((s) => out.has(s));
}

async function cmdTokens() {
  const pool = TokenPool.fromEnv();
  if (!pool.tokens.length) return console.log('No tokens found. Copy .env.example to .env and set APIFY_TOKENS.');
  for (const i of await inspectTokens(pool)) {
    if (!i.ok) console.log(`${i.label}  INVALID  ${i.error}`);
    else {
      const usage = typeof i.usedUsd === 'number' ? `used $${i.usedUsd.toFixed(2)}` + (typeof i.limitUsd === 'number' ? ` of $${i.limitUsd.toFixed(2)} (left $${(i.limitUsd - i.usedUsd).toFixed(2)})` : '') : 'usage n/a';
      console.log(`${i.label}  OK  user=${i.username}  plan=${i.plan}  ${usage}`);
    }
  }
}

async function cmdScrape() {
  validateConfig(config);
  const window = (args.window ?? config.window) as Window;
  if (!isWindow(window)) throw new Error(`--window must be one of ${WINDOWS.join(', ')} (got "${window}")`);
  const limitCap = args.limit ? Number(args.limit) : undefined;
  if (limitCap !== undefined && (!Number.isInteger(limitCap) || limitCap < 1)) throw new Error('--limit must be a whole number >= 1');

  const wanted = pickSources(args.sources, config);
  const apifyWanted = wanted.filter((s): s is ApifySourceName => (APIFY_NAMES as string[]).includes(s));
  const freeWanted = wanted.filter((s): s is FreeSourceName => (FREE_NAMES as string[]).includes(s));
  const useDb = !args['no-db'];
  const db = useDb ? new JobDb(DB_PATH) : null;

  const ctx: PlanContext = { seenIds: (s) => (db ? db.seenIds(s) : []), limitCap };
  const tasks: SearchTask[] = apifyWanted.flatMap((n) => APIFY_SOURCES[n].plan(config, window, ctx));

  // ---- plan & cost
  console.log(`\nWindow: last ${window}   Sources: ${wanted.join(', ')}${useDb ? `   History: ${db!.size} jobs` : '   History: off'}`);
  let maxCost = 0;
  for (const n of apifyWanted) {
    const ts = tasks.filter((t) => t.source === n);
    const items = ts.reduce((a, t) => a + t.maxItems, 0);
    const cost = ts.reduce((a, t) => a + t.maxItems * t.pricePerItemUsd, 0);
    maxCost += cost;
    const skipped = ctx.seenIds(n).length;
    console.log(`  ${pad(n, 14)} ${pad(ts.length + ' runs', 9)} up to ${pad(items, 5)} jobs   worst case ${usd(cost)}${skipped ? `   (${skipped} known IDs skipped)` : ''}`);
  }
  for (const n of freeWanted) console.log(`  ${pad(n, 14)} free: ${FREE_SOURCES[n].describe(config)}`);
  if (apifyWanted.length) console.log(`  Worst-case Apify cost: ${usd(maxCost)} (you only pay for jobs actually returned)`);
  console.log('');

  if (args['dry-run']) return;
  if (maxCost > config.maxCostPerScrapeUsd && !args.force) {
    throw new Error(`Estimate ${usd(maxCost)} is above maxCostPerScrapeUsd (${usd(config.maxCostPerScrapeUsd)}). Lower the limits in config.ts, use --limit, or pass --force.`);
  }

  // ---- tokens
  const pool = TokenPool.fromEnv();
  let usageBefore: number | null = null;
  if (tasks.length) {
    if (!pool.tokens.length) throw new Error('No Apify token. Copy .env.example to .env and set APIFY_TOKENS (or run with --sources free).');
    const infos = await precheckTokens(pool, config.minTokenBalanceUsd);
    for (const t of pool.tokens) console.log(`  token ${t.label}: ${t.dead ? `skipped (${t.reason})` : 'ready'}`);
    if (!pool.alive) throw new Error('None of the Apify tokens can be used right now (see above).');
    const known = infos.filter((i) => typeof i.usedUsd === 'number');
    usageBefore = known.length ? known.reduce((a, i) => a + (i.usedUsd as number), 0) : null;
    console.log('');
  }

  // ---- run
  const startedAt = new Date();
  const scrapedAt = startedAt.toISOString();
  const today = scrapedAt.slice(0, 10);
  const enabled = ALL_SOURCES.filter((s) => config.sources[s].enabled);
  const runId = `${stamp(startedAt)}_${window}_${sourcesTag(wanted, enabled)}`;
  const runDir = join(OUTPUT, runId);
  const files = runFiles(runId);
  const raw: Partial<Record<SourceName, { query: string; location: string; items: unknown[] }[]>> = {};
  const collected: Job[] = [];
  const seenBySource: Partial<Record<SourceName, string[]>> = {};
  const perSource: Record<string, { ok: number; failed: number; found: number; kept: number }> = {};
  const errors: string[] = [];
  let costEstimate = 0;
  let outOfTokens = false;
  const tally = (s: string) => (perSource[s] ??= { ok: 0, failed: 0, found: 0, kept: 0 });

  const collect = (rows: RawJob[], source: SourceName, query: string, location: string) => {
    (seenBySource[source] ??= []).push(...rows.map((r) => r.source_id).filter(Boolean));
    collected.push(...rows.map((r) => enrich(r, config, { query, location, scrapedAt })));
  };

  const freeRuns = freeWanted.map(async (name) => {
    const src = FREE_SOURCES[name];
    try {
      const rows = await src.fetch(config, window);
      tally(name).ok++;
      tally(name).found += rows.length;
      collect(rows, name, src.describe(config), 'remote');
      (raw[name] ??= []).push({ query: src.describe(config), location: 'remote', items: rows.map(({ description: _d, ...r }) => r) });
      console.log(`  [${name}] ${rows.length} jobs`);
    } catch (e) {
      tally(name).failed++;
      errors.push(`${name}: ${(e as Error).message}`);
      console.log(`  [${name}] FAILED: ${(e as Error).message}`);
    }
  });

  let done = 0;
  const apifyRuns = mapPool(tasks, config.concurrency, async (task) => {
    const label = `[${task.source}] ${task.query.length > 50 ? task.query.slice(0, 47) + '...' : task.query} @ ${task.location}`;
    try {
      if (outOfTokens) throw new NoTokensLeftError('All Apify tokens are exhausted or invalid.');
      const res = await runActor(task, pool);
      const src = APIFY_SOURCES[task.source];
      const rows = res.items.map((it) => src.normalize(it, task)).filter((j): j is RawJob => j !== null);
      (raw[task.source] ??= []).push({ query: task.query, location: task.location, items: res.items });
      collect(rows, task.source, task.query, task.location);
      costEstimate += res.items.length * task.pricePerItemUsd;
      tally(task.source).ok++;
      tally(task.source).found += rows.length;
      console.log(`  ${pad(`(${++done}/${tasks.length})`, 9)} ${label} -> ${rows.length} jobs${res.warning ? `  ! ${res.warning}` : ''}`);
    } catch (e) {
      if (e instanceof NoTokensLeftError) outOfTokens = true;
      tally(task.source).failed++;
      const msg = (e as Error).message;
      errors.push(`${label}: ${msg}`);
      console.log(`  ${pad(`(${++done}/${tasks.length})`, 9)} ${label} -> FAILED: ${msg}`);
    }
  });
  await Promise.all([apifyRuns, ...freeRuns]);

  // ---- filter, dedupe, score, compare with history
  const stats = emptyStats();
  const filtered = makeFilter(config, window)(collected, stats);
  for (const j of filtered) tally(j.source).kept++;
  const unique = dedupe(filtered);
  for (const j of unique) {
    const { score, reasons } = scoreJob(j, config, today);
    j.score = score;
    j.score_reasons = reasons.join('; ');
  }
  unique.sort((a, b) => b.score - a.score || b.posted_date.localeCompare(a.posted_date) || a.title.localeCompare(b.title));

  let fresh = unique;
  if (db) {
    fresh = db.merge(unique, today, config.reNewAfterDays);
    for (const [s, ids] of Object.entries(seenBySource)) db.noteSeen(s as SourceName, ids!, today);
    db.prune(today);
    db.save();
  } else {
    for (const j of unique) {
      j.first_seen = today;
      j.last_seen = today;
      j.times_seen = 1;
    }
  }

  // ---- real cost (account usage delta; charges can take a moment to post)
  let costActual: number | null = null;
  if (tasks.length && usageBefore !== null) {
    await sleep(3000);
    const after = await accountUsageUsd(pool);
    if (after !== null) costActual = Math.max(0, after - usageBefore);
  }

  // ---- write
  const title = `Top jobs — ${today} (last ${window})`;
  writeCsv(join(runDir, files.all), unique);
  writeCsv(join(runDir, files.new), fresh);
  writeText(join(runDir, files.top), topMarkdown(fresh.length ? fresh : unique, fresh.length ? `${title} — new jobs` : title));
  for (const [s, r] of Object.entries(raw)) writeJson(join(runDir, 'raw', `${s}.json`), r);
  if (errors.length) writeJson(join(runDir, 'errors.json'), errors);
  if (db) writeCsv(join(OUTPUT, 'master.csv'), db.all());
  const finishedAt = new Date();
  writeJson(join(runDir, 'run.json'), {
    runId,
    files,
    window,
    sources: wanted,
    startedAt: scrapedAt,
    finishedAt: finishedAt.toISOString(),
    durationSec: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
    perSource,
    dropped: stats,
    totals: { collected: collected.length, afterFilters: filtered.length, unique: unique.length, new: fresh.length },
    cost: { apifyEstimateUsd: Number(costEstimate.toFixed(4)), apifyActualUsd: costActual === null ? null : Number(costActual.toFixed(4)) },
    errors,
  });

  // ---- summary
  console.log('\nSummary');
  for (const s of wanted) {
    const t = perSource[s] ?? { ok: 0, failed: 0, found: 0, kept: 0 };
    console.log(`  ${pad(s, 14)} ${pad(t.found + ' found', 11)} ${pad(t.kept + ' kept', 10)} ${t.ok} ok${t.failed ? `, ${t.failed} failed` : ''}`);
  }
  console.log(`  Dropped: ${stats.offTitle} off-title, ${stats.excluded} junior/mgmt/other role, ${stats.offStack} other stack, ${stats.notRemote} hybrid/on-site, ${stats.flagged} flagged, ${stats.tooOld} older than ${window}; ${filtered.length - unique.length} duplicates merged`);
  console.log(`  Result:  ${unique.length} jobs, ${fresh.length} new since previous runs`);
  if (tasks.length) console.log(`  Apify:   ${costActual !== null ? `${usd(costActual)} charged to your account` : `≈ ${usd(costEstimate)} (estimate)`} in ${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)}s`);
  if (outOfTokens) console.log('  ! Ran out of Apify tokens; some searches were skipped. Run `npm run tokens`.');
  if (fresh.length) {
    console.log('\n  Top new jobs');
    for (const j of fresh.slice(0, 5)) console.log(`   ${pad(j.score, 4)} ${j.title} — ${j.company}${j.remote_scope ? ` (${j.remote_scope})` : ''}${j.salary_usd_year_est ? ` ≈$${Math.round(Number(j.salary_usd_year_est) / 1000)}k` : ''}`);
  }
  console.log(`\n  ${join(runDir, files.new)}\n  ${join(runDir, files.top)}\n  ${join(runDir, files.all)}${db ? `\n  ${join(OUTPUT, 'master.csv')}` : ''}\n`);

  if (wanted.length && Object.values(perSource).every((t) => t.ok === 0)) process.exitCode = 1;
}

/** Re-score everything in the history (after editing score.ts or config.ts) and rewrite master.csv plus the latest run's files. */
async function cmdRescore() {
  validateConfig(config);
  const db = new JobDb(DB_PATH);
  if (!db.size) throw new Error('No history yet (data/jobs-db.json). Run a scrape first.');
  const today = new Date().toISOString().slice(0, 10);
  for (const j of Object.values(db.db.jobs)) {
    const { score, reasons } = scoreJob(j, config, j.last_seen || today);
    j.score = score;
    j.score_reasons = reasons.join('; ');
  }
  db.save();
  writeCsv(join(OUTPUT, 'master.csv'), db.all());
  console.log(`Re-scored ${db.size} jobs -> ${join(OUTPUT, 'master.csv')}`);

  const { readdirSync, existsSync, readFileSync } = await import('node:fs');
  const runs = existsSync(OUTPUT) ? readdirSync(OUTPUT).filter((d) => existsSync(join(OUTPUT, d, 'run.json'))).sort() : [];
  const latest = runs.at(-1);
  if (!latest) return;
  const run = JSON.parse(readFileSync(join(OUTPUT, latest, 'run.json'), 'utf8'));
  const byScore = (a: Job, b: Job) => b.score - a.score || b.posted_date.localeCompare(a.posted_date) || a.title.localeCompare(b.title);
  const jobs = db.all().filter((j) => j.scraped_at === run.startedAt).sort(byScore);
  const fresh = jobs.filter((j) => j.first_seen === run.startedAt.slice(0, 10) && j.times_seen === 1);
  if (!jobs.length) return;
  const names = { ...LEGACY_RUN_FILES, ...(run.files ?? {}) };
  writeCsv(join(OUTPUT, latest, names.all), jobs);
  writeCsv(join(OUTPUT, latest, names.new), fresh);
  writeText(join(OUTPUT, latest, names.top), topMarkdown(fresh.length ? fresh : jobs, `Top jobs — ${run.startedAt.slice(0, 10)} (last ${run.window})${fresh.length ? ' — new jobs' : ''}`));
  console.log(`Re-ranked ${jobs.length} jobs (${fresh.length} new) in ${join(OUTPUT, latest)}`);
}

try {
  if (args.help) console.log(HELP);
  else if (positionals[0] === 'tokens') await cmdTokens();
  else if (positionals[0] === 'rescore') await cmdRescore();
  else if (!positionals[0] || positionals[0] === 'scrape') await cmdScrape();
  else console.log(HELP);
} catch (e) {
  console.error(`\nError: ${(e as Error).message}\n`);
  process.exitCode = 1;
}
