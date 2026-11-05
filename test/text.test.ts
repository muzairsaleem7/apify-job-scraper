import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { annualUsd, eligibilityFlags, extractTech, geoToRegions, parseSalary, remoteScope, seniorityOf, stackMatch, workplace } from '../src/text.ts';
import { isoDate, normalizeText, phraseMatcher, plainText } from '../src/util.ts';

describe('normalizeText / phraseMatcher', () => {
  it('unifies spellings', () => {
    assert.equal(normalizeText('Sr. Full-Stack Engineer (Node.js / C#)'), 'senior fullstack engineer node js csharp');
    assert.equal(normalizeText('.NET Developer, C++'), 'dotnet developer cpp');
    assert.equal(normalizeText('Front End / Back End Dev'), 'frontend backend dev');
  });
  it('matches phrases in any order with hyphens ignored', () => {
    const m = phraseMatcher(['Full Stack Engineer', 'Software Engineer']);
    assert.equal(m('Engineer, Full-Stack (Remote)'), 'fullstack engineer');
    assert.equal(m('Senior Software Development Engineer in Test'), 'software engineer');
    assert.equal(m('Product Manager'), null);
  });
  it('plainText strips HTML, decodes entities, handles RSS double escaping', () => {
    assert.equal(plainText('<p>Hello &amp; <b>world</b></p><br>ok'), 'Hello & world ok');
    assert.equal(plainText('&lt;p&gt;Remote &amp;amp; flexible&lt;/p&gt;'), 'Remote & flexible');
    assert.equal(plainText('x'.repeat(20), 10), 'xxxxxxxxxx…');
  });
  it('isoDate handles ISO, RFC 2822 and epoch', () => {
    assert.equal(isoDate('2026-11-04T00:00:00.000Z'), '2026-11-04');
    assert.equal(isoDate('Thu, 05 Nov 2026 17:09:07 +0000'), '2026-11-05');
    assert.equal(isoDate(1793897472), '2026-11-05');
    assert.equal(isoDate('garbage'), '');
  });
});

describe('workplace', () => {
  it('classifies remote / hybrid / on-site', () => {
    assert.equal(workplace('This is a fully remote role.'), 'Remote');
    assert.equal(workplace('Hybrid, 3 days a week in our London office'), 'Hybrid');
    assert.equal(workplace('On-site in Austin'), 'On-site');
    assert.equal(workplace('Remote or hybrid depending on location'), 'Remote + hybrid/on-site');
    assert.equal(workplace('This is not a remote position'), 'On-site');
    assert.equal(workplace('Great team, competitive pay'), '');
  });
});

describe('remoteScope / geoToRegions', () => {
  it('maps explicit board fields', () => {
    assert.deepEqual(geoToRegions('Anywhere in the World'), ['Worldwide']);
    assert.deepEqual(geoToRegions('USA Only'), ['US']);
    assert.deepEqual(geoToRegions('Europe, USA'), ['EU', 'US']);
    assert.deepEqual(geoToRegions('Bulgaria, France, Germany, Poland, UK'), ['EU', 'UK']);
    assert.deepEqual(geoToRegions('North America Only'), ['US', 'Canada']);
    assert.deepEqual(geoToRegions(''), []);
  });
  it('reads restrictions from the description', () => {
    assert.equal(remoteScope('Remote. Must be authorized to work in the United States.').label, 'US');
    assert.equal(remoteScope('Candidates must reside in Canada.').label, 'Canada');
    assert.equal(remoteScope('Remote (EU) — CET timezone').label, 'EU');
    assert.equal(remoteScope('Remote - UK based only').label, 'UK');
    assert.equal(remoteScope('Remote role based in Latin America with 6 hours of overlap with US Eastern Time').label, 'US, LATAM');
  });
  it('worldwide when stated and nothing restricts', () => {
    const s = remoteScope('Work from anywhere in the world. We are a fully distributed team.');
    assert.equal(s.kind, 'worldwide');
    assert.equal(s.label, 'Worldwide');
    assert.equal(remoteScope('Join us for a great role.').kind, 'unknown');
  });
  it('explicit region beats text, explicit worldwide yields to a text restriction', () => {
    assert.equal(remoteScope('must be located in the US', 'Europe').label, 'EU');
    assert.equal(remoteScope('must be located in the US', 'Anywhere in the World').label, 'US');
  });
  it('does not treat the word "us" as the United States', () => {
    assert.equal(remoteScope('Join us! Contact us for details about us.').kind, 'unknown');
  });
});

