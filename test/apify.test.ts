import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { ApifyError, NoTokensLeftError, TokenPool, classify, precheckTokens, runActor } from '../src/apify.ts';
import type { SearchTask } from '../src/types.ts';
import { mockFetch } from './helpers.ts';

const task: SearchTask = { source: 'linkedin', actorId: 'valig/linkedin-jobs-scraper', input: { keywords: 'x' }, query: 'x', location: 'US', maxItems: 10, pricePerItemUsd: 0.0004, timeoutSecs: 600 };
const err = (type: string, message = type) => ({ error: { type, message } });
let restore = () => {};
afterEach(() => restore());

describe('classify', () => {
  it('maps API errors to actions', () => {
    assert.equal(classify(new ApifyError(401, 'user-or-token-not-found', '')), 'rotate');
    assert.equal(classify(new ApifyError(402, 'not-enough-usage-to-run-paid-actor', '')), 'rotate');
    assert.equal(classify(new ApifyError(403, 'platform-feature-disabled', 'usage limit')), 'rotate');
    assert.equal(classify(new ApifyError(402, 'actor-memory-limit-exceeded', '')), 'retry');
    assert.equal(classify(new ApifyError(429, 'rate-limit-exceeded', '')), 'retry');
    assert.equal(classify(new ApifyError(503, 'x', '')), 'retry');
    assert.equal(classify(new ApifyError(0, 'network-error', '')), 'retry');
    assert.equal(classify(new ApifyError(404, 'record-not-found', '')), 'fail');
    assert.equal(classify(new ApifyError(400, 'invalid-input', 'bad field')), 'fail');
  });
});

describe('TokenPool', () => {
  it('parses, dedupes, labels, and walks to the next live token', () => {
    const p = new TokenPool(' apify_api_AAAAAA111111, apify_api_BBBBBB222222 apify_api_AAAAAA111111 ');
    assert.equal(p.tokens.length, 2);
    assert.equal(p.tokens[0].label, '#1 (…111111)');
    assert.equal(p.current()?.token, 'apify_api_AAAAAA111111');
    const warn = console.warn;
    console.warn = () => {};
    p.markDead(p.tokens[0], 'bad');
    console.warn = warn;
    assert.equal(p.current()?.token, 'apify_api_BBBBBB222222');
    assert.equal(p.alive, 1);
    assert.equal(new TokenPool(undefined).tokens.length, 0);
  });
});

