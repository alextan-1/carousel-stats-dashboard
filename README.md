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

## One-time setup (about 15 minutes)
1. `npm install`, then `npx wrangler login` (opens Cloudflare in the browser).
2. `npx wrangler d1 create carousel-stats` and paste the printed `database_id` into `wrangler.toml`.
3. `npm run db:init` (creates the tables).
4. Secrets:
   - `npx wrangler secret put HUMANPOST_API_KEY` (the key in humanpost.env)
   - `npx wrangler secret put INGEST_TOKEN` (any long random string)
5. `npm run deploy`. Wrangler prints the site URL (`https://carousel-stats-dashboard.<you>.workers.dev`).
6. Team login: Cloudflare dashboard > Zero Trust > Access > Applications > Add (self-hosted) for that
   hostname, policy "Allow" for your team's emails. Add a second application for the path
   `/api/ingest` with policy "Bypass" (that path checks its own token).

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
`npm run db:init:local`, put `INGEST_TOKEN=test` in `.dev.vars`, `npm run dev`, then push with
`DASHBOARD_URL=http://localhost:8787 DASHBOARD_TOKEN=test`.
