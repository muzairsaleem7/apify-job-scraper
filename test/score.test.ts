import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreJob } from '../src/score.ts';
import { job, testConfig } from './helpers.ts';

const cfg = testConfig();
const TODAY = '2026-11-05';
const s = (o: Parameters<typeof job>[0]) => scoreJob(job(o), cfg, TODAY);

describe('scoreJob', () => {
  it('stays within 0..100 and explains itself', () => {
    const r = s({ title: 'Senior Full Stack Engineer', remote: 'Remote', remote_scope: 'Worldwide', tech: 'React, Node.js, TypeScript', stack_match: 'React, Node.js, TypeScript', recruiter_name: 'A', salary: '$150k', salary_usd_year_est: '150000' });
    assert.ok(r.score >= 90 && r.score <= 100, String(r.score));
    assert.ok(r.reasons.some((x) => /full-stack title/.test(x)));
    assert.ok(r.reasons.some((x) => /worldwide/.test(x)));
    const bad = s({ title: 'Software Engineer', remote: 'On-site', flags: 'clearance, citizenship', tech: 'Java, Spring', seniority: 'junior' });
    assert.ok(bad.score >= 0 && bad.score < 20, String(bad.score));
  });
  it('prefers your stack over another stack, and remote/worldwide over restricted', () => {
    const mine = s({ tech: 'React, Node.js', stack_match: 'React, Node.js' }).score;
    const theirs = s({ tech: 'Java, Spring, C#' }).score;
    assert.ok(mine > theirs);
    assert.ok(s({ remote_scope: 'Worldwide' }).score > s({ remote_scope: '' }).score);
    assert.ok(s({ remote_scope: '' }).score > s({ remote_scope: 'US' }).score);
    assert.ok(s({ remote: 'Remote' }).score > s({ remote: 'Remote + hybrid/on-site' }).score);
  });
  it('respects eligibleRegions', () => {
    const c2 = testConfig({ candidate: { ...cfg.candidate, eligibleRegions: ['EU'] } });
    const eu = scoreJob(job({ remote_scope: 'EU, UK' }), c2, TODAY).score;
    const us = scoreJob(job({ remote_scope: 'US' }), c2, TODAY).score;
    assert.ok(eu > us);
  });
  it('a .NET job that merely mentions MongoDB does not count as your stack', () => {
    const r = s({ title: 'Senior Full-Stack Developer (.NET/C#/Angular)', tech: '.NET, C#, Angular, MongoDB, Redux', stack_match: 'MongoDB, Redux' });
    assert.ok(r.reasons.some((x) => /built on/.test(x)), r.reasons.join(';'));
    assert.ok(r.reasons.some((x) => /another stack in the title/.test(x)));
    const js = s({ title: 'Senior Full-Stack Developer (React/Node)', tech: 'React, Node.js, MongoDB', stack_match: 'React, Node.js, MongoDB' });
    assert.ok(js.score > r.score + 10);
  });
  it('rewards freshness, few applicants, salary, multi-site', () => {
    assert.ok(s({ posted_date: TODAY }).score > s({ posted_date: '2026-10-10' }).score);
    assert.ok(s({ applicants: 'Be among the first 25 applicants' }).score > s({ applicants: 'Over 200 applicants' }).score);
    assert.ok(s({ salary: '$10k', salary_usd_year_est: '10000' }).score < s({ salary: '$150k', salary_usd_year_est: '150000' }).score);
    assert.ok(s({ also_found_on: 'indeed' }).score > s({}).score);
  });
});
