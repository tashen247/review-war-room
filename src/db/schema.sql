CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  rating INTEGER NOT NULL,
  text TEXT NOT NULL,
  version TEXT,
  date TEXT NOT NULL,          -- ISO date (YYYY-MM-DD)
  country TEXT,
  injection_flag INTEGER NOT NULL DEFAULT 0,
  batch_id TEXT,
  ingested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews(date);
CREATE INDEX IF NOT EXISTS idx_reviews_batch ON reviews(batch_id);

CREATE TABLE IF NOT EXISTS releases (
  version TEXT NOT NULL,
  platform TEXT NOT NULL,
  date TEXT NOT NULL,
  changelog TEXT,
  crash_free REAL,
  PRIMARY KEY (version, platform)
);

CREATE TABLE IF NOT EXISTS clusters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT,
  severity INTEGER NOT NULL DEFAULT 3,
  platform TEXT NOT NULL DEFAULT 'both',
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',     -- ok | partial | merged
  merged_into INTEGER,
  first_seen_run TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cluster_aliases (
  alias_slug TEXT PRIMARY KEY,
  cluster_id INTEGER NOT NULL REFERENCES clusters(id)
);

CREATE TABLE IF NOT EXISTS review_clusters (
  review_id TEXT NOT NULL REFERENCES reviews(id),
  cluster_id INTEGER NOT NULL REFERENCES clusters(id),
  run_id TEXT,
  PRIMARY KEY (review_id, cluster_id)
);

CREATE TABLE IF NOT EXISTS cluster_snapshots (
  run_id TEXT NOT NULL,
  cluster_id INTEGER NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (run_id, cluster_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,                  -- running | done | failed
  started_at TEXT NOT NULL,
  finished_at TEXT,
  plan TEXT,
  cost_usd REAL,
  turns INTEGER,
  error TEXT,
  resume_url TEXT
);

CREATE TABLE IF NOT EXISTS verdicts (
  run_id TEXT PRIMARY KEY,
  suspect_version TEXT NOT NULL,
  platform TEXT,
  confidence REAL NOT NULL,
  base_confidence REAL,
  adjustment_reason TEXT,
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bugs (
  fingerprint TEXT PRIMARY KEY,
  cluster_id INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  external_id TEXT,
  url TEXT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,                  -- pending | approved | rejected
  reasons TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, review_id)
);

CREATE TABLE IF NOT EXISTS war_room_posts (
  run_id TEXT PRIMARY KEY,
  ts TEXT,
  payload TEXT NOT NULL
);
