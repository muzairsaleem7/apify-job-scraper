import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { CSV_COLUMNS, JobDb, parseCsv, toCsv, topMarkdown } from '../src/store.ts';
import { job } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'job-scraper-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('toCsv', () => {
  it('escapes quotes, commas and newlines; starts with a BOM; shows Unknown for blank remote', () => {
    const csv = toCsv([job({ title: 'A "quoted", title', description: 'line1\nline2', remote: '' })]);
    assert.ok(csv.startsWith('﻿' + CSV_COLUMNS.join(',')));
    assert.ok(csv.includes('"A ""quoted"", title"'));
    assert.ok(csv.includes('"line1\nline2"'));
    assert.ok(csv.includes(',Unknown,'));
    assert.equal(csv.split('\r\n').length, 3);
  });
});

describe('parseCsv', () => {
  it('round-trips toCsv output, including quotes, commas, newlines and the BOM', () => {
    const rows = parseCsv(toCsv([job({ title: 'A "quoted", title', description: 'line1\r\nline2', score: 87 }), job({ job_key: 'b|y' })]));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, 'A "quoted", title');
    assert.equal(rows[0].description, 'line1\r\nline2');
    assert.equal(rows[0].score, '87');
    assert.equal(rows[1].job_key, 'b|y');
    assert.deepEqual(Object.keys(rows[0]), CSV_COLUMNS);
  });

  it('header only -> no rows', () => {
    assert.deepEqual(parseCsv(toCsv([])), []);
  });
});

describe('JobDb', () => {
  it('tells new from seen, counts sightings, and re-news after reNewAfterDays', () => {
    const path = join(dir, 'db.json');
    const db = new JobDb(path);
    const fresh1 = db.merge([job({ job_key: 'a|x' }), job({ job_key: 'b|y' })], '2026-11-01', 45);
    assert.equal(fresh1.length, 2);
    db.save();

    const db2 = new JobDb(path);
    const fresh2 = db2.merge([job({ job_key: 'a|x', source: 'indeed' }), job({ job_key: 'c|z' })], '2026-11-05', 45);
    assert.deepEqual(fresh2.map((j) => j.job_key), ['c|z']);
    const a = db2.db.jobs['a|x'];
    assert.equal(a.first_seen, '2026-11-01');
    assert.equal(a.last_seen, '2026-11-05');
    assert.equal(a.times_seen, 2);
    assert.equal(a.also_found_on, 'linkedin', 'the earlier source is remembered');

    const fresh3 = db2.merge([job({ job_key: 'a|x' })], '2027-01-15', 45);
    assert.equal(fresh3.length, 1, 'seen 71 days ago counts as new again');
    assert.equal(db2.db.jobs['a|x'].first_seen, '2027-01-15');
  });
  it('remembers raw IDs per source, newest first, and prunes old ones', () => {
    const db = new JobDb(join(dir, 'ids.json'));
    db.noteSeen('linkedin', ['1', '2', ''], '2026-08-01');
    db.noteSeen('linkedin', ['3'], '2026-11-05');
    db.noteSeen('linkedin', ['1'], '2026-11-05'); // re-seen: date refreshes so it keeps being skipped
    assert.deepEqual(db.seenIds('linkedin').slice(0, 2).sort(), ['1', '3'], 'newest first');
    assert.deepEqual(db.seenIds('linkedin').slice(2), ['2']);
    assert.ok(['1', '3'].includes(db.seenIds('linkedin', 1)[0]));
    assert.deepEqual(db.seenIds('glassdoor'), []);
    db.merge([job({ job_key: 'old|j' })], '2026-01-01');
    db.merge([job({ job_key: 'new|j' })], '2026-11-05');
    db.prune('2026-11-05');
    assert.deepEqual(Object.keys(db.db.jobs), ['new|j']);
    assert.deepEqual(db.seenIds('linkedin').sort(), ['1', '3']);
  });
  it('migrates a v1 file (plain map)', () => {
    const path = join(dir, 'v1.json');
    const { times_seen: _t, last_seen: _l, ...v1 } = job({ job_key: 'k|1', first_seen: '2026-11-01' });
    writeFileSync(path, JSON.stringify({ 'k|1': v1 }));
    const db = new JobDb(path);
    assert.equal(db.size, 1);
    assert.equal(db.db.version, 2);
    assert.equal(db.db.jobs['k|1'].times_seen, 1);
    db.save();
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 2);
  });
  it('all() sorts newest first then by score', () => {
    const db = new JobDb(join(dir, 'sort.json'));
    db.merge([job({ job_key: 'a', score: 10 }), job({ job_key: 'b', score: 90 })], '2026-11-01');
    db.merge([job({ job_key: 'c', score: 50 })], '2026-11-05');
    assert.deepEqual(db.all().map((j) => j.job_key), ['c', 'b', 'a']);
  });
});

describe('topMarkdown', () => {
  it('lists jobs with links and key facts', () => {
    const md = topMarkdown([job({ title: 'T1', job_url: 'https://x/1', score: 88, remote_scope: 'Worldwide', salary_usd_year_est: '120000', recruiter_name: 'Ann', recruiter_url: 'https://li/ann' })], 'Top', 5);
    assert.ok(md.includes('[T1](https://x/1)'));
    assert.ok(md.includes('≈$120k/yr'));
    assert.ok(md.includes('[Ann](https://li/ann)'));
    assert.ok(md.startsWith('# Top'));
  });
});
