# Job Scraper: what it does and how to set it up

A free tool that finds **remote Full Stack developer jobs** on 9 job sites every day, keeps only the ones that fit you, ranks them best first, and puts them in a Google Sheet where you track your applications.

It runs on your own computer. You open a page in your browser and click a button.

---

## Part 1: Features in plain terms

### Finding jobs
- **Searches 9 job sites at once**
  - **Paid, through Apify:** LinkedIn, Indeed, Glassdoor, Wellfound. These cost a few cents per run.
  - **Free:** RemoteOK, Jobicy, We Work Remotely, Working Nomads, Arbeitnow.
- **Searches many countries:** the US, Canada, the UK, the EU, the UAE and Australia, remote jobs only.
- **Searches many job titles at once:** Full Stack, Frontend, Backend, React, Node.js, Software Engineer and more, all listed in `config.ts`.
- **Picks the time window:** jobs posted in the last 24 hours or the last 7 days.
- **Never pays twice for a job.** LinkedIn is told which jobs you already have, so it sends new ones instead.

### Keeping only the jobs that fit
It reads each job's full description and removes:
- jobs whose title isn't one of yours;
- junior jobs, internships and management roles;
- other kinds of work: QA, DevOps, security, data, mobile, games and so on;
- jobs built on a different language, such as a "Java Developer" job. A "Full Stack (Java/React)" job stays because it names your stack;
- jobs that are hybrid or on-site;
- jobs needing a security clearance;
- jobs older than the time window you chose.

The same job posted on several sites is merged into **one row**. All its links are kept.

### Ranking: a score from 0 to 100
Every job gets a score, and the best ones come first. The score goes up for:
- a Full Stack title, and your tech stack (React, Node, TypeScript…) in the title or text;
- fully remote, especially "work from anywhere";
- a senior or mid level;
- a salary shown, especially a good one;
- a named recruiter, few applicants, or a post from today.

It goes down for:
- hybrid or on-site;
- "US citizens only" or "no visa sponsorship";
- staffing agencies, part-time, a low salary, lots of applicants, or an old post.

The **"Why this score"** column lists every reason, e.g. `+10 full-stack title; +12 worldwide; -8 staffing agency`.

### Extra details it works out for each job
- **Remote type** and **where you must live:** Worldwide, US only, EU, UK and so on.
- **Salary** as posted, plus an **estimated yearly amount in US dollars**, so you can sort by pay.
- **Technologies** mentioned, and which of them match **your** stack.
- **Warnings:** clearance, citizenship, no sponsorship, contract, part-time, agency, time-zone overlap.
- **Seniority**, job type, applicant count, and the recruiter's name and profile link.

### Remembering what you've already seen
- It keeps a history of every job found.
- Each run shows **"new" jobs separately**, meaning ones you haven't seen before.
- A job that disappears and comes back after 45 days counts as new again.

### The web page (`npm start`)
- **One button per task:**
  - **Scrape last 24 hours** (the daily run)
  - **Scrape last 7 days** (after a break)
  - **Free boards only** ($0)
  - **Preview plan & cost**
  - **Check Apify credit**
  - **Re-score history**
- **Each button works once a day**, so you can't spend credit twice by accident. It unlocks at midnight. A failed run doesn't count.
- **Paid buttons ask "are you sure?"** and show the expected cost.
- **A six-step flow strip** shows where a run is: Pick → Search → Filter & score → Save → Google Sheets → Your turn.
- **A live progress bar,** e.g. "34 of 73 searches done".
- **A results summary:** jobs found → passed filters → unique → **new**. It also shows the cost and time, which sites the jobs came from, and why jobs were removed.
- **Your files,** with their location on your computer (click to copy) and buttons: **Google Sheets**, **Open file**, **Show in folder**.
- **The full history** of every run, including the complete output.
- The **Apify credit left** and your **Google connection** are always shown at the top.

