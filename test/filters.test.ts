import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enrich } from '../src/enrich.ts';
import { dedupe, emptyStats, makeFilter } from '../src/filters.ts';
import { job, rawJob, testConfig } from './helpers.ts';

const cfg = testConfig();
const NOW = Date.parse('2026-11-05T12:00:00Z');

const run = (jobs: ReturnType<typeof job>[], window: '24h' | '7d' = '7d') => {
  const stats = emptyStats();
  const kept = makeFilter(cfg, window, NOW)(jobs, stats);
  return { kept: kept.map((j) => j.title), stats };
};

describe('makeFilter', () => {
  it('drops junior, management and other disciplines', () => {
    const { kept, stats } = run([
      job({ title: 'Junior Full Stack Developer' }),
      job({ title: 'Engineering Manager' }),
      job({ title: 'Senior QA Automation Engineer' }),
      job({ title: 'Application Security Engineer' }),
      job({ title: 'Senior Full Stack Engineer' }),
    ]);
    assert.deepEqual(kept, ['Senior Full Stack Engineer']);
    assert.equal(stats.excluded, 4);
  });
  it('drops titles outside the title list', () => {
    const { kept, stats } = run([job({ title: 'Product Designer' }), job({ title: 'Engineer, Full-Stack' })]);
    assert.deepEqual(kept, ['Engineer, Full-Stack']);
    assert.equal(stats.offTitle, 1);
  });
  it('drops other-stack titles unless they also name your stack', () => {
    const { kept, stats } = run([
      job({ title: 'Java Software Developer' }),
      job({ title: 'Senior .NET Full-stack Developer' }),
      job({ title: 'Full Stack Developer (Java/React)' }),
      job({ title: 'Software Engineer - Go' }),
      job({ title: 'JavaScript Developer' }),
    ]);
    assert.deepEqual(kept, ['Full Stack Developer (Java/React)', 'JavaScript Developer']);
    assert.equal(stats.offStack, 3);
  });
  it('drops hybrid/on-site and flagged jobs, keeps unknown workplace', () => {
    const { kept, stats } = run([
      job({ title: 'Software Engineer A', remote: 'Hybrid' }),
      job({ title: 'Software Engineer B', remote: 'On-site' }),
      job({ title: 'Software Engineer C', remote: '' }),
      job({ title: 'Software Engineer D', remote: 'Remote', flags: 'clearance, contract' }),
    ]);
    assert.deepEqual(kept, ['Software Engineer C']);
    assert.equal(stats.notRemote, 2);
    assert.equal(stats.flagged, 1);
  });
  it('drops jobs older than the window (with one day of slack) and keeps undated ones', () => {
    const { kept, stats } = run([job({ title: 'Software Engineer old', posted_date: '2026-10-20' }), job({ title: 'Software Engineer edge', posted_date: '2026-10-28' }), job({ title: 'Software Engineer undated', posted_date: '' })], '7d');
    assert.deepEqual(kept, ['Software Engineer edge', 'Software Engineer undated']);
    assert.equal(stats.tooOld, 1);
    assert.equal(run([job({ title: 'Software Engineer', posted_date: '2026-11-02' })], '24h').stats.tooOld, 1);
  });
});

describe('dedupe', () => {
  it('merges same company+title across sources, keeping links and locations', () => {
    const a = job({ source: 'indeed', job_url: 'https://indeed/1', location: 'Boston, MA', salary: 'USD 100,000 / year' });
    const b = job({ source: 'linkedin', job_url: 'https://li/1', location: 'Austin, TX', recruiter_name: 'Ann' });
    const c = job({ source: 'linkedin', job_url: 'https://li/2', location: 'Austin, TX' });
    const out = dedupe([a, b, c]);
    assert.equal(out.length, 1);
    const j = out[0];
    assert.equal(j.source, 'linkedin', 'richer source wins');
    assert.equal(j.also_found_on, 'indeed');
    assert.equal(j.salary, 'USD 100,000 / year', 'gaps filled from the duplicate');
    assert.equal(j.recruiter_name, 'Ann');
    assert.equal(j.other_job_urls, 'https://li/2; https://indeed/1');
    assert.equal(j.other_locations, 'Boston, MA');
  });
  it('keeps different jobs apart', () => {
    assert.equal(dedupe([job({ job_key: 'a|x' }), job({ job_key: 'b|x' })]).length, 2);
  });
});

describe('enrich', () => {
  it('fills classification columns from a raw job', () => {
    const j = enrich(
      rawJob({
        title: 'Senior Full Stack Engineer',
        salary: '$150k - $180k',
        seniority: 'Mid-Senior level',
        industry: 'Staffing and Recruiting',
        description: 'Fully remote, anywhere in the world. We use React, Next.js, Node.js, TypeScript and PostgreSQL. We cannot sponsor visas.',
      }),
      cfg,
      { query: 'q', location: 'US', scrapedAt: '2026-11-05T00:00:00Z' },
    );
    assert.equal(j.remote, 'Remote');
    assert.equal(j.remote_scope, 'Worldwide');
    assert.equal(j.tech.split(', ').slice(0, 5).join(','), 'React,Next.js,Node.js,TypeScript,PostgreSQL');
    assert.equal(j.stack_match, 'TypeScript, React, Next.js, Node.js, PostgreSQL');
    assert.equal(j.flags, 'no-sponsorship, agency');
    assert.equal(j.seniority, 'senior');
    assert.equal(j.salary_usd_year_est, '165000');
    assert.equal(j.job_key, 'acme|senior fullstack engineer');
    assert.equal(j.search_query, 'q');
  });
  it('downgrades a source "Remote" label when the text says hybrid', () => {
    const j = enrich(rawJob({ remote: 'Remote', description: 'Hybrid: 2 days in the office.' }), cfg, { query: '', location: '', scrapedAt: '' });
    assert.equal(j.remote, 'Remote + hybrid/on-site');
  });
});
