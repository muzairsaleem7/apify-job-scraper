import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import config from '../config.ts';
import { TokenPool, inspectTokens } from './apify.ts';
import { GoogleAuthError, GoogleClient, type RunSheet } from './google.ts';
import { COMMANDS, type CommandDef, History, type HistoryEntry, LOG_LINES, type RunInfo, listRuns, localDay, readRun, runIdTime, sheetTitle, windowLabel } from './runs.ts';
import { parseCsv } from './store.ts';

/**
 * The web UI: `npm start`. One local server that runs every command from a button, shows the output files,
 * keeps the history, and saves results to Google Sheets. Listens on 127.0.0.1 only.
 */

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, 'output');
const DATA = join(ROOT, 'data');
const MASTER = join(OUTPUT, 'master.csv');

const { values: opts } = parseArgs({ options: { port: { type: 'string' }, 'no-open': { type: 'boolean', default: false } } });
const PORT = Number(opts.port ?? process.env.UI_PORT ?? 4321);
const BASE = `http://127.0.0.1:${PORT}`;
const REDIRECT_URI = `${BASE}/google/callback`;
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const history = new History(join(DATA, 'ui-history.json'));
history.markInterrupted();
const google = new GoogleClient(join(DATA, 'google.json'), process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, config.sheets);

let running: { entry: HistoryEntry; cmd: CommandDef; child: ChildProcess; log: string[] } | null = null;
const syncing = new Map<string, Promise<RunSheet>>();
let apify = { text: 'checking…', ok: false };

// ---------------------------------------------------------------- Apify credit (shown in the header)

async function refreshApify() {
  const pool = TokenPool.fromEnv();
  if (!pool.tokens.length) return void (apify = { text: 'no token in .env', ok: false });
  try {
    const infos = await inspectTokens(pool);
    const ok = infos.filter((i) => i.ok);
    const left = ok.reduce((a, i) => a + (typeof i.limitUsd === 'number' && typeof i.usedUsd === 'number' ? i.limitUsd - i.usedUsd : 0), 0);
    const bad = infos.length - ok.length;
    apify = ok.length ? { text: `$${left.toFixed(2)} left this month${bad ? ` · ${bad} token(s) invalid` : ''}`, ok: true } : { text: 'token invalid — run "Check Apify credit"', ok: false };
  } catch (e) {
    apify = { text: `check failed: ${(e as Error).message}`, ok: false };
  }
}

// ---------------------------------------------------------------- running commands

function startCommand(id: string): HistoryEntry {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) throw new HttpError(400, `Unknown command "${id}"`);
  if (running) throw new HttpError(409, `"${running.cmd.label}" is still running.`);
  const today = localDay();
  if (history.usedToday(cmd.id, today)) throw new HttpError(409, `"${cmd.label}" was already used today. It unlocks again tomorrow.`);

  const entry: HistoryEntry = { id: `${Date.now()}-${cmd.id}`, command: cmd.id, label: cmd.label, day: today, startedAt: new Date().toISOString(), status: 'running', log: [] };
  history.add(entry);
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', join('src', 'cli.ts'), ...cmd.args], { cwd: ROOT, env: process.env, windowsHide: true });
  const log: string[] = [];
  let partial = '';
  const onData = (buf: Buffer) => {
    const lines = (partial + buf.toString('utf8')).split(/\r?\n/);
    partial = lines.pop() ?? '';
    log.push(...lines);
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  running = { entry, cmd, child, log };
  let finished = false;
  const finish = (code: number | null, err?: Error) => {
    if (finished) return;
    finished = true;
    if (partial) log.push(partial);
    if (err) log.push(`Could not start: ${err.message}`);
    entry.exitCode = code;
    entry.finishedAt = new Date().toISOString();
    entry.status = code === 0 ? 'ok' : 'failed';
    entry.log = log.slice(-LOG_LINES);
    if (cmd.kind === 'scrape' && code === 0) entry.runId = listRuns(OUTPUT).find((r) => r.startedAt >= entry.startedAt)?.runId;
    if (cmd.kind === 'rescore') entry.runId = listRuns(OUTPUT)[0]?.runId;
    history.save();
    running = null;
    if (cmd.cost === 'paid' || cmd.id === 'tokens') void refreshApify();
    if (cmd.kind === 'scrape' && entry.runId && google.connected) void autoSync(entry);
  };
  child.on('error', (e) => finish(-1, e));
  child.on('close', (code) => finish(code));
  return entry;
}

/** After a scrape: save the run to Google Sheets and add its new jobs to the tracker. */
async function autoSync(entry: HistoryEntry) {
  const run = readRun(OUTPUT, entry.runId!);
  if (!run) return;
  try {
    await syncRun(run);
    entry.trackerAdded = await addRunToTracker(run);
    delete entry.sheetsError;
  } catch (e) {
    entry.sheetsError = (e as Error).message;
  }
  history.save();
}

