// Carousel Stats dashboard front end. Data comes from /api/data (the Worker); no keys here.
const GROUPS = ["moms", "streamers", "truckers", "vets"];
const LABEL = { moms: "Moms", streamers: "Streamers", truckers: "Truckers", vets: "Vets" };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const gcolor = (g) => css(`--g-${g}`);
const fmt = (n) => (n == null || n === "" || Number.isNaN(n) ? "–" : Math.round(n).toLocaleString("en-US"));
const fmt1 = (n) => (n == null || Number.isNaN(n) ? "–" : n.toFixed(1));
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const $ = (id) => document.getElementById(id);
let DATA = null, pie = null, bars = null, sortKey = "views", sortDir = -1, page = 1, pageSize = 15;

function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500); }

async function load() {
  try {
    const r = await fetch("/api/data", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    DATA = await r.json();
    render();
  } catch (e) { $("updated").textContent = `Couldn't load data (${e.message}).`; }
}

// Only active or archived accounts count; warming accounts are left out unless the box is ticked.
function counted(p) {
  if ($("f-warming").checked) return true;
  if (DATA.excludeAccounts.includes(p.username)) return false;
  const a = DATA.accounts.find((x) => x.username === p.username);
  return !a || a.status === "active";
}

function filtered() {
  const g = $("f-group").value, from = $("f-from").value, to = $("f-to").value;
  return DATA.posts.filter((p) => counted(p) && (!g || p.grp === g) && (!from || (p.post_date || "") >= from) && (!to || (p.post_date || "") <= to));
}

function summarize(rows) {
  const live = rows.filter((p) => p.published_at);
  const views = live.map((p) => p.views || 0), total = views.reduce((s, v) => s + v, 0);
  const v2 = live.map((p) => p.views_2d).filter((v) => v != null);
  const per1k = (k) => (total ? (1000 * live.reduce((s, p) => s + (p[k] || 0), 0)) / total : null);
  return { posts: rows.length, live: live.length, accounts: new Set(live.map((p) => p.username)).size, total,
           median2d: median(v2), n2d: v2.length, likes: per1k("likes"), saves: per1k("saves"), shares: per1k("shares") };
}

function render() {
  const m = DATA.meta || {};
  $("updated").textContent = m.last_pull
    ? `Last pulled ${new Date(m.last_pull).toLocaleString()}. Views refresh about once a day.`
    : "No stats pulled yet.";
  const rows = filtered();
  renderTiles(rows); renderPie(rows); renderVersions(rows); renderBars(rows); renderPosts(rows);
}

function renderTiles(rows) {
  const all = summarize(rows);
  $("tiles").innerHTML = GROUPS.filter((g) => !$("f-group").value || $("f-group").value === g).map((g) => {
    const s = summarize(rows.filter((p) => p.grp === g));
    const share = all.total ? Math.round((100 * s.total) / all.total) : 0;
    return `<div class="tile" style="--c:${gcolor(g)}"><div class="name">${LABEL[g]}</div>
      <p class="big">${fmt(s.median2d)}</p><div class="small">median views at 2 days</div>
      <div class="small">${fmt(s.total)} views (${share}%) · ${s.live} live posts</div></div>`;
  }).join("");
}

function renderPie(rows) {
  const per = GROUPS.map((g) => ({ g, v: summarize(rows.filter((p) => p.grp === g)).total })).filter((x) => x.v > 0);
  const total = per.reduce((s, x) => s + x.v, 0);
  const cfg = {
    type: "doughnut",
    data: { labels: per.map((x) => `${LABEL[x.g]} ${total ? ((100 * x.v) / total).toFixed(1) : 0}%`),
            datasets: [{ data: per.map((x) => x.v), backgroundColor: per.map((x) => gcolor(x.g)), borderColor: css("--surface"), borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: "55%",
      plugins: { legend: { position: "right", labels: { color: css("--ink"), boxWidth: 12, padding: 14 } },
                 tooltip: { callbacks: { label: (c) => ` ${fmt(c.raw)} views` } } } },
  };
  if (pie) pie.destroy();
  pie = new Chart($("pie"), cfg);
}

function versionRows(rows) {
  const out = [];
  for (const g of GROUPS) {
    const gv = DATA.versions.filter((v) => v.grp === g);
    if (!gv.length || ($("f-group").value && $("f-group").value !== g)) continue;
    const base = gv.find((v) => v.name === `${g}.base`);
    const baseMed = base ? summarize(rows.filter((p) => p.version === base.tag)).median2d : null;
    for (const v of gv) {
      const s = summarize(rows.filter((p) => p.version === v.tag));
      out.push({ g, v, s, vsBase: v === base || !baseMed || s.median2d == null ? null : s.median2d / baseMed });
    }
    out.push({ g, total: true, s: summarize(rows.filter((p) => p.grp === g)) });
  }
  return out;
}

function renderVersions(rows) {
  const vr = versionRows(rows);
  const head = `<tr><th>Version</th><th>Version date</th><th>What it is</th><th class="num">Live posts</th><th class="num">Accounts</th>
    <th class="num">Total views</th><th class="num">Median views at 2 days</th><th class="num">vs base</th><th class="num">Likes / saves / shares per 1K</th></tr>`;
  const body = vr.map((r) => {
    const s = r.s, rate = s.total ? `${fmt1(s.likes)} / ${fmt1(s.saves)} / ${fmt1(s.shares)}` : "–";
    if (r.total) return `<tr class="total"><td><span class="dot" style="--c:${gcolor(r.g)}"></span>${LABEL[r.g]} total</td><td></td><td>All ${LABEL[r.g].toLowerCase()} versions</td>
      <td class="num">${s.live}</td><td class="num">${s.accounts}</td><td class="num">${fmt(s.total)}</td><td class="num">${fmt(s.median2d)}</td><td></td><td class="num">${rate}</td></tr>`;
    const d = r.v.vdate, date = d.length === 8 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d;
    const vs = r.vsBase == null ? "" : `<span class="${r.vsBase >= 1.5 ? "win" : r.vsBase < 1 ? "lose" : ""}">${r.vsBase.toFixed(2)}×</span>`;
    return `<tr><td><span class="dot" style="--c:${gcolor(r.g)}"></span>${r.v.name}</td><td>${date}</td><td class="what">${esc(r.v.what || "")}</td>
      <td class="num">${s.live}</td><td class="num">${s.live ? s.accounts : ""}</td><td class="num">${s.live ? fmt(s.total) : ""}</td>
      <td class="num">${s.live ? fmt(s.median2d) : '<span class="muted">no data yet</span>'}</td><td class="num">${vs}</td><td class="num">${s.live ? rate : ""}</td></tr>`;
  }).join("");
  $("versions").innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

function renderBars(rows) {
  const vr = versionRows(rows).filter((r) => !r.total && r.s.median2d != null);
  const cfg = {
    type: "bar",
    data: { labels: vr.map((r) => r.v.name), datasets: [{ data: vr.map((r) => r.s.median2d), backgroundColor: vr.map((r) => gcolor(r.g)),
            borderRadius: 4, barThickness: 18 }] },
    options: { indexAxis: "y", maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${fmt(c.raw)} median views at 2 days (${vr[c.dataIndex].s.n2d} posts)` } } },
      scales: { x: { beginAtZero: true, grid: { color: css("--grid") }, ticks: { color: css("--ink-2") } },
                y: { grid: { display: false }, ticks: { color: css("--ink") } } } },
  };
  if (bars) bars.destroy();
  bars = new Chart($("bars"), cfg);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const LINK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
function renderPosts(rows) {
  const q = $("f-search").value.toLowerCase();
  const list = rows.filter((p) => !q || [p.username, p.label, p.version, p.batch].join(" ").toLowerCase().includes(q))
    .sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1; // blanks always last
      return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
    });
  const cols = [["post_date", "Batch date"], ["grp", "Group"], ["username", "Account"], ["version", "Version"], ["label", "Label"],
    ["views", "Views", 1], ["views_2d", "Views at 2 days", 1], ["likes", "Likes", 1], ["saves", "Saves", 1], ["shares", "Shares", 1]];
  const head = cols.map(([k, t, n]) => `<th data-k="${k}" class="${n ? "num" : ""}">${t}${sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : ""}</th>`).join("") + "<th>Link</th>";
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  page = Math.min(Math.max(1, page), pages);
  const start = (page - 1) * pageSize;
  const shown = list.slice(start, start + pageSize);
  const body = shown.map((p) => {
    const v = DATA.versions.find((x) => x.tag === p.version);
    return `<tr><td>${p.post_date || ""}</td><td><span class="dot" style="--c:${gcolor(p.grp)}"></span>${LABEL[p.grp] || p.grp}</td><td>${esc(p.username)}</td>
      <td>${esc(v ? v.name : p.version || "")}</td><td class="muted label" title="${esc(p.label || "")}">${esc(p.label || "")}</td>
      <td class="num">${p.published_at ? fmt(p.views) : '<span class="muted">not live</span>'}</td><td class="num">${fmt(p.views_2d)}</td>
      <td class="num">${fmt(p.likes)}</td><td class="num">${fmt(p.saves)}</td><td class="num">${fmt(p.shares)}</td>
      <td class="link">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener" title="Open on TikTok" aria-label="Open post on TikTok">${LINK_ICON}</a>` : '<span class="muted" title="Not live yet">–</span>'}</td></tr>`;
  }).join("");
  $("posts").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
  $("pg-info").textContent = list.length ? `${start + 1}–${start + shown.length} of ${list.length} posts` : "No posts";
  $("pg-page").textContent = `Page ${page} of ${pages}`;
  $("pg-prev").disabled = page <= 1; $("pg-next").disabled = page >= pages;
}

$("posts").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-k]"); if (!th) return;
  const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : -1; sortKey = k; page = 1; renderPosts(filtered());
});
$("refresh").addEventListener("click", async () => {
  toast("Refreshing from HumanPost…");
  const r = await fetch("/api/refresh", { method: "POST" }).then((x) => x.json()).catch((e) => ({ error: e.message }));
  toast(r.error || r.skipped ? `Couldn't refresh: ${r.error || r.skipped}` : `Updated ${r.posts} posts`); load();
});
["f-group", "f-from", "f-to", "f-warming"].forEach((id) => $(id).addEventListener("change", () => { page = 1; render(); }));
$("pg-prev").addEventListener("click", () => { page--; renderPosts(filtered()); });
$("pg-next").addEventListener("click", () => { page++; renderPosts(filtered()); });
$("pg-size").addEventListener("change", (e) => { pageSize = +e.target.value; page = 1; renderPosts(filtered()); });
$("f-search").addEventListener("input", () => { page = 1; renderPosts(filtered()); });

for (const g of GROUPS) { $("f-group").insertAdjacentHTML("beforeend", `<option value="${g}">${LABEL[g]}</option>`); }
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : darkMQ.matches;
$("theme-toggle").checked = isDark();
$("theme-toggle").addEventListener("change", (e) => {
  const t = e.target.checked ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("theme", t); } catch (err) {}
  render(); // redraw charts with the new colors
});
darkMQ.addEventListener("change", () => { $("theme-toggle").checked = isDark(); render(); });
load();
setInterval(load, 5 * 60 * 1000); // live view: re-read the database every 5 minutes
