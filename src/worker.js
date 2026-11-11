// Carousel stats dashboard: HumanPost analytics + version tags in one place.
// - Cron (every 30 min) pulls account status + per-post analytics from HumanPost into D1.
// - /api/data feeds the dashboard; /api/versions + /api/posts/:id let the team edit tags.
// - /api/ingest (Bearer INGEST_TOKEN) lets the PC push the tag ledger (versions.json) and,
//   if Cloudflare can't reach HumanPost, the analytics snapshots too.
// The HumanPost key lives only in the HUMANPOST_API_KEY secret; it is never sent to the browser.

const API = "https://us-central1-clickbaitcarousel.cloudfunctions.net/publishingApi/v2";
const GROUPS = { mom: "moms", vet: "vets", truck: "truckers", stream: "streamers" };
const TAG_RE = /^(moms|vets|truckers|streamers)\.[a-z0-9-]+\.\d{8}$/;
const PER_RUN = 40; // Workers free plan allows 50 outbound requests per run

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const splitTag = (tag) => {
  const i = tag.lastIndexOf(".");
  return { grp: tag.split(".")[0], name: tag.slice(0, i), vdate: tag.slice(i + 1) };
};

// keepWhat: a PC push never overwrites a description someone edited on the site
async function upsertVersion(env, tag, what = "", keepWhat = false) {
  const v = splitTag(tag);
  const set = keepWhat ? "CASE WHEN versions.what = '' THEN ?5 ELSE versions.what END" : "CASE WHEN ?5 <> '' THEN ?5 ELSE versions.what END";
  await env.DB.prepare(
    `INSERT INTO versions (tag, grp, name, vdate, what) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(tag) DO UPDATE SET what = ${set}`
  ).bind(tag, v.grp, v.name, v.vdate, what).run();
}

const iso = (x) => {
  if (x == null || x === "") return null;
  if (typeof x === "number") return new Date(x > 1e11 ? x : x * 1000).toISOString();
  const d = new Date(x);
  return isNaN(d) ? null : d.toISOString();
};

// views at ~2 days: the daily reading closest to 48h after publishing, within 36-72h
function views2d(publishedAt, history) {
  if (!publishedAt) return [null, null];
  const pub = Date.parse(publishedAt);
  let best = null;
  for (const h of history) {
    const age = (Date.parse(h.collected_at) - pub) / 3.6e6;
    if (age >= 36 && age <= 72 && h.views != null && (!best || Math.abs(age - 48) < Math.abs(best[1] - 48))) best = [h.views, age];
  }
  return best ? [best[0], Math.round(best[1])] : [null, null];
}

// Store one analytics response ({summary, history[]}) for a post.
async function storeAnalytics(env, postId, body, now) {
  const s = body && typeof body.summary === "object" && body.summary ? body.summary : null;
  const hist = Array.isArray(body?.history) ? body.history : [];
  const stmts = hist
    .filter((h) => h.collectedAt)
    .map((h) =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO history (post_id, collected_at, views, likes, saves, shares, comments) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
      ).bind(postId, iso(h.collectedAt), h.views ?? null, h.likes ?? null, h.saves ?? null, h.shares ?? null, h.comments ?? null)
    );
  if (stmts.length) await env.DB.batch(stmts);
  if (!s) {
    await env.DB.prepare("UPDATE posts SET last_pulled = ?2, pull_error = NULL WHERE post_id = ?1").bind(postId, now).run();
    return;
  }
  const published = iso(s.publishedAt);
  const all = (await env.DB.prepare("SELECT collected_at, views FROM history WHERE post_id = ?1").bind(postId).all()).results;
  const [v2, v2age] = views2d(published, all);
  await env.DB.prepare(
    `UPDATE posts SET url = ?2, published_at = ?3, views = ?4, likes = ?5, saves = ?6, shares = ?7, comments = ?8,
     metrics_as_of = ?9, views_2d = ?10, views_2d_age_h = ?11, last_pulled = ?12, pull_error = NULL WHERE post_id = ?1`
  ).bind(postId, s.postUrl ?? null, published, s.views ?? null, s.likes ?? null, s.saves ?? null, s.shares ?? null,
         s.comments ?? null, iso(s.lastUpdated), v2, v2age, now).run();
}