const csvRows = (run: RunInfo, kind: 'new' | 'all') => {
  const f = run.files.find((x) => x.kind === kind);
  const label = `${runIdTime(run.runId)} · ${windowLabel(run.window)}`;
  return f ? parseCsv(readFileSync(f.path, 'utf8')).map((r) => ({ ...r, _run: label })) : [];
};

/** Creates (once) the spreadsheet for a run. Concurrent calls for the same run share one upload. */
function syncRun(run: RunInfo): Promise<RunSheet> {
  const pending = syncing.get(run.runId);
  if (pending) return pending;
  const p = google
    .runSheet(run.runId, sheetTitle(run), () => {
      const fresh = csvRows(run, 'new');
      const all = csvRows(run, 'all');
      return [
        { key: 'new', title: `New jobs (${fresh.length})`, rows: fresh },
        { key: 'all', title: `All jobs (${all.length})`, rows: all },
      ];
    })
    .finally(() => syncing.delete(run.runId));
  syncing.set(run.runId, p);
  return p;
}

const addRunToTracker = (run: RunInfo) => google.addToTracker(run.runId, csvRows(run, 'new'));

// ---------------------------------------------------------------- state for the page

function fileView(f: { kind: string; name: string; path: string; rows?: number }, runId?: string) {
  const sheet = runId ? google.state.runSheets[runId] : undefined;
  const csv = f.kind === 'new' || f.kind === 'all';
  return {
    ...f,
    sheetUrl: csv && sheet ? `${sheet.url}#gid=${sheet.gids[f.kind]}` : null,
    openUrl: csv && runId ? `/sheets/open?run=${encodeURIComponent(runId)}&tab=${f.kind}` : null,
  };
}

function state() {
  const today = localDay();
  const runs = listRuns(OUTPUT);
  const byId = new Map(runs.map((r) => [r.runId, r]));
  const items = history.combined(runs).map((e) => {
    const run = e.runId ? byId.get(e.runId) : undefined;
    const files = run ? run.files.map((f) => fileView(f, run.runId)) : [];
    if (e.command === 'rescore' && existsSync(MASTER)) files.unshift(fileView({ kind: 'master', name: 'master.csv', path: MASTER }));
    const { log: _log, ...rest } = e;
    return {
      ...rest,
      hasLog: e.log.length > 0,
      run: run && { runId: run.runId, window: run.window, sources: run.sources, durationSec: run.durationSec, totals: run.totals, costUsd: run.costUsd, errors: run.errors, sheetTitle: sheetTitle(run) },
      uploading: Boolean(run && syncing.has(run.runId)),
      files,
    };
  });
  return {
    today,
    apify,
    google: { configured: google.configured, connected: google.connected, email: google.state.email ?? null, trackerUrl: google.trackerUrl, folderName: config.sheets.folderName },
    running: running && { id: running.entry.id, command: running.cmd.id, label: running.cmd.label, startedAt: running.entry.startedAt, log: running.log.slice(-200) },
    commands: COMMANDS.map((c) => {
      const used = history.usedToday(c.id, today);
      return { id: c.id, label: c.label, description: c.description, cost: c.cost, kind: c.kind, usedToday: Boolean(used), usedAt: used?.startedAt ?? null };
    }),
    master: existsSync(MASTER) ? { name: 'master.csv', path: MASTER } : null,
    history: items,
  };
}

// ---------------------------------------------------------------- opening local files (only inside output/)

