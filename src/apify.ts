import { sleep } from './util.ts';
import type { SearchTask } from './types.ts';

const API = 'https://api.apify.com/v2';

export class ApifyError extends Error {
  status: number;
  type: string;
  constructor(status: number, type: string, message: string) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

export class NoTokensLeftError extends Error {}

export interface TokenState {
  token: string;
  label: string;
  dead: boolean;
  reason?: string;
}

/** Ordered list of Apify tokens. Everyone uses the first healthy one; a broken one is marked dead. */
export class TokenPool {
  tokens: TokenState[];

  constructor(raw: string | undefined) {
    const list = (raw ?? '')
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    this.tokens = [...new Set(list)].map((token, i) => ({ token, label: `#${i + 1} (…${token.slice(-6)})`, dead: false }));
  }

  static fromEnv(): TokenPool {
    return new TokenPool(process.env.APIFY_TOKENS || process.env.APIFY_TOKEN);
  }

  current(): TokenState | undefined {
    return this.tokens.find((t) => !t.dead);
  }

  markDead(t: TokenState, reason: string) {
    if (t.dead) return;
    t.dead = true;
    t.reason = reason;
    const next = this.current();
    console.warn(`  ! token ${t.label} dropped: ${reason}${next ? ` -> switching to ${next.label}` : ' -> NO TOKENS LEFT'}`);
  }

  get alive() {
    return this.tokens.filter((t) => !t.dead).length;
  }
}

async function api<T = any>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new ApifyError(0, 'network-error', (e as Error).message);
  }
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    throw new ApifyError(res.status, body?.error?.type ?? 'http-error', body?.error?.message ?? text.slice(0, 200) ?? res.statusText);
  }
  return body as T;
}

type Action = 'rotate' | 'retry' | 'fail';

const ACCOUNT_PROBLEM = /usage|limit exceeded|hard limit|credit|insufficient|payment|plan|suspend|disabled|blocked|not-enough/i;

/** Decide what an API error means: the account is unusable (rotate), it's temporary (retry), or it's this task (fail). */
export function classify(e: ApifyError): Action {
  const s = `${e.type} ${e.message}`;
  if (e.status === 0 || e.status === 429 || e.status >= 500 || /memory|concurren/i.test(s)) return 'retry';
  if (e.status === 401 || e.status === 402) return 'rotate';
  if ((e.status === 403 || e.status === 400) && ACCOUNT_PROBLEM.test(s)) return 'rotate';
  return 'fail';
}

export interface ActorResult {
  items: any[];
  status: string;
  tokenLabel: string;
  runId: string;
  /** Cost reported by Apify on the run object (may lag behind; 0 on the free plan until usage posts). */
  usageUsd: number;
  warning?: string;
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

export interface RunOptions {
  /** Base delay for retries/polling errors (tests pass a tiny value). */
  retryDelayMs?: number;
}

/** Run one Actor to completion and return its dataset items, rotating tokens when an account drops. */
export async function runActor(task: SearchTask, pool: TokenPool, opts: RunOptions = {}): Promise<ActorResult> {
  const baseDelay = opts.retryDelayMs ?? 5_000;
  const actorPath = task.actorId.replace('/', '~');
  // Hard spending cap for this one run: expected items x price, plus headroom for start events.
  const maxCharge = (task.maxItems * task.pricePerItemUsd * 1.5 + 0.02).toFixed(3);
  const qs = `maxItems=${task.maxItems}&maxTotalChargeUsd=${maxCharge}&timeout=${task.timeoutSecs}`;
  let retries = 0;

  for (;;) {
    const t = pool.current();
    if (!t) throw new NoTokensLeftError('All Apify tokens are exhausted or invalid.');

    try {
      const started = await api(t.token, `/acts/${actorPath}/runs?${qs}`, { method: 'POST', body: JSON.stringify(task.input) });
      let run = started.data;

      while (!TERMINAL.has(run.status)) {
        try {
          run = (await api(t.token, `/actor-runs/${run.id}?waitForFinish=60`)).data;
        } catch (e) {
          if (e instanceof ApifyError && classify(e) === 'retry') {
            await sleep(baseDelay);
            continue;
          }
          throw e;
        }
      }

      // The run itself was stopped because the account ran out of credit: retry on the next token.
      if (run.status !== 'SUCCEEDED' && ACCOUNT_PROBLEM.test(run.statusMessage ?? '')) {
        pool.markDead(t, `run ${run.status}: ${run.statusMessage}`);
        continue;
      }

      const items: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await api<any[]>(t.token, `/datasets/${run.defaultDatasetId}/items?clean=true&offset=${offset}&limit=1000`);
        items.push(...page);
        if (page.length < 1000) break;
      }

      return {
        items,
        status: run.status,
        tokenLabel: t.label,
        runId: run.id,
        usageUsd: Number(run.usageTotalUsd) || 0,
        warning: run.status === 'SUCCEEDED' ? undefined : `run ended ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ''} (kept ${items.length} partial results)`,
      };
    } catch (e) {
      if (!(e instanceof ApifyError)) throw e;
      const action = classify(e);
      if (action === 'rotate') {
        pool.markDead(t, `${e.status} ${e.type}: ${e.message}`);
        continue;
      }
      if (action === 'retry' && retries < 4) {
        retries++;
        await sleep(baseDelay * 2 ** retries);
        continue;
      }
      throw e;
    }
  }
}

export interface TokenInfo {
  label: string;
  ok: boolean;
  username?: string;
  plan?: string;
  usedUsd?: number;
  limitUsd?: number;
  error?: string;
}

/** Look up account name and monthly usage for every token (used by `npm run tokens` and the pre-run check). */
export async function inspectTokens(pool: TokenPool): Promise<TokenInfo[]> {
  return Promise.all(
    pool.tokens.map(async (t): Promise<TokenInfo> => {
      try {
        const me = (await api(t.token, '/users/me')).data;
        const info: TokenInfo = { label: t.label, ok: true, username: me?.username, plan: me?.plan?.id };
        try {
          const lim = (await api(t.token, '/users/me/limits')).data;
          info.usedUsd = lim?.current?.monthlyUsageUsd;
          info.limitUsd = lim?.limits?.maxMonthlyUsageUsd;
        } catch {
          /* limits endpoint is optional */
        }
        return info;
      } catch (e) {
        return { label: t.label, ok: false, error: e instanceof ApifyError ? `${e.status} ${e.type}: ${e.message}` : String(e) };
      }
    }),
  );
}

/** Mark tokens dead before scraping if they are invalid or nearly out of monthly credit. */
export async function precheckTokens(pool: TokenPool, minBalanceUsd: number): Promise<TokenInfo[]> {
  const infos = await inspectTokens(pool);
  infos.forEach((info, i) => {
    const t = pool.tokens[i];
    if (!info.ok && /^40[13]/.test(info.error ?? '')) {
      t.dead = true;
      t.reason = info.error;
    } else if (typeof info.usedUsd === 'number' && typeof info.limitUsd === 'number' && info.limitUsd - info.usedUsd < minBalanceUsd) {
      t.dead = true;
      t.reason = `only $${(info.limitUsd - info.usedUsd).toFixed(2)} left this month`;
    }
  });
  return infos;
}

/** Sum of this month's usage across all valid tokens (null if the API doesn't report it). Diff before/after = what a scrape really cost. */
export async function accountUsageUsd(pool: TokenPool): Promise<number | null> {
  const infos = await inspectTokens(pool);
  const known = infos.filter((i) => typeof i.usedUsd === 'number');
  return known.length ? known.reduce((a, i) => a + (i.usedUsd as number), 0) : null;
}
