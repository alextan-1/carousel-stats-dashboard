-- Carousel stats dashboard (Cloudflare D1)
CREATE TABLE IF NOT EXISTS versions (
  tag TEXT PRIMARY KEY,            -- group.variant.MMDDYYYY
  grp TEXT NOT NULL,               -- moms | vets | truckers | streamers
  name TEXT NOT NULL,              -- group.variant
  vdate TEXT NOT NULL,             -- MMDDYYYY
  what TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS accounts (
  username TEXT PRIMARY KEY,
  status TEXT,                     -- HumanPost status (active, settingUp, ...); missing from HumanPost = archived
  platform TEXT,
  seen_at TEXT
);
CREATE TABLE IF NOT EXISTS posts (
  post_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  grp TEXT NOT NULL,
  username TEXT NOT NULL,
  batch TEXT,
  post_date TEXT,                  -- YYYY-MM-DD (batch date)
  label TEXT,                      -- Kelvin's notes label
  cell TEXT,                       -- MOMTEST-A..D
  url TEXT,
  published_at TEXT,
  views INTEGER, likes INTEGER, saves INTEGER, shares INTEGER, comments INTEGER,
  metrics_as_of TEXT,
  views_2d INTEGER, views_2d_age_h INTEGER,
  last_pulled TEXT,
  pull_error TEXT
);
CREATE TABLE IF NOT EXISTS history (
  post_id TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  views INTEGER, likes INTEGER, saves INTEGER, shares INTEGER, comments INTEGER,
  PRIMARY KEY (post_id, collected_at)
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS exclude_accounts (username TEXT PRIMARY KEY);  -- warming handles never counted
CREATE INDEX IF NOT EXISTS posts_version ON posts(version);
CREATE INDEX IF NOT EXISTS posts_pull ON posts(last_pulled);