describe('runActor', () => {
  it('starts the run with caps, polls until finished, pages the dataset, and reports usage', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const page2 = [{ id: 1000 }, { id: 1001 }];
    let polls = 0;
    const m = mockFetch((url, init) => {
      if (url.includes('/acts/valig~linkedin-jobs-scraper/runs')) {
        assert.equal(init?.method, 'POST');
        assert.deepEqual(JSON.parse(String(init?.body)), { keywords: 'x' });
        return { body: { data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1' } } };
      }
      if (url.includes('/actor-runs/run1')) return { body: { data: { id: 'run1', status: ++polls < 2 ? 'RUNNING' : 'SUCCEEDED', defaultDatasetId: 'ds1', usageTotalUsd: 0.0042 } } };
      if (url.includes('/datasets/ds1/items')) return { body: url.includes('offset=0') ? page1 : page2 };
      throw new Error('unexpected ' + url);
    });
    restore = m.restore;
    const res = await runActor(task, new TokenPool('t1'), { retryDelayMs: 1 });
    assert.equal(res.items.length, 1002);
    assert.equal(res.status, 'SUCCEEDED');
    assert.equal(res.usageUsd, 0.0042);
    assert.equal(res.warning, undefined);
    const start = m.calls[0].url;
    assert.ok(start.includes('maxItems=10') && start.includes('maxTotalChargeUsd=0.026') && start.includes('timeout=600'), start);
    assert.equal(m.calls[0].init?.headers && (m.calls[0].init.headers as any).Authorization, 'Bearer t1');
  });

  it('rotates to the next token on 401/402 and uses it for everything after', async () => {
    const m = mockFetch((url, init) => {
      const auth = (init?.headers as any).Authorization;
      if (auth === 'Bearer bad') return { status: 401, body: err('user-or-token-not-found', 'bad token') };
      if (url.includes('/runs')) return { body: { data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } } };
      if (url.includes('/datasets/d/items')) return { body: [{ id: 1 }] };
      throw new Error('unexpected ' + url);
    });
    restore = m.restore;
    const pool = new TokenPool('bad,good');
    const warn = console.warn;
    console.warn = () => {};
    const res = await runActor(task, pool, { retryDelayMs: 1 });
    console.warn = warn;
    assert.equal(res.items.length, 1);
    assert.equal(res.tokenLabel, '#2 (…good)');
    assert.equal(pool.tokens[0].dead, true);
    assert.ok(m.calls.slice(1).every((c) => (c.init?.headers as any).Authorization === 'Bearer good'));
  });

  it('retries temporary errors with backoff, then succeeds', async () => {
    let attempts = 0;
    const m = mockFetch((url) => {
      if (url.includes('/runs')) return ++attempts < 3 ? { status: 429, body: err('rate-limit-exceeded') } : { body: { data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } } };
      return { body: [] };
    });
    restore = m.restore;
    const res = await runActor(task, new TokenPool('t'), { retryDelayMs: 1 });
    assert.equal(attempts, 3);
    assert.equal(res.items.length, 0);
  });

  it('treats a run that died for account reasons as a token failure, and keeps partial results otherwise', async () => {
    const m = mockFetch((url, init) => {
      const auth = (init?.headers as any).Authorization;
      if (url.includes('/runs')) return { body: { data: { id: 'r', status: 'ABORTED', statusMessage: auth === 'Bearer t1' ? 'Monthly usage hard limit exceeded' : 'Timed out', defaultDatasetId: 'd' } } };
      return { body: [{ id: 1 }, { id: 2 }] };
    });
    restore = m.restore;
    const pool = new TokenPool('t1,t2');
    const warn = console.warn;
    console.warn = () => {};
    const res = await runActor(task, pool, { retryDelayMs: 1 });
    console.warn = warn;
    assert.equal(pool.tokens[0].dead, true);
    assert.equal(res.status, 'ABORTED');
    assert.equal(res.items.length, 2);
    assert.match(res.warning ?? '', /kept 2 partial results/);
  });

  it('throws NoTokensLeftError when every token is dead, and fails fast on a bad input', async () => {
    const m = mockFetch(() => ({ status: 401, body: err('user-or-token-not-found') }));
    restore = m.restore;
    const warn = console.warn;
    console.warn = () => {};
    await assert.rejects(runActor(task, new TokenPool('a,b'), { retryDelayMs: 1 }), NoTokensLeftError);
    console.warn = warn;
    m.restore();
    const m2 = mockFetch(() => ({ status: 400, body: err('invalid-input', 'Field limit must be a number') }));
    restore = m2.restore;
    await assert.rejects(runActor(task, new TokenPool('a'), { retryDelayMs: 1 }), (e: ApifyError) => e.status === 400);
    assert.equal(m2.calls.length, 1);
  });
});

describe('precheckTokens', () => {
  it('skips invalid tokens and tokens with almost no credit left', async () => {
    const m = mockFetch((url, init) => {
      const auth = (init?.headers as any).Authorization;
      if (auth === 'Bearer dead') return { status: 401, body: err('user-or-token-not-found') };
      if (url.endsWith('/users/me')) return { body: { data: { username: auth === 'Bearer poor' ? 'poor' : 'rich', plan: { id: 'FREE' } } } };
      if (url.endsWith('/users/me/limits')) return { body: { data: { current: { monthlyUsageUsd: auth === 'Bearer poor' ? 4.99 : 1 }, limits: { maxMonthlyUsageUsd: 5 } } } };
      throw new Error('unexpected ' + url);
    });
    restore = m.restore;
    const pool = new TokenPool('dead,poor,rich');
    const infos = await precheckTokens(pool, 0.05);
    assert.deepEqual(pool.tokens.map((t) => t.dead), [true, true, false]);
    assert.match(pool.tokens[1].reason ?? '', /only \$0\.01 left/);
    assert.equal(infos[2].username, 'rich');
  });
});