function openLocal(path: string, reveal: boolean) {
  const p = resolve(path);
  if (!p.startsWith(OUTPUT + sep) || !existsSync(p)) throw new HttpError(400, 'Only files inside the output folder can be opened.');
  const [bin, args] =
    process.platform === 'win32' ? ['explorer.exe', [reveal ? `/select,${p}` : p]] : process.platform === 'darwin' ? ['open', reveal ? ['-R', p] : [p]] : ['xdg-open', [reveal ? dirname(p) : p]];
  spawn(bin as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
}

function openBrowser(url: string) {
  const [bin, args] = process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(bin as string, args as string[], { detached: true, stdio: 'ignore' }).on('error', () => console.log(`Open ${url} in your browser.`)).unref();
}

// ---------------------------------------------------------------- HTTP

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const send = (res: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', ...extra });
  res.end(body);
};
const json = (res: ServerResponse, data: unknown, status = 200) => send(res, status, JSON.stringify(data));
const redirect = (res: ServerResponse, to: string) => send(res, 302, '', 'text/plain', { Location: to });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (res: ServerResponse, status: number, title: string, html: string) =>
  send(res, status, `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:15px system-ui;max-width:640px;margin:60px auto;padding:0 20px;line-height:1.5"><h2>${esc(title)}</h2>${html}<p><a href="/">← Back to Job Scraper</a></p>`, 'text/html; charset=utf-8');

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new HttpError(413, 'Request too large');
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  // Only this machine's browser, addressed by name: blocks DNS-rebinding and other websites.
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(res, 403, 'Forbidden', 'text/plain');
  const url = new URL(req.url ?? '/', BASE);
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if ((origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) || req.headers['x-job-scraper'] !== '1') return send(res, 403, 'Forbidden', 'text/plain');
  }

  if (req.method === 'GET' && url.pathname === '/') return send(res, 200, readFileSync(join(import.meta.dirname, 'ui.html'), 'utf8'), 'text/html; charset=utf-8');
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, state());
  if (req.method === 'GET' && url.pathname === '/api/log') {
    const id = url.searchParams.get('id');
    const e = running?.entry.id === id ? { log: running!.log } : history.entries.find((x) => x.id === id);
    return json(res, { log: e?.log ?? [] });
  }
  if (req.method === 'POST' && url.pathname === '/api/run') {
    const { command } = await readBody(req);
    return json(res, { entry: startCommand(String(command)) });
  }
  if (req.method === 'POST' && url.pathname === '/api/open') {
    const { path, reveal } = await readBody(req);
    openLocal(String(path), Boolean(reveal));
    return json(res, { ok: true });
  }

  // ---- Google
  if (req.method === 'GET' && url.pathname === '/google/connect') {
    if (!google.configured) return page(res, 400, 'Google Sheets is not set up yet', '<p>Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to <code>.env</code> (see <b>SETUP.md → Google Sheets</b>), then restart with <code>npm start</code>.</p>');
    const next = url.searchParams.get('next') ?? '/';
    return redirect(res, google.authUrl(REDIRECT_URI, next.startsWith('/') && !next.startsWith('//') ? next : '/'));
  }
  if (req.method === 'GET' && url.pathname === '/google/callback') {
    try {
      return redirect(res, await google.finishSignIn(url.searchParams));
    } catch (e) {
      return page(res, 400, 'Google sign-in failed', `<p>${esc((e as Error).message)}</p><p><a href="/google/connect">Try again</a></p>`);
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/google/disconnect') {
    await google.disconnect();
    return json(res, { ok: true });
  }
  if (req.method === 'GET' && (url.pathname === '/sheets/open' || url.pathname === '/sheets/tracker')) {
    if (!google.configured) return redirect(res, '/google/connect');
    if (!google.connected) return redirect(res, `/google/connect?next=${encodeURIComponent(url.pathname + url.search)}`);
    try {
      if (url.pathname === '/sheets/tracker') {
        const id = await google.ensureTracker();
        return redirect(res, `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`);
      }
      const runId = url.searchParams.get('run') ?? '';
      const run = /^[\w+-]+$/.test(runId) ? readRun(OUTPUT, runId) : null;
      if (!run) return page(res, 404, 'Run not found', '<p>That output folder no longer exists.</p>');
      const sheet = await syncRun(run);
      await addRunToTracker(run).catch(() => 0);
      const tab = url.searchParams.get('tab') === 'all' ? 'all' : 'new';
      return redirect(res, `${sheet.url}#gid=${sheet.gids[tab] ?? 0}`);
    } catch (e) {
      if (e instanceof GoogleAuthError) return redirect(res, `/google/connect?next=${encodeURIComponent(url.pathname + url.search)}`);
      return page(res, 502, 'Could not save to Google Sheets', `<p>${esc((e as Error).message)}</p>`);
    }
  }
  return send(res, 404, 'Not found', 'text/plain');
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!res.headersSent) json(res, { error: (e as Error).message }, e instanceof HttpError ? e.status : 500);
  });
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Job Scraper is already running at ${BASE} — opening it.`);
    if (!opts['no-open']) openBrowser(BASE);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nJob Scraper UI: ${BASE}`);
  console.log(`Google Sheets: ${google.connected ? `connected (${google.state.email ?? 'account'})` : google.configured ? 'not connected yet (click "Connect Google")' : 'not set up (see SETUP.md)'}`);
  console.log('Keep this window open while you use the page. Ctrl+C to stop.\n');
  void refreshApify();
  if (!opts['no-open']) openBrowser(BASE);
});

const shutdown = () => {
  if (running) {
    running.child.kill();
    running.entry.status = 'interrupted';
    running.entry.finishedAt = new Date().toISOString();
    running.entry.log = running.log.slice(-LOG_LINES);
    history.save();
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
