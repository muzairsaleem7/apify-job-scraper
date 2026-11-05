import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { COMMANDS, History, type HistoryEntry, listRuns, localDay, runIdTime, sheetTitle, sourcesLabel, sourcesTag } from '../src/runs.ts';
import { runFiles } from '../src/store.ts';

const dir = mkdtempSync(join(tmpdir(), 'job-scraper-runs-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const FREE = ['remoteok', 'jobicy', 'wwr', 'workingnomads', 'arbeitnow'];
const ALL = ['linkedin', 'indeed', 'glassdoor', 'wellfound', ...FREE];

describe('naming', () => {
  it('tags source sets for file names', () => {
    assert.equal(sourcesTag(ALL), 'all');
    assert.equal(sourcesTag(FREE), 'free');
    assert.equal(sourcesTag(['linkedin', 'indeed', 'glassdoor', 'wellfound']), 'paid');
    assert.equal(sourcesTag(['linkedin', 'wwr']), 'linkedin+wwr');
    assert.equal(sourcesTag(ALL.filter((s) => s !== 'wellfound'), ALL.filter((s) => s !== 'wellfound')), 'all', 'all enabled sources = all');
    assert.equal(sourcesLabel(FREE), 'Free boards');
  });

  it('builds readable run file and sheet names', () => {
    assert.deepEqual(runFiles('2026-11-06_0930_24h_all'), { new: '2026-11-06_0930_24h_all_new-jobs.csv', all: '2026-11-06_0930_24h_all_all-jobs.csv', top: '2026-11-06_0930_24h_all_top-jobs.md' });
    assert.equal(runIdTime('2026-11-05_2341_24h'), '2026-11-05 23:41');
    const t = sheetTitle({ runId: '2026-11-06_0930_7d_free', window: '7d', sources: FREE, totals: { new: 12 } } as any);
    assert.equal(t, 'Jobs 2026-11-06 09:30 · Last 7 days · Free boards · 12 new');
  });

  it('every button maps to a real CLI command', () => {
    for (const c of COMMANDS) assert.ok(['scrape', 'tokens', 'rescore'].includes(c.args[0]), c.id);
    assert.equal(new Set(COMMANDS.map((c) => c.id)).size, COMMANDS.length);
  });
});

describe('listRuns', () => {
  it('reads current and legacy run folders, newest first, listing only files that exist', () => {
    const out = join(dir, 'output');
    const legacy = join(out, '2026-11-05_2341_24h');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'run.json'), JSON.stringify({ window: '24h', sources: ALL, startedAt: '2026-11-05T18:41:00.000Z', totals: { unique: 303, new: 303 }, cost: { apifyActualUsd: 0.363 } }));
    writeFileSync(join(legacy, 'jobs.csv'), 'x');
    writeFileSync(join(legacy, 'new_jobs.csv'), 'x');

    const id = '2026-11-06_0930_7d_free';
    const cur = join(out, id);
    mkdirSync(cur, { recursive: true });
    const files = runFiles(id);
    writeFileSync(join(cur, 'run.json'), JSON.stringify({ runId: id, files, window: '7d', sources: FREE, startedAt: '2026-11-06T04:30:00.000Z', totals: { unique: 66, new: 10 }, cost: { apifyEstimateUsd: 0 } }));
    for (const f of Object.values(files)) writeFileSync(join(cur, f), 'x');
    mkdirSync(join(out, 'not-a-run'));

    const runs = listRuns(out);
    assert.deepEqual(runs.map((r) => r.runId), [id, '2026-11-05_2341_24h']);
    assert.deepEqual(runs[0].files.map((f) => [f.kind, f.name, f.rows]), [['new', files.new, 10], ['all', files.all, 66], ['top', files.top, undefined]]);
    assert.deepEqual(runs[1].files.map((f) => f.name), ['new_jobs.csv', 'jobs.csv'], 'missing top_jobs.md is left out');
    assert.equal(runs[1].costUsd, 0.363);
  });
});

describe('History (once-per-day buttons)', () => {
  const entry = (o: Partial<HistoryEntry>): HistoryEntry => ({ id: String(Math.random()), command: 'scrape-24h', label: 'x', day: '2026-11-06', startedAt: '2026-11-06T04:00:00.000Z', status: 'ok', log: [], ...o });

  it('locks a button after a running or successful run that day, not after a failed one', () => {
    const h = new History(join(dir, 'h1.json'));
    assert.equal(h.usedToday('scrape-24h', '2026-11-06'), undefined);
    h.add(entry({ status: 'failed' }));
    assert.equal(h.usedToday('scrape-24h', '2026-11-06'), undefined, 'failed runs can be retried');
    h.add(entry({ status: 'running' }));
    assert.ok(h.usedToday('scrape-24h', '2026-11-06'));
    assert.equal(h.usedToday('scrape-24h', '2026-11-07'), undefined, 'unlocks the next day');
    assert.equal(h.usedToday('scrape-7d', '2026-11-06'), undefined, 'each button has its own lock');
  });

  it('persists, and marks runs left running by a crash as interrupted (which unlocks them)', () => {
    const path = join(dir, 'h2.json');
    const h = new History(path);
    h.add(entry({ status: 'running' }));
    const h2 = new History(path);
    h2.markInterrupted();
    assert.equal(h2.entries[0].status, 'interrupted');
    assert.equal(h2.usedToday('scrape-24h', '2026-11-06'), undefined);
    assert.equal(new History(path).entries[0].status, 'interrupted', 'saved');
  });

  it('merges terminal runs into the history, newest first', () => {
    const h = new History(join(dir, 'h3.json'));
    h.add(entry({ runId: 'b', startedAt: '2026-11-06T05:00:00.000Z' }));
    h.add(entry({ command: 'plan', startedAt: '2026-11-06T06:00:00.000Z' }));
    const runs = [{ runId: 'b', startedAt: '2026-11-06T05:00:00.000Z' }, { runId: 'a', startedAt: '2026-11-05T05:00:00.000Z', finishedAt: '' }] as any;
    const all = h.combined(runs);
    assert.deepEqual(all.map((e) => [e.command, e.runId]), [['plan', undefined], ['scrape-24h', 'b'], ['cli', 'a']]);
  });

  it('localDay uses the local calendar date', () => {
    assert.match(localDay(), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
});
