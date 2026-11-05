import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import config from '../config.ts';
import { GoogleAuthError, GoogleClient, SHEET_COLUMNS, cellFor, columnLetter, dataRows, formatRequests, validationRequests } from '../src/google.ts';
import { mockFetch } from './helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'job-scraper-google-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const col = (h: string) => SHEET_COLUMNS.find((c) => c.header === h)!;

describe('sheet layout', () => {
  it('column letters', () => {
    assert.deepEqual([0, 25, 26, 30, 701, 702].map(columnLetter), ['A', 'Z', 'AA', 'AE', 'ZZ', 'AAA']);
  });

  it('writes scraped text as plain strings, never formulas', () => {
    const c = cellFor(col('Title'), { title: '=IMPORTXML("http://evil")' }, 'New') as any;
    assert.deepEqual(c, { userEnteredValue: { stringValue: '=IMPORTXML("http://evil")' } });
  });

  it('numbers, links, status default and empty cells', () => {
    assert.deepEqual(cellFor(col('Score'), { score: '87' }, 'New'), { userEnteredValue: { numberValue: 87 } });
    const link = cellFor(col('Job post'), { job_url: 'https://x.com/j/1' }, 'New') as any;
    assert.equal(link.userEnteredValue.stringValue, 'Open ↗');
    assert.equal(link.userEnteredFormat.textFormat.link.uri, 'https://x.com/j/1');
    assert.deepEqual(cellFor(col('Job post'), { job_url: 'javascript:alert(1)' }, 'New'), { userEnteredValue: { stringValue: 'javascript:alert(1)' } }, 'only http(s) becomes a link');
    assert.deepEqual(cellFor(col('Status'), {}, 'New'), { userEnteredValue: { stringValue: 'New' } });
    assert.deepEqual(cellFor(col('Notes'), { notes: 'ignored' }, 'New'), {}, 'your own columns start empty');
    assert.equal(dataRows([{}, {}], 'New')[1].values.length, SHEET_COLUMNS.length);
  });

  it('status dropdown lists the configured statuses; date columns get date pickers', () => {
    const v = validationRequests(7, config.sheets.statuses) as any[];
    const status = v[0].setDataValidation;
    assert.equal(status.range.sheetId, 7);
    assert.equal(status.range.startRowIndex, 1, 'header row has no dropdown');
    assert.equal(status.range.endRowIndex, undefined, 'whole column');
    assert.deepEqual(status.rule.condition.values.map((x: any) => x.userEnteredValue), config.sheets.statuses.map((s) => s.name));
    assert.equal(v.filter((r) => r.setDataValidation.rule.condition.type === 'DATE_IS_VALID').length, 2);
  });

  it('formatting: a colour rule per status, follow-up reminder, filter', () => {
    const reqs = formatRequests(0, config.sheets.statuses) as any[];
    const rules = reqs.filter((r) => r.addConditionalFormatRule).map((r) => r.addConditionalFormatRule.rule);
    assert.equal(rules.length, config.sheets.statuses.length + 2);
    const fu = columnLetter(SHEET_COLUMNS.findIndex((c) => c.header === 'Follow-up on'));
    assert.ok(rules.some((r) => r.booleanRule?.condition.values[0].userEnteredValue === `=AND(ISNUMBER(${fu}2),${fu}2<=TODAY())`));
    assert.ok(reqs.some((r) => r.setBasicFilter));
  });
});