describe('eligibilityFlags', () => {
  it('finds clearance, citizenship, sponsorship, contract, agency', () => {
    const f = eligibilityFlags('Active Secret clearance required. US citizenship required. We do not sponsor visas. 1099 contractor.');
    for (const x of ['clearance', 'citizenship', 'no-sponsorship', '1099', 'contract']) assert.ok(f.includes(x), x);
    assert.ok(eligibilityFlags('Visa sponsorship is available for this role').includes('sponsorship-offered'));
    assert.ok(eligibilityFlags('x', { industry: 'Staffing and Recruiting' }).includes('agency'));
    assert.ok(eligibilityFlags('x', { company: 'Goodwin Recruiting' }).includes('agency'));
    assert.ok(eligibilityFlags('x', { employmentType: 'Part-time' }).includes('part-time'));
    assert.ok(eligibilityFlags('4 hours of overlap with Pacific time').includes('tz-overlap'));
    assert.deepEqual(eligibilityFlags('Nothing special here.'), []);
  });
});

describe('extractTech / stackMatch', () => {
  it('extracts in order of appearance without false positives', () => {
    const t = extractTech('We use TypeScript, React and Node.js with PostgreSQL on AWS. Good to have: Go, Python. Not Java.');
    assert.deepEqual(t.slice(0, 5), ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'AWS']);
    assert.ok(t.includes('Python') && t.includes('Java'));
    assert.ok(!t.includes('Go'), '"Go" alone (not golang) must not match');
    assert.ok(!extractTech('Let us go further and express our goals').includes('Express'));
    assert.ok(!extractTech('Let us go further').includes('Go'));
    assert.ok(extractTech('Golang microservices').includes('Go'));
    assert.ok(extractTech('React Native apps').includes('React Native'));
    assert.ok(!extractTech('React Native apps').includes('React'));
    assert.ok(extractTech('C#/.NET Core and C++').includes('C#'));
    assert.ok(extractTech('C#/.NET Core and C++').includes('.NET'));
    assert.ok(extractTech('C#/.NET Core and C++').includes('C++'));
  });
  it('stackMatch ignores punctuation and case', () => {
    assert.deepEqual(stackMatch(['Node.js', 'React', 'MongoDB'], ['react', 'nodejs', 'Next.js']), ['react', 'nodejs']);
  });
});

describe('seniorityOf', () => {
  it('reads the title first, then the source field', () => {
    assert.equal(seniorityOf('Sr. Software Engineer'), 'senior');
    assert.equal(seniorityOf('Staff Full Stack Engineer, Product'), 'staff');
    assert.equal(seniorityOf('Junior Developer'), 'junior');
    assert.equal(seniorityOf('Engineering Manager'), 'manager');
    assert.equal(seniorityOf('Software Engineer III'), 'senior');
    assert.equal(seniorityOf('Software Engineer', 'Mid-Senior level'), 'mid');
    assert.equal(seniorityOf('Software Engineer', 'Entry level'), 'junior');
    assert.equal(seniorityOf('Software Engineer', '5+ years'), 'senior');
    assert.equal(seniorityOf('Software Engineer', '8+ years'), 'staff');
    assert.equal(seniorityOf('Software Engineer', 'Not Applicable'), '');
    assert.equal(seniorityOf('Software Engineer'), '');
  });
});

describe('parseSalary / annualUsd', () => {
  const cases: [string, number | null][] = [
    ['$250,000.00/yr - $800,000.00/yr', 525_000],
    ['£40,000.00/yr - £45,000.00/yr', Math.round((42_500 * 1.28) / 100) * 100],
    ['USD 140,000-160,000 / year', 150_000],
    ['$175k – $225k • 0.5% – 1.0%', 200_000],
    ['$3.5k–$5k/month', 51_000],
    ['USD 60-66 / hour', Math.round((63 * 2080) / 100) * 100],
    ['$20k -$35k', 27_500],
    ['CAD 101,000-132,500 / year', Math.round((116_750 * 0.72) / 100) * 100],
    ['GBP 40-80 / hour', Math.round((60 * 2080 * 1.28) / 100) * 100],
    ['Competitive', null],
    ['', null],
  ];
  for (const [input, expected] of cases) it(`${JSON.stringify(input)} -> ${expected}`, () => assert.equal(annualUsd(parseSalary(input)), expected));
  it('keeps currency and period', () => {
    assert.deepEqual(parseSalary('€60k - €80k per year'), { min: 60_000, max: 80_000, currency: 'EUR', period: 'year' });
    assert.deepEqual(parseSalary('AED 25,000 / month'), { min: 25_000, max: 25_000, currency: 'AED', period: 'month' });
  });
});
