# Setting Up on Another Computer

This takes about 10 minutes. It works on Windows, macOS and Linux.

---

## 1. Install the requirements

| Tool | Version | Check | Get it |
|---|---|---|---|
| **Node.js** | **22.18 or newer** (24 LTS recommended) | `node -v` | https://nodejs.org (choose LTS) |
| npm | comes with Node | `npm -v` | — |
| Git | optional | `git --version` | https://git-scm.com |

Node 22.18+ runs TypeScript files directly, so there is no build step. Older Node versions fail with `Unknown file extension ".ts"`.

**Windows quick install:**
```powershell
winget install OpenJS.NodeJS.LTS
```
**macOS:** `brew install node`  **Ubuntu/Debian:** use https://github.com/nodesource/distributions, or `nvm install 24`.

Close and reopen your terminal after installing.

---

## 2. Copy the project

Copy the `job-scraper` folder to the new computer, **without** these:

| Leave out | Why |
|---|---|
| `node_modules/` | re-created by `npm install` |
| `.env` | holds your secret API token. Create it again by hand (step 4). |
| `output/`, `data/` | optional. Copy them only if you want to keep your job history (see step 7). |

**Option A: copy with robocopy (Windows)**, for example to a USB drive:
```powershell
robocopy F:\my-next-app\lab\job-scraper E:\job-scraper /E /XD node_modules output data /XF .env
```

**Option B: zip it.** Delete `node_modules` first, zip the folder, then unzip it on the other computer.

**Option C: Git.** `.gitignore` already leaves out `node_modules`, `.env`, `output` and `data`, so you can push the folder to a **private** repo and `git clone` it on the other computer.

The project doesn't depend on the Next.js app it's currently inside. It works in any folder, for example `C:\job-scraper` or `~/job-scraper`.

---

## 3. Install dependencies

Open a terminal in the project folder:
```bash
cd C:\job-scraper        # or wherever you put it
npm install
```
This only installs `typescript` and `@types/node`, which are used for type-checking. The scraper itself has no runtime dependencies.

---

## 4. Add your Apify token(s)

1. Get a token from https://console.apify.com → **Settings → API & Integrations → Personal API token**.
2. Create the `.env` file from the template:

   **Windows:** `copy .env.example .env`  **macOS/Linux:** `cp .env.example .env`

3. Open `.env` and set your token(s), separated by commas, with no spaces or quotes:
   ```
   APIFY_TOKENS=apify_api_xxxxxxxxxxxxxxxx
   ```
   If you have several accounts, they are used in order, and the scraper switches to the next one when one runs out:
   ```
   APIFY_TOKENS=apify_api_first,apify_api_second
   ```

Never commit `.env`, or send it by chat or email. If a token leaks, regenerate it in the Apify Console (the same page), which disables the old one.

---

## 5. Check that everything works

```bash
npm test            # unit tests: no network, no cost; all should pass
npm run tokens      # each token should say OK, with the credit left this month
npm run plan        # shows the searches and worst-case cost, without spending anything
```

Then try a free test run (the five free boards only, $0):
```bash
npm run scrape:7d -- --sources free --no-db
```
If it prints a summary and file paths, the setup is done.

---

## 6. Use it

**Web UI (recommended):** run `npm start`, or double-click `Start Job Scraper.cmd` on Windows. Your browser opens a page with one button per command, the output files, and the run history. For Google Sheets, see step 8.

**Terminal:**
```bash
npm run scrape:24h     # jobs from the last 24 hours (daily use)
npm run scrape:7d      # jobs from the last 7 days (after a break)
npm run scrape:24h -- --sources linkedin,indeed    # only some sources
```

The results go to `output/`. See `README.md` for what each file and column means. All settings (titles, countries, limits, filters) are in `config.ts`.

---

## 7. Keep your job history (optional)

`new_jobs.csv` is based on the jobs you've already seen. To carry that history over, copy these two items from the old computer into the same places on the new one:
```
data/jobs-db.json     the history (required for "new jobs" detection)
output/master.csv     every job found so far
```
Without them, the first run on the new computer treats every job as new.

Don't run the scraper on both computers at the same time with copied history. The two histories will drift apart.

---

## 8. Google Sheets (optional, for the web UI)

The web UI (`npm start`) can save every run to Google Sheets and keep a **Job Tracker** spreadsheet with a status dropdown. Google requires you to create your own free "OAuth client" once (about 10 minutes). The app asks only for the `drive.file` permission: **it can see and change only the files it created itself**, nothing else in your Drive.