### Google Sheets
- Every run is saved as a spreadsheet in a **"Job Scraper"** folder in your Google Drive, named like `Jobs 2026-11-06 09:30 · Last 24 hours · All sources · 42 new`. It has two tabs: **New jobs** and **All jobs**.
- **Job Tracker:** one spreadsheet that collects every new job from every run.
  - Each job appears only once, and your edits are never overwritten.
  - **Status dropdown:** New, Interested, Applied, Recruiter contacted, Interviewing, Offer, Rejected, Not interested, Closed / expired. Each has its own colour.
  - **Applied on** and **Follow-up on** date pickers. The follow-up cell turns **orange** when the date arrives.
  - A **Notes** column.
  - Clickable **Open ↗ / Apply ↗ / Profile ↗** links.
  - Filter buttons on every column, with the header and title columns frozen.
- **Privacy:** the app can only see the files it created, nothing else in your Drive.

### Files on your computer
Each run gets a folder, e.g. `output/2026-11-06_0930_24h_all/`, containing:
- `…_new-jobs.csv`: **start here**. Only the new jobs, best first. Opens in Excel or Sheets.
- `…_all-jobs.csv`: every matching job from that run.
- `…_top-jobs.md`: the top 30 as an easy-to-read list.

`output/master.csv` holds every job ever found.

### Money and safety
- A daily 24-hour run costs about **$0.30–0.40**. Apify's free plan gives **$5 a month**.
- **Hard spending limits:** each scrape is refused if its worst-case cost is too high, and each search has its own cap and time limit.
- **Several Apify keys:** list them in `.env` separated by commas. When one runs out of credit, it **switches to the next automatically**, with no limit on how many keys. Only use accounts you genuinely own.
- If one site fails, the others are still saved.
- **The page works only on your computer.** Other websites and other devices can't use it.
- Your keys stay in `.env` on your PC and are never uploaded.

### Changing what it looks for
Everything is in **`config.ts`**:
- job titles and words to exclude;
- your tech stack and your minimum salary;
- countries, and how many results per search;
- which sites are on or off;
- the status list for the Google Sheet.

After editing it, click **Re-score history** to re-rank the jobs you already have, at no cost.

---

## Part 2: Setup, step by step

About 30 minutes the first time. Works on Windows, macOS and Linux; the examples are for Windows.

### Step 1: Install Node.js
1. Go to https://nodejs.org and download the **LTS** version. It must be 22.18 or newer.
2. Install it and keep the default options.
3. Close and reopen any terminal or Command Prompt windows.
4. Check it: open **Command Prompt** and type `node -v`. It should print v22.18 or higher.

### Step 2: Get the code
**Option A: download a ZIP (easiest)**
1. Open https://github.com/muzairsaleem7/apify-job-scraper.
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip it somewhere simple, e.g. `C:\job-scraper`.

**Option B: with Git**
```
git clone https://github.com/muzairsaleem7/apify-job-scraper.git C:\job-scraper
```

### Step 3: Install
Open Command Prompt in the folder and run:
```
cd C:\job-scraper
npm install
```

### Step 4: Get an Apify key (for LinkedIn, Indeed, Glassdoor, Wellfound)
1. Sign up free at https://apify.com. The free plan gives $5 of credit every month.
2. In the Apify Console, go to **Settings → API & Integrations** and copy your **Personal API token**.
3. In the project folder, copy `.env.example` and name the copy `.env`:
   ```
   copy .env.example .env
   ```
4. Open `.env` in Notepad and put your token after `APIFY_TOKENS=`, with no spaces or quotes:
   ```
   APIFY_TOKENS=apify_api_xxxxxxxxxxxxxxxx
   ```

You can skip this step and use only the **Free boards** button.

### Step 5: First start
1. Double-click **`Start Job Scraper.cmd`**, or run `npm start`.
2. Your browser opens the Job Scraper page. Keep the black terminal window open while you use it.
3. At the top you should see **Apify credit: $… left this month**.
4. Click **Preview plan & cost**. It costs nothing, and it confirms everything works.

