import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeJson } from './store.ts';
import type { Config } from './types.ts';

/**
 * Google Sheets export for the web UI. Plain fetch, no SDK.
 * Sign-in: OAuth "Desktop app" client + PKCE + loopback redirect (http://127.0.0.1:<port>/google/callback).
 * Scope drive.file: the app can only see and change files it created itself, nothing else in your Drive.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SCOPES = ['openid', 'email', DRIVE_SCOPE];

export class GoogleError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
/** Not signed in, or the sign-in expired / was revoked. The UI shows "Connect Google" again. */
export class GoogleAuthError extends GoogleError {}

// ---------------------------------------------------------------- sheet layout (pure; unit-tested)

type Kind = 'text' | 'number' | 'link' | 'status' | 'date';
export interface SheetColumn {
  header: string;
  /** CSV column to read; none = a column you fill in yourself. `_run` = the run's name. */
  key?: string;
  kind: Kind;
  width: number;
  linkText?: string;
}

/** Same layout for run sheets and the tracker. Your own columns (Status, Applied on, Follow-up on, Notes) are near the front. */
export const SHEET_COLUMNS: SheetColumn[] = [
  { header: 'Status', kind: 'status', width: 150 },
  { header: 'Score', key: 'score', kind: 'number', width: 60 },
  { header: 'Title', key: 'title', kind: 'text', width: 300 },
  { header: 'Company', key: 'company', kind: 'text', width: 170 },
  { header: 'Job post', key: 'job_url', kind: 'link', width: 80, linkText: 'Open ↗' },
  { header: 'Apply', key: 'apply_url', kind: 'link', width: 70, linkText: 'Apply ↗' },
  { header: 'Applied on', kind: 'date', width: 100 },
  { header: 'Follow-up on', kind: 'date', width: 100 },
  { header: 'Notes', kind: 'text', width: 240 },
  { header: 'Remote', key: 'remote', kind: 'text', width: 110 },
  { header: 'Must live in', key: 'remote_scope', kind: 'text', width: 110 },
  { header: 'Salary', key: 'salary', kind: 'text', width: 150 },
  { header: '≈ USD / year', key: 'salary_usd_year_est', kind: 'number', width: 95 },
  { header: 'Posted', key: 'posted_date', kind: 'text', width: 95 },
  { header: 'Seniority', key: 'seniority', kind: 'text', width: 90 },
  { header: 'Stack match', key: 'stack_match', kind: 'text', width: 220 },
  { header: 'Flags', key: 'flags', kind: 'text', width: 140 },
  { header: 'Recruiter', key: 'recruiter_name', kind: 'text', width: 140 },
  { header: 'Recruiter profile', key: 'recruiter_url', kind: 'link', width: 90, linkText: 'Profile ↗' },
  { header: 'Company page', key: 'company_url', kind: 'link', width: 90, linkText: 'Company ↗' },
  { header: 'Source', key: 'source', kind: 'text', width: 90 },
  { header: 'Also on', key: 'also_found_on', kind: 'text', width: 110 },
  { header: 'Location', key: 'location', kind: 'text', width: 160 },
  { header: 'Type', key: 'employment_type', kind: 'text', width: 90 },
  { header: 'Applicants', key: 'applicants', kind: 'text', width: 90 },
  { header: 'Tech', key: 'tech', kind: 'text', width: 220 },
  { header: 'Why this score', key: 'score_reasons', kind: 'text', width: 300 },
  { header: 'Description', key: 'description', kind: 'text', width: 400 },
  { header: 'First seen', key: 'first_seen', kind: 'text', width: 95 },
  { header: 'Found in run', key: '_run', kind: 'text', width: 220 },
  { header: 'Job key', key: 'job_key', kind: 'text', width: 200 },
];
export const KEY_HEADER = 'Job key';
const FROZEN_COLUMNS = 3;
const CELL_FIELDS = 'userEnteredValue,userEnteredFormat.textFormat,userEnteredFormat.backgroundColor';

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
};

/** 0 -> A, 25 -> Z, 26 -> AA */
export function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const colIndex = (header: string) => SHEET_COLUMNS.findIndex((c) => c.header === header);

/**
 * One cell. Scraped text always goes in as a plain string value (never a formula), so a title like "=HYPERLINK(...)"
 * can't run anything. Links are real hyperlinks with short text.
 */