1. Go to https://console.cloud.google.com and sign in with the Google account whose Drive should hold the sheets. Create a project (top bar → project picker → **New project**, name it e.g. `Job Scraper`) and select it.
2. **APIs & Services → Library**: search for and **Enable** both **Google Sheets API** and **Google Drive API**.
3. **Google Auth Platform** (older consoles: **OAuth consent screen**) → **Get started**: app name `Job Scraper`, your email as the support and contact email, audience **External**. Create.
   **Branding** needs public homepage and privacy-policy pages before Google lets you publish. They're in `docs/` (plus `docs/logo.png`, 120×120). Serve them with GitHub Pages: repo **Settings → Pages → Source: Deploy from a branch → `main` / `/docs` → Save**. Then fill in Branding:
   | Field | Value |
   |---|---|
   | Application home page | `https://muzairsaleem7.github.io/apify-job-scraper/` |
   | Application privacy policy link | `https://muzairsaleem7.github.io/apify-job-scraper/privacy.html` |
   | Application terms of service link | `https://muzairsaleem7.github.io/apify-job-scraper/terms.html` |
   | Authorized domains | `muzairsaleem7.github.io` |
   | App logo | **leave empty.** Uploading a logo makes Google require a full app verification before you can publish. `docs/logo.png` is there if you ever want it. |
4. **Audience**: click **Publish app** (status **In production**). This matters: while an app is in "Testing", Google signs you out after 7 days. No review is needed for this permission. (Alternatively leave it in Testing and add your Gmail under **Test users**, then reconnect weekly.)
5. **Clients** (or **Credentials → Create credentials → OAuth client ID**): application type **Desktop app**, name `Job Scraper UI`. Create, then copy the **Client ID** and **Client secret**.
6. Put them in `.env` (next to `APIFY_TOKENS`):
   ```
   GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
   ```
7. Restart `npm start`, click **Connect Google** at the top of the page, pick your account and allow access. If Google shows "Google hasn't verified this app", click **Advanced → Go to Job Scraper**: it's your own app.

After that, every scrape from the UI is saved to the Drive folder **Job Scraper** automatically, and its new jobs are added to **Job Tracker**. **Disconnect** at the top of the page signs out; the spreadsheets stay in your Drive. If you delete a spreadsheet, the app makes a new one the next time it's needed.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Unknown file extension ".ts"` or `SyntaxError` on `import type` | Node is too old. Install 22.18+ or 24 LTS and reopen the terminal. |
| `bad option: --env-file-if-exists` | Node is older than 22.9. Upgrade Node. |
| `No Apify token` | `.env` is missing or misnamed (it must be exactly `.env`, not `.env.txt`), or the variable isn't `APIFY_TOKENS`. On Windows, enable "File name extensions" in Explorer to check. |
| `token ... skipped (only $0.0x left this month)` | That account's free credit is used up. Add another token, or wait for the monthly reset. |
| `INVALID 401 user-or-token-not-found` | The token is wrong or was regenerated. Copy it again from the Apify Console. |
| `Estimate $X is above maxCostPerScrapeUsd` | Lower `limitPerSearch` or the number of locations in `config.ts`, or add `-- --force`. |
| One source shows `FAILED` | The other sources still save normally. See `output/<run>/errors.json`. Wellfound fails most often because of its bot protection. |
| A column is suddenly empty for one source | That Actor changed its output format. See `output/<run>/raw/<source>.json` and update the mapper in `src/sources.ts`. |
| Page says "Google Sheets: not set up" | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing from `.env`, or you didn't restart `npm start` after adding them. |
| "Google sign-in expired or was revoked" | Click **Connect Google** again. If it happens every 7 days, the app is still in Testing: publish it (step 8.4). |
| `Error 400: redirect_uri_mismatch` on Google's page | The OAuth client isn't the **Desktop app** type. Create a Desktop app client (step 8.5). |
| `Google API 403 ... has not been used in project` | Enable the Google Sheets API and the Google Drive API for that project (step 8.2), wait a minute, retry. |
| `npm start` says it's already running | The UI is open in another terminal; it just opens the browser. Port: `npm start -- --port 5000` or `UI_PORT` in `.env`. |
| A button is greyed out | It was already used today. It unlocks at local midnight. Failed runs don't lock it. |
| CSV shows strange characters in Excel | Open it with Data → From Text/CSV and choose UTF-8. The files already include a BOM, so this is rare. |

---

## Project layout

```
job-scraper/
  config.ts          all settings (titles, regions, limits, filters, prices)
  .env               your Apify token(s); create it yourself, never share it
  .env.example       template for .env
  src/
    cli.ts           commands: scrape, tokens, plan
    apify.ts         Apify API calls, token failover, real cost
    sources.ts       LinkedIn / Indeed / Glassdoor / Wellfound search setup and field mapping
    free-sources.ts  RemoteOK / Jobicy / We Work Remotely / Working Nomads / Arbeitnow
    text.ts          classifiers: workplace, remote scope, flags, tech, seniority, salary
    enrich.ts        turns a raw listing into a full CSV row
    filters.ts       title, stack, seniority, remote and date filters; de-duplication
    score.ts         the 0–100 fit score
    store.ts         CSV writing, job history, top-jobs list
    server.ts        web UI server (npm start)
    ui.html          the web page
    runs.ts          buttons, once-per-day locks, run history
    google.ts        Google Sheets export
    util.ts          helpers
  test/              unit tests (npm test)
  output/            results (created on the first run)
  data/              job history (created on the first run)
  README.md          how it works
  SETUP.md           this file
```