describe('GoogleClient', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('is not configured without client id/secret', () => {
    const g = new GoogleClient(join(dir, 'g0.json'), '', undefined, config.sheets);
    assert.equal(g.configured, false);
    assert.equal(g.connected, false);
  });

  it('sign-in: PKCE url, code exchange, refuses a token without Drive access', async () => {
    const g = new GoogleClient(join(dir, 'g1.json'), 'cid', 'secret', config.sheets);
    const url = new URL(g.authUrl('http://127.0.0.1:4321/google/callback', '/sheets/tracker'));
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.match(url.searchParams.get('scope')!, /drive\.file/);
    const state = url.searchParams.get('state')!;

    const m = mockFetch(() => ({ body: { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'openid email' } }));
    restore = m.restore;
    await assert.rejects(g.finishSignIn(new URLSearchParams({ state, code: 'c' })), /Drive access was not granted/);
    assert.equal(g.connected, false);
    await assert.rejects(g.finishSignIn(new URLSearchParams({ state, code: 'c' })), /expired/, 'state is single-use');
  });

  it('stores the refresh token and email; a revoked token disconnects', async () => {
    const path = join(dir, 'g2.json');
    const g = new GoogleClient(path, 'cid', 'secret', config.sheets);
    const state = new URL(g.authUrl('http://127.0.0.1:4321/google/callback')).searchParams.get('state')!;
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'me@example.com' })).toString('base64url')}.y`;
    let m = mockFetch(() => ({ body: { access_token: 'a', refresh_token: 'r', expires_in: 1, id_token: idToken, scope: 'openid https://www.googleapis.com/auth/drive.file' } }));
    assert.equal(await g.finishSignIn(new URLSearchParams({ state, code: 'c' })), '/');
    m.restore();
    assert.equal(g.connected, true);
    assert.equal(new GoogleClient(path, 'cid', 'secret', config.sheets).state.email, 'me@example.com', 'persisted');

    m = mockFetch((url) => (url.includes('oauth2.googleapis.com/token') ? { status: 400, body: { error: 'invalid_grant' } } : { body: {} }));
    restore = m.restore;
    await assert.rejects(g.api('GET', 'https://www.googleapis.com/drive/v3/files/x'), GoogleAuthError);
    assert.equal(g.connected, false);
  });

  it('adds only jobs not already in the tracker, once per run', async () => {
    const g = new GoogleClient(join(dir, 'g3.json'), 'cid', 'secret', config.sheets);
    g.state.refreshToken = 'r';
    g.state.trackerId = 'T';
    const keyCol = columnLetter(SHEET_COLUMNS.findIndex((c) => c.header === 'Job key'));
    let appended: any = null;
    const m = mockFetch((url, init) => {
      if (url.includes('/token')) return { body: { access_token: 'a', expires_in: 3600 } };
      if (url.includes('/drive/v3/files/T')) return { body: { id: 'T', trashed: false } };
      if (url.endsWith('?fields=sheets.properties(sheetId%2Ctitle)') || url.includes('fields=sheets.properties(')) return { body: { sheets: [{ properties: { sheetId: 0, title: "Bob's Tracker" } }] } };
      if (url.includes(encodeURIComponent("'Bob''s Tracker'!1:1"))) return { body: { values: [SHEET_COLUMNS.map((c) => c.header)] } };
      if (url.includes(encodeURIComponent(`'Bob''s Tracker'!${keyCol}2:${keyCol}`))) return { body: { values: [['a|x']] } };
      if (url.endsWith(':batchUpdate')) return (appended = JSON.parse(String(init!.body))), { body: {} };
      return { status: 404, body: { error: { message: `unexpected ${url}` } } };
    });
    restore = m.restore;
    const added = await g.addToTracker('run1', [{ job_key: 'a|x', title: 'old' }, { job_key: 'b|y', title: 'new' }, { job_key: 'b|y', title: 'dup' }, { job_key: '', title: 'no key' }]);
    assert.equal(added, 1);
    const rows = appended.requests[0].appendCells.rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].values[SHEET_COLUMNS.findIndex((c) => c.header === 'Title')].userEnteredValue.stringValue, 'new');
    assert.ok(appended.requests.some((r: any) => r.setDataValidation), 'dropdown re-applied to new rows');
    assert.equal(await g.addToTracker('run1', [{ job_key: 'c|z' }]), 0, 'a run is added once');
  });
});