export function cellFor(col: SheetColumn, row: Record<string, string>, defaultStatus: string): object {
  if (col.kind === 'status') return { userEnteredValue: { stringValue: defaultStatus } };
  const v = col.key ? (row[col.key] ?? '').trim() : '';
  if (!v) return {};
  if (col.kind === 'number' && Number.isFinite(Number(v))) return { userEnteredValue: { numberValue: Number(v) } };
  if (col.kind === 'link' && /^https?:\/\//i.test(v))
    return { userEnteredValue: { stringValue: col.linkText ?? v }, userEnteredFormat: { textFormat: { link: { uri: v }, underline: true, foregroundColor: rgb('#1a73e8') } } };
  return { userEnteredValue: { stringValue: v } };
}

export const headerRow = () => ({
  values: SHEET_COLUMNS.map((c) => ({ userEnteredValue: { stringValue: c.header }, userEnteredFormat: { textFormat: { bold: true, foregroundColor: rgb('#ffffff') }, backgroundColor: rgb('#3c4043') } })),
});

export const dataRows = (rows: Record<string, string>[], defaultStatus: string) => rows.map((r) => ({ values: SHEET_COLUMNS.map((c) => cellFor(c, r, defaultStatus)) }));

const columnRange = (sheetId: number, i: number) => ({ sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 });

/** Status dropdown + date pickers. Re-sent after every append because validation is stored per cell. */
export function validationRequests(sheetId: number, statuses: { name: string }[]): object[] {
  const dates = SHEET_COLUMNS.flatMap((c, i) => (c.kind === 'date' ? [i] : []));
  return [
    { setDataValidation: { range: columnRange(sheetId, colIndex('Status')), rule: { condition: { type: 'ONE_OF_LIST', values: statuses.map((s) => ({ userEnteredValue: s.name })) }, strict: true, showCustomUi: true } } },
    ...dates.map((i) => ({ setDataValidation: { range: columnRange(sheetId, i), rule: { condition: { type: 'DATE_IS_VALID' }, strict: true, inputMessage: 'Double-click to pick a date' } } })),
  ];
}

/** Everything except the cell values: widths, wrapping, date format, dropdowns, colours, filter. */
export function formatRequests(sheetId: number, statuses: { name: string; color: string }[]): object[] {
  const status = colIndex('Status');
  const followUp = colIndex('Follow-up on');
  const score = colIndex('Score');
  const L = columnLetter(followUp);
  const rules: object[] = [
    ...statuses.map((s) => ({ ranges: [columnRange(sheetId, status)], booleanRule: { condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: s.name }] }, format: { backgroundColor: rgb(s.color) } } })),
    // follow-up date reached: orange
    { ranges: [columnRange(sheetId, followUp)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=AND(ISNUMBER(${L}2),${L}2<=TODAY())` }] }, format: { backgroundColor: rgb('#fbbc04'), textFormat: { bold: true } } } },
    // score: white (40) -> green (100)
    { ranges: [columnRange(sheetId, score)], gradientRule: { minpoint: { type: 'NUMBER', value: '40', color: rgb('#ffffff') }, maxpoint: { type: 'NUMBER', value: '100', color: rgb('#57bb8a') } } },
  ];
  return [
    { repeatCell: { range: { sheetId }, cell: { userEnteredFormat: { wrapStrategy: 'CLIP', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment' } },
    ...SHEET_COLUMNS.flatMap((c, i) => (c.kind === 'date' ? [{ repeatCell: { range: columnRange(sheetId, i), cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } }] : [])),
    ...SHEET_COLUMNS.map((c, i) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: c.width }, fields: 'pixelSize' } })),
    ...validationRequests(sheetId, statuses),
    ...rules.map((rule, index) => ({ addConditionalFormatRule: { index, rule } })),
    { setBasicFilter: { filter: { range: { sheetId } } } },
  ];
}

export const sheetUrl = (id: string, gid?: number) => `https://docs.google.com/spreadsheets/d/${id}/edit${gid === undefined ? '' : `#gid=${gid}`}`;

// ---------------------------------------------------------------- client

export interface RunSheet {
  id: string;
  url: string;
  /** tab key ('new' | 'all') -> sheet gid */
  gids: Record<string, number>;
}

interface GoogleState {
  refreshToken?: string;
  email?: string;
  folderId?: string;
  trackerId?: string;
  runSheets: Record<string, RunSheet>;
  /** Runs whose new jobs were already added to the tracker (so a job you deleted there isn't re-added). */
  trackerRuns: Record<string, string>;
}

export interface SheetTab {
  key: string;
  title: string;
  rows: Record<string, string>[];
}

export class GoogleClient {
  statePath: string;
  clientId: string;
  clientSecret: string;
  sheets: Config['sheets'];
  state: GoogleState;
  private access?: { token: string; expires: number };
  private pending = new Map<string, { verifier: string; redirectUri: string; next: string; at: number }>();

  constructor(statePath: string, clientId: string | undefined, clientSecret: string | undefined, sheets: Config['sheets']) {
    this.statePath = statePath;
    this.clientId = clientId?.trim() ?? '';
    this.clientSecret = clientSecret?.trim() ?? '';
    this.sheets = sheets;
    this.state = { runSheets: {}, trackerRuns: {} };
    if (existsSync(statePath)) {
      try {
        this.state = { ...this.state, ...JSON.parse(readFileSync(statePath, 'utf8')) };
      } catch {
        /* start over */
      }
    }
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }
  get connected() {
    return this.configured && Boolean(this.state.refreshToken);
  }
  get trackerUrl() {
    return this.state.trackerId ? sheetUrl(this.state.trackerId, 0) : null;
  }

  private save() {
    writeJson(this.statePath, this.state);
  }

  // ---- sign-in

  authUrl(redirectUri: string, next = '/'): string {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('hex');
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > 15 * 60_000) this.pending.delete(k);
    this.pending.set(state, { verifier, redirectUri, next, at: now });
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${q}`;
  }

  /** Handles /google/callback. Returns where to send the browser next. */
  async finishSignIn(params: URLSearchParams): Promise<string> {
    if (params.get('error')) throw new GoogleAuthError(400, `Google sign-in was cancelled (${params.get('error')}).`);
    const p = this.pending.get(params.get('state') ?? '');
    if (!p) throw new GoogleAuthError(400, 'Sign-in link expired. Click "Connect Google" again.');
    this.pending.delete(params.get('state')!);
    const tok = await this.tokenRequest({ grant_type: 'authorization_code', code: params.get('code') ?? '', redirect_uri: p.redirectUri, code_verifier: p.verifier });
    if (!String(tok.scope ?? '').split(' ').includes(DRIVE_SCOPE))
      throw new GoogleAuthError(403, 'Google Drive access was not granted. Connect again and tick the box "See, edit, create and delete only the specific Google Drive files you use with this app".');
    if (!tok.refresh_token) throw new GoogleAuthError(400, 'Google did not return a refresh token. Connect again.');
    const email = emailFromIdToken(tok.id_token);
    if (this.state.email && email && email !== this.state.email) this.state = { runSheets: {}, trackerRuns: {} }; // different account: its files aren't visible
    this.state.refreshToken = tok.refresh_token;
    this.state.email = email;
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in ?? 3600) * 1000 };
    this.save();
    return p.next;
  }

  async disconnect() {
    const t = this.state.refreshToken;
    delete this.state.refreshToken;
    this.access = undefined;
    this.save();
    if (t) await fetch(`${REVOKE_URL}?token=${encodeURIComponent(t)}`, { method: 'POST' }).catch(() => {});
  }

  private async tokenRequest(fields: Record<string, string>): Promise<any> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...fields }),
      signal: AbortSignal.timeout(30_000),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.error === 'invalid_grant' && fields.grant_type === 'refresh_token') {
        delete this.state.refreshToken;
        this.save();
        throw new GoogleAuthError(401, 'Google sign-in expired or was revoked. Click "Connect Google" again.');
      }
      throw new GoogleAuthError(res.status, `Google sign-in failed: ${body.error_description || body.error || res.status}`);
    }
    return body;
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expires > Date.now() + 60_000) return this.access.token;
    if (!this.connected) throw new GoogleAuthError(401, 'Not connected to Google.');
    const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.state.refreshToken! });
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in ?? 3600) * 1000 };
    return this.access.token;
  }

  async api<T = any>(method: string, url: string, body?: unknown, retry = true): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 401 && retry) {
      this.access = undefined;
      return this.api(method, url, body, false);
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new GoogleError(res.status, `Google API ${res.status}: ${json?.error?.message ?? text.slice(0, 200)}`);
    return json as T;
  }

  // ---- Drive

  /** false if the file was deleted, trashed, or belongs to another account. */
  async fileAlive(id: string): Promise<boolean> {
    try {
      const f = await this.api('GET', `${DRIVE}/${id}?fields=id,trashed`);
      return !f.trashed;
    } catch (e) {
      if (e instanceof GoogleError && (e.status === 404 || e.status === 403)) return false;
      throw e;
    }
  }

  async ensureFolder(): Promise<string> {
    if (this.state.folderId && (await this.fileAlive(this.state.folderId))) return this.state.folderId;
    const f = await this.api('POST', `${DRIVE}?fields=id`, { name: this.sheets.folderName, mimeType: 'application/vnd.google-apps.folder' });
    this.state.folderId = f.id;
    this.save();
    return f.id;
  }

  private async moveToFolder(fileId: string) {
    const folder = await this.ensureFolder();
    const f = await this.api('GET', `${DRIVE}/${fileId}?fields=parents`);
    const remove = (f.parents ?? []).filter((p: string) => p !== folder).join(',');
    await this.api('PATCH', `${DRIVE}/${fileId}?addParents=${folder}${remove ? `&removeParents=${remove}` : ''}&fields=id`, {});
  }

  // ---- Sheets

  private async createSpreadsheet(title: string, tabs: SheetTab[], minRows = 0): Promise<RunSheet> {
    const ss = await this.api('POST', `${SHEETS}?fields=spreadsheetId`, {
      properties: { title },
      sheets: tabs.map((t, i) => ({
        properties: { sheetId: i, title: t.title, gridProperties: { rowCount: Math.max(t.rows.length + 1, minRows, 2), columnCount: SHEET_COLUMNS.length, frozenRowCount: 1, frozenColumnCount: FROZEN_COLUMNS } },
      })),
    });
    const id: string = ss.spreadsheetId;
    const defaultStatus = this.sheets.statuses[0]?.name ?? 'New';
    await this.api('POST', `${SHEETS}/${id}:batchUpdate`, {
      requests: tabs.flatMap((t, i) => [
        { updateCells: { start: { sheetId: i, rowIndex: 0, columnIndex: 0 }, rows: [headerRow(), ...dataRows(t.rows, defaultStatus)], fields: CELL_FIELDS } },
        ...formatRequests(i, this.sheets.statuses),
      ]),
    });
    await this.moveToFolder(id);
    return { id, url: sheetUrl(id), gids: Object.fromEntries(tabs.map((t, i) => [t.key, i])) };
  }

  /** The spreadsheet for one run (created once; reused while it exists). */
  async runSheet(runId: string, title: string, tabs: () => SheetTab[]): Promise<RunSheet> {
    const known = this.state.runSheets[runId];
    if (known && (await this.fileAlive(known.id))) return known;
    const sheet = await this.createSpreadsheet(title, tabs());
    this.state.runSheets[runId] = sheet;
    this.save();
    return sheet;
  }

  async ensureTracker(): Promise<string> {
    if (this.state.trackerId && (await this.fileAlive(this.state.trackerId))) return this.state.trackerId;
    const sheet = await this.createSpreadsheet(this.sheets.trackerName, [{ key: 'tracker', title: 'Tracker', rows: [] }], 1000);
    this.state.trackerId = sheet.id;
    this.state.trackerRuns = {};
    this.save();
    return sheet.id;
  }

  /** Adds a run's new jobs to the tracker, once per run, skipping jobs already in it. Never touches existing rows. */
  async addToTracker(runId: string, rows: Record<string, string>[]): Promise<number> {
    const id = await this.ensureTracker();
    if (this.state.trackerRuns[runId]) return 0;
    const meta = await this.api('GET', `${SHEETS}/${id}?fields=sheets.properties(sheetId,title)`);
    const props = (meta.sheets ?? []).map((s: any) => s.properties).find((p: any) => p.sheetId === 0) ?? meta.sheets?.[0]?.properties;
    const name = `'${String(props.title).replace(/'/g, "''")}'`;
    const header: string[] = (await this.api('GET', `${SHEETS}/${id}/values/${encodeURIComponent(`${name}!1:1`)}`)).values?.[0] ?? [];
    const k = header.indexOf(KEY_HEADER);
    const known = new Set<string>();
    if (k >= 0) {
      const L = columnLetter(k);
      const col = await this.api('GET', `${SHEETS}/${id}/values/${encodeURIComponent(`${name}!${L}2:${L}`)}?majorDimension=COLUMNS`);
      for (const v of col.values?.[0] ?? []) known.add(String(v));
    }
    const fresh = rows.filter((r) => r.job_key && !known.has(r.job_key) && (known.add(r.job_key), true));
    if (fresh.length) {
      await this.api('POST', `${SHEETS}/${id}:batchUpdate`, {
        requests: [{ appendCells: { sheetId: props.sheetId, rows: dataRows(fresh, this.sheets.statuses[0]?.name ?? 'New'), fields: CELL_FIELDS } }, ...validationRequests(props.sheetId, this.sheets.statuses)],
      });
    }
    this.state.trackerRuns[runId] = new Date().toISOString();
    this.save();
    return fresh.length;
  }
}

function emailFromIdToken(idToken: unknown): string | undefined {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email;
  } catch {
    return undefined;
  }
}
