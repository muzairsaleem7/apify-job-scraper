import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_RUN_FILES, writeJson } from './store.ts';

// ---------------------------------------------------------------- commands (one UI button each)

export interface CommandDef {
  id: string;
  label: string;
  description: string;
  /** Arguments for src/cli.ts. */
  args: string[];
  /** 'paid' spends Apify credit; the UI asks for confirmation first. */
  cost: 'paid' | 'free';
  /** 'scrape' makes an output folder; 'rescore' rewrites the latest one; 'info' only prints. */
  kind: 'scrape' | 'rescore' | 'info';
}

export const COMMANDS: CommandDef[] = [
  { id: 'scrape-24h', label: 'Scrape last 24 hours', description: 'All 9 sources. The daily run.', args: ['scrape', '--window', '24h'], cost: 'paid', kind: 'scrape' },
  { id: 'scrape-7d', label: 'Scrape last 7 days', description: 'All 9 sources. Use after a few days off.', args: ['scrape', '--window', '7d'], cost: 'paid', kind: 'scrape' },
  { id: 'free-7d', label: 'Free boards, last 7 days', description: 'RemoteOK, Jobicy, WWR, Working Nomads, Arbeitnow. $0.', args: ['scrape', '--window', '7d', '--sources', 'free'], cost: 'free', kind: 'scrape' },
  { id: 'plan', label: 'Preview plan & cost', description: 'Shows the searches and worst-case cost. Calls nothing.', args: ['scrape', '--dry-run'], cost: 'free', kind: 'info' },
  { id: 'tokens', label: 'Check Apify credit', description: 'Account, plan and credit left for each token.', args: ['tokens'], cost: 'free', kind: 'info' },
  { id: 'rescore', label: 'Re-score history', description: 'Re-ranks saved jobs after editing config.ts or score.ts. No scraping.', args: ['rescore'], cost: 'free', kind: 'rescore' },
];

// ---------------------------------------------------------------- naming

export const APIFY_SOURCE_NAMES = ['linkedin', 'indeed', 'glassdoor', 'wellfound'];
export const FREE_SOURCE_NAMES = ['remoteok', 'jobicy', 'wwr', 'workingnomads', 'arbeitnow'];

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Short tag for file names: all | free | paid | linkedin+wwr. `enabled` = the sources a plain run would use. */
export function sourcesTag(sources: string[], enabled: string[] = [...APIFY_SOURCE_NAMES, ...FREE_SOURCE_NAMES]): string {
  if (sameSet(sources, enabled) || sameSet(sources, [...APIFY_SOURCE_NAMES, ...FREE_SOURCE_NAMES])) return 'all';
  if (sameSet(sources, FREE_SOURCE_NAMES) || sameSet(sources, FREE_SOURCE_NAMES.filter((s) => enabled.includes(s)))) return 'free';
  if (sameSet(sources, APIFY_SOURCE_NAMES) || sameSet(sources, APIFY_SOURCE_NAMES.filter((s) => enabled.includes(s)))) return 'paid';
  return sources.join('+');
}

export function sourcesLabel(sources: string[]): string {
  const tag = sourcesTag(sources);
  return tag === 'all' ? 'All sources' : tag === 'free' ? 'Free boards' : tag === 'paid' ? 'Paid sources' : sources.join(', ');
}

const WINDOW_LABEL: Record<string, string> = { '24h': 'Last 24 hours', '3d': 'Last 3 days', '7d': 'Last 7 days', '14d': 'Last 14 days', '30d': 'Last 30 days' };
export const windowLabel = (w: string) => WINDOW_LABEL[w] ?? w;

/** "2026-11-06_0930_24h_all" -> "2026-11-06 09:30" (the local time the run started). */
export function runIdTime(runId: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/.exec(runId);
  return m ? `${m[1]} ${m[2]}:${m[3]}` : runId;
}

/** Google Sheets file name for a run, e.g. "Jobs 2026-11-06 09:30 · Last 24 hours · All sources · 42 new". */
export function sheetTitle(run: RunInfo): string {
  const parts = [`Jobs ${runIdTime(run.runId)}`, windowLabel(run.window), sourcesLabel(run.sources)];
  if (typeof run.totals?.new === 'number') parts.push(`${run.totals.new} new`);
  return parts.join(' · ');
}

/** Local calendar date, YYYY-MM-DD (the once-per-day buttons reset at local midnight). */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------------------------------------------------------------- output folders

