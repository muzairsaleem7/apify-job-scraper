import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { FREE_SOURCES, rssItems } from '../src/free-sources.ts';
import { APIFY_SOURCES, dedupeGroups, glassdoor, indeed, linkedin, wellfound } from '../src/sources.ts';
import type { PlanContext, SearchTask } from '../src/types.ts';
import { mockFetch, testConfig } from './helpers.ts';

const cfg = testConfig();
const ctx = (seen: Record<string, string[]> = {}, limitCap?: number): PlanContext => ({ seenIds: (s) => seen[s] ?? [], limitCap });
let restore = () => {};
afterEach(() => restore());

describe('dedupeGroups', () => {
  it('searches each title once, first group wins', () => {
    assert.deepEqual(dedupeGroups([['A', 'B'], ['b', 'C'], ['a']]), [['A', 'B'], ['C']]);
  });
});

describe('Apify plans', () => {
  it('linkedin: one run per deduped group x location, with server-side filters and skip IDs', () => {
    const tasks = linkedin.plan(cfg, '24h', ctx({ linkedin: ['11', '22'] }));
    const groups = dedupeGroups(cfg.titleGroups).length;
    assert.equal(tasks.length, groups * cfg.sources.linkedin.locations.length);
    const t = tasks[0];
    assert.match(String(t.input.keywords), /^\(.*\) AND remote$/);
    assert.equal(t.input.datePosted, 'r86400');
    assert.deepEqual(t.input.skipJobId, ['11', '22']);
    assert.ok((t.input.titleInclude as string[]).includes('Full Stack Developer'));
    assert.ok((t.input.titleExclude as string[]).includes('junior'));
    assert.equal(t.maxItems, cfg.sources.linkedin.limitPerSearch);
    assert.equal(linkedin.plan(cfg, '7d', ctx())[0].input.datePosted, 'r604800');
    assert.equal(linkedin.plan(cfg, '30d', ctx())[0].input.datePosted, 'r2592000');
    assert.equal('skipJobId' in linkedin.plan(cfg, '7d', ctx())[0].input, false);
  });
  it('--limit caps every paid search', () => {
    for (const src of Object.values(APIFY_SOURCES)) for (const t of src.plan(cfg, '7d', ctx({}, 3))) assert.equal(t.maxItems, 3, src.name);
    assert.equal(wellfound.plan(cfg, '7d', ctx({}, 3))[0].input.maxResults, 3);
  });
  it('indeed / glassdoor / wellfound map the window and skip IDs', () => {
    assert.equal(indeed.plan(cfg, '24h', ctx())[0].input.datePosted, '1');
    assert.equal(indeed.plan(cfg, '3d', ctx())[0].input.datePosted, '3');
    assert.equal(indeed.plan(cfg, '30d', ctx())[0].input.datePosted, '14');
    assert.equal(indeed.plan(cfg, '7d', ctx())[0].input.location, 'remote');
    const g = glassdoor.plan(cfg, '7d', ctx({ glassdoor: ['9'] }))[0];
    assert.equal(g.input.daysOld, 7);
    assert.equal(g.input.remoteWorkType, true);
    assert.deepEqual(g.input.excludeJobIds, ['9']);
    const w = wellfound.plan(cfg, '3d', ctx())[0];
    assert.equal(w.input.maxAgeMinutes, 3 * 1440);
    assert.equal(w.input.remote, true);
    assert.equal(w.timeoutSecs, 1800);
  });
});