async function pull(env) {
  if (!env.HUMANPOST_API_KEY) return { skipped: "no HUMANPOST_API_KEY secret" };
  const H = { Authorization: `Bearer ${env.HUMANPOST_API_KEY}` };
  const now = new Date().toISOString();
  const out = { accounts: 0, posts: 0, errors: 0 };
  try {
    const r = await fetch(`${API}/accounts?platform=tiktok`, { headers: H });
    if (!r.ok) throw new Error(`accounts ${r.status}`);
    const acc = (await r.json()).data || [];
    await env.DB.batch(acc.map((a) =>
      env.DB.prepare("INSERT OR REPLACE INTO accounts (username, status, platform, seen_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(a.username, a.status ?? null, a.platform ?? "tiktok", now)));
    out.accounts = acc.length;
  } catch (e) {
    await setMeta(env, "last_error", `${now} ${e.message}`);
    return { ...out, error: e.message }; // HumanPost unreachable: PC push is the fallback
  }
  const due = (await env.DB.prepare("SELECT post_id FROM posts ORDER BY COALESCE(last_pulled, '') ASC LIMIT ?1").bind(PER_RUN - 1).all()).results;
  for (const { post_id } of due) {
    try {
      const r = await fetch(`${API}/posts/${post_id}/analytics`, { headers: H });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await storeAnalytics(env, post_id, await r.json(), now);
      out.posts++;
    } catch (e) {
      out.errors++;
      await env.DB.prepare("UPDATE posts SET last_pulled = ?2, pull_error = ?3 WHERE post_id = ?1").bind(post_id, now, e.message).run();
    }
  }
  await setMeta(env, "last_pull", now);
  await setMeta(env, "last_pull_source", "cloudflare");
  return out;
}

const setMeta = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)").bind(k, v).run();

// PC push: body = versions.json ({versions, posts, excludeAccounts}) plus optional
// {analytics: {postId: {summary, history}}, accounts: {username: status}}
async function ingest(env, body) {
  const now = new Date().toISOString();
  for (const [tag, v] of Object.entries(body.versions || {})) if (TAG_RE.test(tag)) await upsertVersion(env, tag, v.what || "", true);
  if (Array.isArray(body.excludeAccounts)) {
    await env.DB.prepare("DELETE FROM exclude_accounts").run();
    if (body.excludeAccounts.length)
      await env.DB.batch(body.excludeAccounts.map((u) => env.DB.prepare("INSERT OR IGNORE INTO exclude_accounts (username) VALUES (?1)").bind(u)));
  }
  const posts = Object.entries(body.posts || {});
  for (let i = 0; i < posts.length; i += 50) {
    await env.DB.batch(posts.slice(i, i + 50).map(([pid, p]) =>
      env.DB.prepare(
        `INSERT INTO posts (post_id, version, grp, username, batch, post_date, label, cell) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(post_id) DO UPDATE SET grp = ?3, username = ?4, batch = ?5, post_date = ?6, label = ?7, cell = ?8,
         version = CASE WHEN posts.version LIKE '%.base.%' OR ?2 NOT LIKE '%.base.%' THEN ?2 ELSE posts.version END`
      ).bind(pid, p.version, p.group, p.user, p.batch ?? null, p.postDate ?? null, p.label ?? null, p.cell ?? null)));
    for (const [, p] of posts.slice(i, i + 50)) if (TAG_RE.test(p.version)) await upsertVersion(env, p.version, "", true);
  }
  if (body.accounts) {
    const rows = Object.entries(body.accounts);
    if (rows.length) await env.DB.batch(rows.map(([u, st]) =>
      env.DB.prepare("INSERT OR REPLACE INTO accounts (username, status, platform, seen_at) VALUES (?1, ?2, 'tiktok', ?3)").bind(u, st, now)));
  }
  let n = 0;
  for (const [pid, a] of Object.entries(body.analytics || {})) { await storeAnalytics(env, pid, a, now); n++; }
  if (n) { await setMeta(env, "last_pull", now); await setMeta(env, "last_pull_source", "pc"); }
  return { versions: Object.keys(body.versions || {}).length, posts: posts.length, analytics: n };
}

async function data(env) {
  const [versions, posts, accounts, excl, meta] = await Promise.all([
    env.DB.prepare("SELECT * FROM versions ORDER BY grp, vdate, name").all(),
    env.DB.prepare("SELECT * FROM posts ORDER BY post_date DESC, username").all(),
    env.DB.prepare("SELECT * FROM accounts").all(),
    env.DB.prepare("SELECT username FROM exclude_accounts").all(),
    env.DB.prepare("SELECT * FROM meta").all(),
  ]);
  return {
    versions: versions.results, posts: posts.results, accounts: accounts.results,
    excludeAccounts: excl.results.map((r) => r.username),
    meta: Object.fromEntries(meta.results.map((r) => [r.k, r.v])),
  };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/api/data" && req.method === "GET") return json(await data(env));
      if (p === "/api/versions" && req.method === "POST") {
        const { tag, what } = await req.json();
        if (!TAG_RE.test(tag || "")) return json({ error: "Tag must look like moms.dimmed.11122026" }, 400);
        await upsertVersion(env, tag, what || "");
        return json({ ok: true });
      }
      const m = p.match(/^\/api\/posts\/([\w-]+)$/);
      if (m && req.method === "PATCH") {
        const { version } = await req.json();
        if (!TAG_RE.test(version || "")) return json({ error: "Unknown tag format" }, 400);
        const known = await env.DB.prepare("SELECT tag FROM versions WHERE tag = ?1").bind(version).first();
        if (!known) return json({ error: "Add the version first" }, 400);
        await env.DB.prepare("UPDATE posts SET version = ?2 WHERE post_id = ?1").bind(m[1], version).run();
        return json({ ok: true });
      }
      if (p === "/api/ingest" && req.method === "POST") {
        if (!env.INGEST_TOKEN || req.headers.get("authorization") !== `Bearer ${env.INGEST_TOKEN}`) return json({ error: "unauthorized" }, 401);
        return json(await ingest(env, await req.json()));
      }
      if (p === "/api/refresh" && req.method === "POST") {
        ctx.waitUntil(pull(env));
        return json({ ok: true, note: "Refresh started; reload in a minute." });
      }
      if (p.startsWith("/api/")) return json({ error: "not found" }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pull(env));
  },
};
