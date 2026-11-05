# Resources: finding remote jobs and clients as a full stack developer

**Central idea:** one place that brings together every online source of remote work for a full stack developer (job boards, freelance marketplaces, and businesses that need help) so you can find jobs, clients and projects in one feed.

This file collects resources for that idea: **where** the work is, **how** to win it, and tools and videos to learn from. Compiled November 2026. Star counts, fees and prices change, so check each site for current details.

---

## 1. Lists of remote job and freelance sites (the map of sources)

| Resource | What's in it |
|---|---|
| [awesome-remote-job](https://gittrend.io/repo/lukasz-madon/awesome-remote-job) ([details](https://awesome.ecosyste.ms/projects/github.com%2Flukasz-madon%2Fawesome-remote-job)) | The biggest list (about 45k GitHub stars): around 500 resources, including job boards, remote-first companies and guides. |
| [remote-working-list](https://awesome.ecosyste.ms/projects/github.com%2Fgeorgemandis%2Fremote-working-list) | 90+ remote job sites, many with **RSS feeds** that could be added straight into this scraper. |
| [joblist](https://awesome.ecosyste.ms/projects/github.com%2Frogerluan%2Fjoblist) | Sites for full-time remote and **freelance** work, plus lists of remote-friendly companies. |
| [TheRemoteFreelancer](https://awesome.ecosyste.ms/projects/github.com%2Fengineerapart%2FTheRemoteFreelancer) | Freelance and contract work for developers and designers. |
| [remote-freelance-jobs](https://awesome.ecosyste.ms/projects/github.com%2Fkaizensoze%2Fremote-freelance-jobs) | Remote freelance job sources. |
| [remote-jobs-list](https://awesome.ecosyste.ms/projects/github.com%2Foldmammuth%2Fremote-jobs-list) | Places to search for remote jobs. |
| [awesome-remote-working](https://awesome.ecosyste.ms/projects/github.com%2Fmkassm%2Fawesome-remote-working) | Remote-work websites and companies, internships and hackathons, with a Middle East focus. |
| [NoDesk: freelance](https://nodesk.co/remote-work/freelance/) | Guide to remote freelance sources. |

---

## 2. Freelance platforms for developers

| Platform | Best for |
|---|---|
| **Upwork** | The most clients. A good place to start building reviews. Hourly or fixed-price work. |
| **Contra** | 0% commission for freelancers. |
| **Arc** | Vetted remote developer jobs, between Upwork and Toptal. |
| **Toptal** | Premium and hard to get into ("top 3%"), with higher rates. |
| **Fiverr** | Selling fixed packages ("gigs"). Good for productized offers. |

Comparisons (several are written by the platforms themselves, so treat them as partly marketing):
- [Toptal vs Upwork vs Arc](https://arc.dev/employer-blog/toptal-vs-upwork-vs-arc/)
- [Contra alternatives](https://arc.dev/employer-blog/contra-alternatives/)
- [Best freelance websites for software developers](https://dataannotation.tech/developers/best-freelance-websites-for-software-developers)

---

## 3. Strategy: finding and winning businesses as clients

### Guides
- [The Developer Freelancing Playbook 2026](https://www.alexcloudstar.com/blog/freelancing-as-developer-guide-2026): landing clients, setting rates, building a lasting business.
- [How to become a freelance developer](https://rockstardeveloperuniversity.com/how-to-become-freelance-developer/): a long, complete guide.
- [Where to find freelance clients in 2026, beyond Upwork and Fiverr](https://dev.to/ottoaria/where-to-find-freelance-clients-in-2026-beyond-upwork-and-fiverr-4m77)
- [How I get freelance clients without Upwork or Fiverr](https://dev.to/armorbreak/how-i-get-freelance-clients-without-upwork-or-fiverr-1bmg)

### Pricing and packaging
- [Jonathan Stark: productized services course](https://jonathanstark.com/fps) (free). Sell fixed packages instead of hours, e.g. "MVP in 14 days" or "admin dashboard build".
- [Double Your Freelancing: fixed-bid pricing](https://doubleyourfreelancing.com/fixedbid/) (Brennan Dunn). Fixed-price projects and how to avoid scope creep.

### What these guides agree on
1. **Pick a niche.** "React storefronts for e-commerce brands" wins over plain "full stack developer".
2. **Sell outcomes and packages**, not hours.
3. **Look for businesses that need help now:** ones that just raised money, or that have a job opening they can't fill.
4. **Be helpful where clients ask questions:** Reddit, Discord, Slack communities, Stack Overflow, X/Twitter.
5. **Show proof of your work:** a portfolio, case studies, open-source projects.
6. **Ask for referrals** after your first clients. They become the main source of work.
7. **Use several channels** rather than depending on one platform.

---

## 4. Community channels with real work every month

- **Hacker News monthly threads**, posted on the first weekday of each month at news.ycombinator.com:
  - **"Who is hiring?"**: companies post jobs, many remote.
  - **"Who wants to be hired?"**: you post about yourself.
  - **"Freelancer? Seeking freelancer?"**: businesses look for freelancers. Start your post with `SEEKING WORK` and say your location and that you're available remotely.
  - More: [NoDesk: Hacker News for remote work](https://nodesk.co/remote-work/hacker-news/)
- Ready-made Apify scrapers for the HN threads: [HN Who Is Hiring](https://apify.com/bikram07/hn-who-is-hiring) · [HN Jobs Scraper](https://apify.com/antishock/hn-jobs-scraper) · [HN Who Is Hiring Jobs API](https://apify.com/NORESPI/hn-who-is-hiring)

---

## 5. Open-source tools similar to this project

### Job scrapers
| Tool | What it does |
|---|---|
| [JobSpy](https://gittrend.io/repo/speedyapply/JobSpy) ([code](https://github.com/macsymgit/JobSpy), [PyPI](https://pypi.org/project/python-jobspy/1.1.54)) | The best known (about 3.3k stars). A Python library that scrapes LinkedIn, Indeed, Glassdoor, ZipRecruiter and Google Jobs. Free, no Apify needed. No UI, scoring or tracker. |
| [JobCrawler](https://github.com/nikitaszvan/JobCrawler) | LinkedIn, Indeed, Glassdoor and Google in parallel. |
| [python-jobscrape](https://pypi.org/project/python-jobscrape/) | LinkedIn, Indeed, Glassdoor, ZipRecruiter, with proxy support. |
| [python-job-scraper](https://pypi.org/project/python-job-scraper/) | Adds Naukri and Upwork. Needs Python 3.13+. |

### Complete job-search apps
| Tool | What it does |
|---|---|
| [JobOps](https://github.com/Dakheera47/Job-Ops) | Self-hosted (Docker): finds and analyses jobs, tracks applications, includes remote boards. The closest overall to this project. |
| [JobSync](https://awesome.ecosyste.ms/projects/github.com%2FGsync%2Fjobsync) | MIT-licensed Next.js tracker with automatic job discovery and AI scoring. |
| [Job Hunt HQ](https://github.com/rembrandtreyes/jobhunt-hq) | A single small app that searches 179 companies' own job boards. |

### Auto-apply bots
**Caution:** LinkedIn's rules forbid bots, so your account can be restricted.
- [Auto_job_applier_linkedIn](https://github.com/GodsScion/Auto_job_applier_linkedIn): LinkedIn Easy Apply automation. Its README links a setup video.
- [AIHawk](https://awesome.ecosyste.ms/projects/github.com%2Ffeder-cr%2FAuto_Jobs_Applier_AIHawk): AI-powered LinkedIn auto-apply, maintained by the community. Guides: [getting started](https://aiindigo.com/tutorials/getting-started-with-aihawk-automate-job-applications-with-ai) · [walkthrough](https://ostechnix.com/automate-job-search-in-linkedin-with-ai-and-linkedin_aihawk/) · [an honest test](https://kelsiwest-binf.github.io/blog/How-Well-Will-LinkedIn-AIHawk-Work)
- [Job-apply-AI-agent](https://github.com/imon333/Job-apply-AI-agent): scrapes several boards, writes a custom CV and cover letter, applies.
- [More on GitHub: job-application-automation](https://github.com/topics/job-application-automation): includes tools that let you review each application before it's sent.

---

## 6. Videos

| Topic | Link |
|---|---|
| Apify for beginners: store, ready-made scrapers, credits, costs | [Learn Apify in Under 30 Minutes](https://www.youtube.com/watch?v=FHz48dx0Zgo) |
| Apify LinkedIn job scraping | [YouTube search](https://www.youtube.com/results?search_query=apify+linkedin+jobs+scraper+tutorial) |
| JobSpy | [YouTube search](https://www.youtube.com/results?search_query=jobspy+python+job+scraper) |
| Google Sheets API with Node.js | [YouTube search](https://www.youtube.com/results?search_query=google+sheets+api+node.js+tutorial) |
| Google OAuth setup (consent screen, client ID) | [YouTube search](https://www.youtube.com/results?search_query=google+cloud+oauth+consent+screen+client+id+tutorial) |
| GitHub Pages | [YouTube search](https://www.youtube.com/results?search_query=github+pages+tutorial+beginners) |
| Job application tracker in Google Sheets | [YouTube search](https://www.youtube.com/results?search_query=job+application+tracker+google+sheets) · [BetterSheets video](https://bettersheets.co/videos/job-application-tracker-template-from-thelandofrandom-sheet-improvement) |
| Finding freelance clients as a developer | [YouTube search](https://www.youtube.com/results?search_query=how+to+get+freelance+clients+as+a+web+developer) |
| Productized services | [YouTube search](https://www.youtube.com/results?search_query=productized+services+freelance+developer) |
| AIHawk / LinkedIn auto-apply setup | [YouTube search](https://www.youtube.com/results?search_query=aihawk+linkedin+auto+apply+setup) |

A YouTube search link always works and shows the newest videos. A single video link can go out of date.

---

## 7. Official documentation (for this project's technology)

| What | Link |
|---|---|
| Apify docs: platform, tokens, credits | https://docs.apify.com/platform |
| Apify Academy: free web-scraping course | https://docs.apify.com/academy |
| Apify blog: scrape LinkedIn jobs | https://blog.apify.com/scrape-linkedin-jobs/ |
| Apify blog: scrape LinkedIn with Python | https://blog.apify.com/scrape-linkedin-with-python/ |
| LinkedIn scraper tutorial 2026 | https://use-apify.com/blog/linkedin-scraper-tutorial-2026 |
| Google Sheets API | https://developers.google.com/sheets/api |
| Google sign-in for desktop apps (what this app uses) | https://developers.google.com/identity/protocols/oauth2/native-app |
| Google API user-data policy (what the privacy page follows) | https://developers.google.com/terms/api-services-user-data-policy |
| GitHub Pages | https://docs.github.com/en/pages |
| Node.js beginner guides | https://nodejs.org/en/learn |

Free job-tracker templates: [SpreadsheetClass](https://www.spreadsheetclass.com/?p=1460) · [Spreadsheet Daddy](https://spreadsheetdaddy.com/templates/job-application-tracker) · [Softr guide](https://softr.io/blog/job-application-tracker)

---

## 8. Next sources this project could add

This scraper covers **jobs** today: 9 job sites. Ideas for growing it toward **jobs + clients + businesses in one feed**:

1. **RSS feeds** from [remote-working-list](https://awesome.ecosyste.ms/projects/github.com%2Fgeorgemandis%2Fremote-working-list): the easiest addition, since the scraper already reads We Work Remotely's RSS.
2. The **HN "Freelancer? Seeking freelancer?"** thread: monthly freelance requests from businesses. It's free through the Algolia HN API, or through the Apify scrapers above.
3. **Upwork / Contra** project listings, for freelance gigs.
4. **Recently funded startups**, as leads for your own outreach. They're hiring and have budget.
5. **JobSpy** as a free alternative to the paid Apify sources. It's Python, so it would add a second language to the project.
