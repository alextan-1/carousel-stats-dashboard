# Carousel Stats dashboard

One page for HumanPost analytics and the carousel version tags (`group.variant.MMDDYYYY`).
Runs on Cloudflare (free plan): a Worker serves the page and the API, D1 stores the data,
and a cron trigger pulls HumanPost every 30 minutes. HumanPost itself refreshes views about
once a day; post status changes show up faster.

## What's in it
- `public/` the dashboard (group tiles, share-of-views pie, median views at 2 days by version,
  versions table with group totals and "vs base", posts table with editable version, add-a-version form).
- `src/worker.js` API + scheduled pull. The HumanPost key is a Worker secret and never reaches the browser.
- `schema.sql` D1 tables.
- Counting rule: only active or archived accounts count; warming accounts are left out
  (tick "Include warming accounts" to see them).

## One-time setup (Cloudflare dashboard, about 10 minutes)
1. **Database:** Storage & Databases > D1 > Create, name it `carousel-stats`. Put its Database ID in
   `wrangler.toml` (`database_id`). The tables are created automatically on first use.
2. **Site:** Workers & Pages > Create > Import a repository > `carousel-stats-dashboard`. Keep the
   defaults (deploy command `npx wrangler deploy`). Every push to `main` redeploys.
3. **Secrets:** the Worker > Settings > Variables and Secrets > add as *Secret*:
   - `HUMANPOST_API_KEY`: the key from humanpost.env
   - `INGEST_TOKEN`: any long random string (the PC uses it to push tags)
4. **Team login:** Zero Trust > Access > Applications > Add (self-hosted) for the site's hostname,
   policy "Allow" for your team's emails. Add a second application for the path `/api/ingest` with
   policy "Bypass" (that path checks its own token).

(Command-line alternative: `npx wrangler login`, `npx wrangler d1 create carousel-stats`,
`npx wrangler secret put HUMANPOST_API_KEY`, `npx wrangler secret put INGEST_TOKEN`, `npm run deploy`.)

## Getting the tags in (and the stats, if Cloudflare can't reach HumanPost)
On the PC, add to `humanpost.env`:
```
DASHBOARD_URL=https://carousel-stats-dashboard.<you>.workers.dev
DASHBOARD_TOKEN=<the INGEST_TOKEN value>
```
`python toolkit/hp-versions.py push` sends the tag ledger (and the latest stats snapshot);
`python toolkit/hp-versions.py stats` now pulls and pushes in one go.
Tags changed on the website win over the PC's default `base` tag.

## Local preview
Put `INGEST_TOKEN=test` in `.dev.vars`, `npm run dev`, then push with
`DASHBOARD_URL=http://localhost:8787 DASHBOARD_TOKEN=test`.