export interface RunFile {
  kind: 'new' | 'all' | 'top' | 'master';
  name: string;
  path: string;
  rows?: number;
}

export interface RunInfo {
  runId: string;
  dir: string;
  window: string;
  sources: string[];
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  totals: { collected: number; afterFilters: number; unique: number; new: number };
  costUsd: number | null;
  errors: number;
  files: RunFile[];
}

/** Reads one output/<runId>/run.json. Handles both the current and the pre-2026-11-06 file names. */
export function readRun(outputDir: string, runId: string): RunInfo | null {
  const dir = join(outputDir, runId);
  const p = join(dir, 'run.json');
  if (!existsSync(p)) return null;
  let run: any;
  try {
    run = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
  const names = { ...LEGACY_RUN_FILES, ...(run.files ?? {}) } as Record<'new' | 'all' | 'top', string>;
  const rows: Record<string, number | undefined> = { new: run.totals?.new, all: run.totals?.unique };
  const files: RunFile[] = (['new', 'all', 'top'] as const)
    .map((kind) => ({ kind, name: names[kind], path: join(dir, names[kind]), rows: rows[kind] }))
    .filter((f) => existsSync(f.path));
  return {
    runId,
    dir,
    window: run.window,
    sources: run.sources ?? [],
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationSec: run.durationSec,
    totals: run.totals,
    costUsd: run.cost?.apifyActualUsd ?? run.cost?.apifyEstimateUsd ?? null,
    errors: Array.isArray(run.errors) ? run.errors.length : 0,
    files,
  };
}

/** Every run folder, newest first. */
export function listRuns(outputDir: string): RunInfo[] {
  if (!existsSync(outputDir)) return [];
  return readdirSync(outputDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readRun(outputDir, d.name))
    .filter((r): r is RunInfo => r !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ---------------------------------------------------------------- button history (data/ui-history.json)

export type EntryStatus = 'running' | 'ok' | 'failed' | 'interrupted';

export interface HistoryEntry {
  id: string;
  /** A COMMANDS id, or 'cli' for a scrape started from the terminal. */
  command: string;
  label: string;
  /** Local day the button was clicked (YYYY-MM-DD). */
  day: string;
  startedAt: string;
  finishedAt?: string;
  status: EntryStatus;
  exitCode?: number | null;
  /** Output folder this run produced (scrapes) or rewrote (rescore). */
  runId?: string;
  /** Problem uploading to Google Sheets, if any. */
  sheetsError?: string;
  /** How many new jobs were added to the Job Tracker sheet. */
  trackerAdded?: number;
  /** Last lines of the command output. */
  log: string[];
}

export const LOG_LINES = 400;

export class History {
  path: string;
  entries: HistoryEntry[] = [];

  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (Array.isArray(parsed?.entries)) this.entries = parsed.entries;
      } catch {
        /* a broken file starts a fresh history; the run folders are still listed */
      }
    }
  }

  /** Runs left 'running' by a crash or a closed window can't still be running. */
  markInterrupted() {
    let changed = false;
    for (const e of this.entries)
      if (e.status === 'running') {
        e.status = 'interrupted';
        e.finishedAt ??= new Date().toISOString();
        changed = true;
      }
    if (changed) this.save();
  }

  add(e: HistoryEntry) {
    this.entries.push(e);
    this.save();
  }

  save() {
    writeJson(this.path, { version: 1, entries: this.entries });
  }

  /** A button is used up for the day once it has a run today that is running or finished OK. Failed runs don't count, so you can retry. */
  usedToday(command: string, today: string): HistoryEntry | undefined {
    return this.entries.findLast((e) => e.command === command && e.day === today && (e.status === 'running' || e.status === 'ok'));
  }

  /** Button runs plus terminal runs (output folders no button run points to), newest first. */
  combined(runs: RunInfo[]): HistoryEntry[] {
    const linked = new Set(this.entries.filter((e) => e.runId && e.command !== 'rescore').map((e) => e.runId));
    const cli: HistoryEntry[] = runs
      .filter((r) => !linked.has(r.runId))
      .map((r) => ({ id: `cli:${r.runId}`, command: 'cli', label: 'Terminal scrape', day: localDay(new Date(r.startedAt)), startedAt: r.startedAt, finishedAt: r.finishedAt, status: 'ok', runId: r.runId, log: [] }));
    return [...this.entries, ...cli].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