describe('Apify normalizers', () => {
  const task = {} as SearchTask;
  it('linkedin', () => {
    const j = linkedin.normalize({ id: '4219847745', url: 'https://www.linkedin.com/jobs/view/x', title: 'C++ Software Engineer', location: 'New York, NY', companyName: 'Goliath Partners', companyUrl: 'https://li/company/g', recruiterName: 'Ishan Ghosh', recruiterUrl: 'https://li/in/ishan', experienceLevel: 'Mid-Senior level', contractType: 'Full-time', workType: 'Staffing and Recruiting', sector: '', salary: '$250,000.00/yr - $800,000.00/yr', applyType: 'EASY_APPLY', postedDate: '2025-04-30', applicationsCount: '64 applicants', description: '<p>Hybrid</p>' }, task)!;
    assert.equal(j.source_id, '4219847745');
    assert.equal(j.easy_apply, 'Yes');
    assert.equal(j.recruiter_name, 'Ishan Ghosh');
    assert.equal(j.industry, 'Staffing and Recruiting');
    assert.equal(j.description, 'Hybrid');
    assert.equal(j.posted_date, '2025-04-30');
    assert.equal(linkedin.normalize({}, task), null);
  });
  it('indeed', () => {
    const j = indeed.normalize({ key: '5e5d', url: 'https://www.indeed.com/viewjob?jk=5e5d', title: 'Quantitative Analyst', jobUrl: 'https://jobs.citi.com/x', datePublished: '2025-06-04T05:00:00.000Z', location: { countryName: 'United States', admin1Code: 'NY', city: 'New York' }, employer: { name: 'Citi', corporateWebsite: 'http://www.citigroup.com' }, attributes: { a: 'Remote', b: '6 years' }, jobTypes: { c: 'Full-time' }, baseSalary: { min: 175000, max: 250000, unitOfWork: 'YEAR', currencyCode: 'USD' }, description: { text: 'The role...' } }, task)!;
    assert.equal(j.location, 'New York, NY, United States');
    assert.equal(j.remote, 'Remote');
    assert.equal(j.salary, 'USD 175,000-250,000 / year');
    assert.equal(j.seniority, '6 years');
    assert.equal(j.apply_url, 'https://jobs.citi.com/x');
  });
  it('glassdoor', () => {
    const j = glassdoor.normalize({ id: 1010062906489, title: 'Senior Engineer', url: 'https://gd/j?jl=1', seoUrl: 'https://gd/seo', ageInDays: 0, easyApply: false, employer: { name: 'GEICO', url: 'https://gd/e' }, location: { name: 'New York, NY' }, pay: { currency: 'USD', period: 'ANNUAL', min: 100000, max: 215000 }, description: '<div>Remote</div>' }, task)!;
    assert.equal(j.source_id, '1010062906489');
    assert.equal(j.job_url, 'https://gd/seo');
    assert.equal(j.salary, 'USD 100,000-215,000 / year');
    assert.equal(j.easy_apply, 'No');
    assert.equal(j.posted_date, new Date().toISOString().slice(0, 10));
  });
  it('wellfound', () => {
    const j = wellfound.normalize({ id: '4716549', title: 'Senior Software Engineer', portalUrl: 'https://wellfound.com/jobs/4716549-x', compensation: '$175k – $225k • 0.5% – 1.0%', jobType: 'full-time', postedAt: '2026-09-14T18:03:48Z', locationNames: ['New York City', 'SF'], remote: false, remoteKind: 'ONSITE', yearsExperienceMin: 5, skills: ['TypeScript'], companyName: 'Hourglass', companyWebsite: 'https://hourglass.com', industry: 'Fintech', description: 'Desc' }, task)!;
    assert.equal(j.remote, 'On-site');
    assert.equal(j.seniority, '5+ years');
    assert.equal(j.location, 'New York City; SF');
    assert.equal(j.skills, 'TypeScript');
    assert.equal(wellfound.normalize({ ...{ title: 'x', remote: true } }, task)!.remote, 'Remote');
  });
});

