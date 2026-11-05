import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { daysAgo } from './util.ts';
import type { Job, SourceName } from './types.ts';

/** CSV column order: decision columns first, bookkeeping last. */
export const CSV_COLUMNS: (keyof Job)[] = [
  'score', 'title', 'company', 'remote', 'remote_scope', 'candidate_location', 'salary', 'salary_usd_year_est', 'location', 'other_locations',
  'posted_date', 'first_seen', 'source', 'also_found_on', 'seniority', 'employment_type', 'tech', 'stack_match', 'flags',
  'job_url', 'apply_url', 'other_job_urls', 'company_url', 'recruiter_name', 'recruiter_url', 'applicants', 'easy_apply',
  'description', 'score_reasons', 'search_query', 'search_location', 'source_id', 'job_key', 'times_seen', 'last_seen', 'scraped_at',
];

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Job[], columns = CSV_COLUMNS): string {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => cell(c === 'remote' && !r.remote ? 'Unknown' : r[c])).join(','))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Parses CSV written by toCsv (or any RFC 4180 CSV) into objects keyed by the header row. Strips a leading BOM. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...data] = rows.filter((r) => r.length > 1 || r[0] !== '');
  if (!header) return [];
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** File names inside a run folder. The run id is repeated in each name so a file still makes sense after you move or attach it. */
export const runFiles = (runId: string) => ({ new: `${runId}_new-jobs.csv`, all: `${runId}_all-jobs.csv`, top: `${runId}_top-jobs.md` });
/** Names used by runs made before 2026-11-06. */
export const LEGACY_RUN_FILES = { new: 'new_jobs.csv', all: 'jobs.csv', top: 'top_jobs.md' };

/** UTF-8 with BOM so Excel shows non-English characters correctly. */
export function writeCsv(path: string, rows: Job[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, toCsv(rows), 'utf8');
}

export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path);
}

export function writeText(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** A readable shortlist for a phone or a quick scan. */
export function topMarkdown(jobs: Job[], title: string, n = 30): string {
  const lines = [`# ${title}`, '', `${jobs.length} jobs, top ${Math.min(n, jobs.length)} by score.`, ''];
  jobs.slice(0, n).forEach((j, i) => {
    const bits = [j.remote || 'Unknown', j.remote_scope, j.salary_usd_year_est ? `≈$${Math.round(Number(j.salary_usd_year_est) / 1000)}k/yr` : j.salary, j.seniority, j.posted_date].filter(Boolean);
    lines.push(`${i + 1}. **[${j.title}](${j.job_url})** — ${j.company || 'unknown company'} · score ${j.score}`);
    lines.push(`   ${bits.join(' · ')}`);
    const extra = [j.stack_match ? `stack: ${j.stack_match}` : j.tech ? `tech: ${j.tech.split(', ').slice(0, 6).join(', ')}` : '', j.flags ? `flags: ${j.flags}` : '', j.recruiter_name ? `recruiter: [${j.recruiter_name}](${j.recruiter_url})` : '', j.also_found_on ? `also on ${j.also_found_on}` : ''].filter(Boolean);
    if (extra.length) lines.push(`   ${extra.join(' · ')}`);
    lines.push('');
  });
  return lines.join('\n');
}

interface DbFile {
  version: 2;
  jobs: Record<string, Job>;
  /** seen_ids[source][source_id] = date first seen; lets Actors skip jobs we already paid for. */
  seen_ids: Partial<Record<SourceName, Record<string, string>>>;
}

/** Every job ever seen, keyed by job_key, plus the raw IDs seen per source. */
export class JobDb {
  path: string;
  db: DbFile;

  constructor(path: string) {
    this.path = path;
    this.db = { version: 2, jobs: {}, seen_ids: {} };
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed?.version === 2) this.db = parsed;
      else if (parsed && typeof parsed === 'object') {
        // v1 file: a plain map of job_key -> job
        for (const [k, v] of Object.entries(parsed as Record<string, any>)) this.db.jobs[k] = { ...v, times_seen: v.times_seen || 1, last_seen: v.last_seen ?? v.first_seen };
      }
    }
  }

  /** Adds this run's jobs; returns the ones not seen before (or not seen for `reNewAfterDays`). Sets history fields on every job. */
  merge(jobs: Job[], today: string, reNewAfterDays = 45): Job[] {
    const fresh: Job[] = [];
    for (const j of jobs) {
      const old = this.db.jobs[j.job_key];
      const staleAt = old ? daysAgo(-reNewAfterDays, Date.parse(old.last_seen || old.first_seen)) : '';
      if (old && today <= staleAt) {
        j.first_seen = old.first_seen;
        j.times_seen = (old.times_seen || 1) + 1;
        j.last_seen = today;
        j.also_found_on = [...new Set([...j.also_found_on.split(', '), ...(old.also_found_on || '').split(', '), old.source].filter(Boolean).filter((s) => s !== j.source))].join(', ');
      } else {
        j.first_seen = today;
        j.times_seen = 1;
        j.last_seen = today;
        fresh.push(j);
      }
      this.db.jobs[j.job_key] = { ...j };
    }
    return fresh;
  }

  noteSeen(source: SourceName, ids: string[], today: string) {
    const map = (this.db.seen_ids[source] ??= {});
    for (const id of ids) if (id && (!map[id] || map[id] < today)) map[id] = today;
  }

  /** Most recently seen raw IDs for a source, newest first. */
  seenIds(source: SourceName, max = 1500): string[] {
    return Object.entries(this.db.seen_ids[source] ?? {})
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, max)
      .map(([id]) => id);
  }

  /** Forget jobs not seen for `jobDays` and raw IDs older than `idDays`, to keep the file small. */
  prune(today: string, jobDays = 120, idDays = 60) {
    const jobCut = daysAgo(jobDays, Date.parse(today));
    const idCut = daysAgo(idDays, Date.parse(today));
    for (const [k, j] of Object.entries(this.db.jobs)) if ((j.last_seen || j.first_seen) < jobCut) delete this.db.jobs[k];
    for (const map of Object.values(this.db.seen_ids)) for (const [id, d] of Object.entries(map!)) if (d < idCut) delete map![id];
  }

  all(): Job[] {
    return Object.values(this.db.jobs).sort((a, b) => b.first_seen.localeCompare(a.first_seen) || b.score - a.score);
  }

  get size() {
    return Object.keys(this.db.jobs).length;
  }

  save() {
    writeJson(this.path, this.db);
  }
}