The app already works at this point: scrapes save CSV files on your computer. Steps 6–8 add Google Sheets.

### Step 6: Create your Google "app" (once, about 10 minutes)
Google requires every app that writes to your Drive to have its own free registration. Everyone sets up their own.

1. Go to https://console.cloud.google.com/projectcreate, name the project `Job Scraper`, and click **Create**. Make sure it's selected in the top bar.
2. Turn on two services. Open each link and click **Enable**:
   - https://console.cloud.google.com/apis/library/sheets.googleapis.com
   - https://console.cloud.google.com/apis/library/drive.googleapis.com
3. Go to https://console.cloud.google.com/auth/overview and click **Get started**.
   - App name: `Job Scraper`.
   - Support email and contact email: yours.
   - Audience: **External**.
   - Click **Create**.
4. Go to **Audience → Test users → + Add users**, add **your own Gmail address**, and click **Save**.
5. Go to **Clients → + Create client**.
   - Application type: **Desktop app**. This exact type matters.
   - Name: `Job Scraper UI`, then **Create**.
   - Copy the **Client ID** and **Client secret**.

**Optional: stop the weekly sign-out.** In "Testing" mode, Google signs you out after 7 days and you click Connect again. To avoid that, publish the app: **Audience → Publish app**. Google only allows this once the Branding page has a public homepage and privacy-policy link.
- This repo includes ready-made pages in `docs/`. Put them online free with GitHub Pages: in your own copy of the repo, go to **Settings → Pages**, choose branch `main`, folder `/docs`.
- Put those links in Branding.
- **Don't upload a logo.** That forces a long Google review.

### Step 7: Add the Google keys
Open `.env` again and add two lines:
```
GOOGLE_CLIENT_ID=1234567890-xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
```
Save it, close the Job Scraper window, and start it again.

### Step 8: Connect Google
1. On the page, click **Connect Google** at the top.
2. Pick your account.
3. If you see "Google hasn't verified this app", click **Advanced → Go to Job Scraper**. It's your own app.
4. Make sure the **Google Drive** box is ticked, then click **Continue**.
5. The top of the page now shows your email and a **Job Tracker ↗** link.

---

## Part 3: Daily use

1. Double-click **`Start Job Scraper.cmd`**.
2. Click **Scrape last 24 hours**. After a few days off, use **Scrape last 7 days** instead.
3. Watch the progress bar. It takes about 4 minutes.
4. When it finishes, click **Open the new jobs in Google Sheets**, or **Open Job Tracker**.
5. In the **Job Tracker**, change each job's **Status** as you go, add **Applied on** and **Follow-up on** dates, and write notes.
6. Tomorrow, do it again. Only new jobs are added to the tracker.

**Saving money:** on days you don't want to spend Apify credit, use **Free boards, last 7 days** ($0).

---

## Part 4: If something goes wrong

| What you see | What to do |
|---|---|
| `node` is not recognised, or "Unknown file extension .ts" | Install Node.js 22.18 or newer (step 1), then reopen the window. |
| Apify credit shows "no token in .env" | The file must be named exactly `.env`, not `.env.txt`, and contain `APIFY_TOKENS=...`. |
| A button is greyed out | It was already used today. It unlocks at midnight. |
| "Google Sheets: not set up" | The Google keys are missing from `.env`, or you didn't restart after adding them. |
| `redirect_uri_mismatch` on Google's page | The Google client must be the **Desktop app** type (step 6.5). |
| "Access blocked" or "not a test user" on Google's page | Add your Gmail under **Audience → Test users** (step 6.4). |
| "Google sign-in expired" | Click **Connect Google** again. This happens weekly while the app is in Testing mode. |
| One site shows FAILED | Normal now and then; the other sites are still saved. Wellfound fails most often. |
| The page says "Lost connection" | The black terminal window was closed. Start it again. |

More detail: `README.md` explains how everything works, and `SETUP.md` covers technical setup and moving to another computer.