describe('free sources', () => {
  it('rssItems parses items, CDATA and escaped HTML', () => {
    const xml = `<rss><channel><item><title>Acme: Full Stack Dev</title><region>USA Only</region><link>https://wwr/x/1</link><guid>https://wwr/x/1</guid><pubDate>Thu, 05 Nov 2026 17:09:07 +0000</pubDate><type>Full-Time</type><description>&lt;p&gt;Remote &amp;amp; fun&lt;/p&gt;</description></item><item><title><![CDATA[Beta: Backend Eng]]></title><link>https://wwr/x/2</link></item></channel></rss>`;
    const items = rssItems(xml);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, 'Acme: Full Stack Dev');
    assert.equal(items[0].region, 'USA Only');
    assert.equal(items[1].title, 'Beta: Backend Eng');
  });
  it('wwr splits company from title and keeps the region', async () => {
    const xml = `<rss><item><title>Acme: Full Stack Dev</title><region>Anywhere in the World</region><country>Canada</country><link>https://wwr/remote-jobs/acme-full-stack-dev</link><guid>https://wwr/remote-jobs/acme-full-stack-dev</guid><pubDate>Thu, 05 Nov 2026 17:09:07 +0000</pubDate><type>Full-Time</type><description>&lt;p&gt;Remote&lt;/p&gt;</description></item></rss>`;
    const m = mockFetch(() => ({ text: xml }));
    restore = m.restore;
    const rows = await FREE_SOURCES.wwr.fetch(testConfig({ sources: { ...cfg.sources, wwr: { enabled: true, feeds: ['a', 'b'] } } }), '7d');
    assert.equal(m.calls.length, 2);
    assert.equal(rows.length, 1, 'same guid from two feeds is one job');
    assert.equal(rows[0].company, 'Acme');
    assert.equal(rows[0].title, 'Full Stack Dev');
    assert.equal(rows[0].candidate_location, 'Anywhere in the World');
    assert.equal(rows[0].location, 'Canada');
    assert.equal(rows[0].posted_date, '2026-11-05');
    assert.equal(rows[0].source_id, 'acme-full-stack-dev');
  });
  it('remoteok dedupes across tags and skips the legal notice', async () => {
    const m = mockFetch(() => ({ body: [{ legal: 'notice' }, { id: 1, position: 'Dev', company: 'A', url: 'https://ro/1', location: 'Worldwide', date: '2026-11-04T15:09:09+00:00', tags: ['dev'], salary_min: 50000, salary_max: 70000, description: '<p>x</p>' }] }));
    restore = m.restore;
    const rows = await FREE_SOURCES.remoteok.fetch(testConfig({ sources: { ...cfg.sources, remoteok: { enabled: true, tags: ['dev', 'react'] } } }), '7d');
    assert.equal(m.calls.length, 2);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].candidate_location, 'Worldwide');
    assert.equal(rows[0].salary, 'USD 50,000-70,000 / year');
    assert.equal(rows[0].remote, 'Remote');
  });
  it('jobicy maps geo/level and passes raw params', async () => {
    const m = mockFetch(() => ({ body: { jobs: [{ id: 5, jobTitle: 'Full-Stack Engineer', companyName: 'E', url: 'https://j/5', jobGeo: 'USA', jobLevel: 'Senior', jobType: ['Full-Time'], pubDate: '2026-11-05T10:54:58+00:00', jobDescription: '<p>d</p>' }] } }));
    restore = m.restore;
    const rows = await FREE_SOURCES.jobicy.fetch(testConfig({ sources: { ...cfg.sources, jobicy: { enabled: true, tags: ['full-stack', 'industry=engineering'] } } }), '7d');
    assert.ok(m.calls[0].url.endsWith('tag=full-stack'));
    assert.ok(m.calls[1].url.endsWith('industry=engineering'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].candidate_location, 'USA');
    assert.equal(rows[0].seniority, 'Senior');
  });
  it('workingnomads keeps development jobs only; arbeitnow keeps remote only', async () => {
    const m = mockFetch((url) => (url.includes('workingnomads') ? { body: [{ title: 'Dev', url: 'https://wn/job/go/123/', category_name: 'Development', location: 'Europe', pub_date: '2026-11-05T03:10:45-05:00', tags: 'a,b' }, { title: 'Sales', url: 'https://wn/job/go/124/', category_name: 'Sales' }] } : { body: { data: [{ title: 'Remote Dev', remote: true, url: 'https://ab/1', slug: 's1', location: 'Berlin', created_at: 1793898065 }, { title: 'Office Dev', remote: false, url: 'https://ab/2', slug: 's2' }] } }));
    restore = m.restore;
    const wn = await FREE_SOURCES.workingnomads.fetch(cfg, '7d');
    assert.equal(wn.length, 1);
    assert.equal(wn[0].source_id, '123');
    assert.equal(wn[0].candidate_location, 'Europe');
    const ab = await FREE_SOURCES.arbeitnow.fetch(testConfig({ sources: { ...cfg.sources, arbeitnow: { enabled: true, pages: 1 } } }), '7d');
    assert.equal(ab.length, 1);
    assert.equal(ab[0].posted_date, '2026-11-05');
  });
  it('a non-JSON (blocked) response becomes a clear error', async () => {
    const m = mockFetch(() => ({ text: '<!DOCTYPE html>Just a moment...' }));
    restore = m.restore;
    await assert.rejects(FREE_SOURCES.workingnomads.fetch(cfg, '7d'), /non-JSON response/);
  });
});
