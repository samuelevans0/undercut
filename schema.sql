-- Undercut D1 schema. Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS sources (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  config_json          TEXT NOT NULL DEFAULT '{}',
  poll_interval_s      INTEGER NOT NULL,
  last_polled_at       INTEGER,
  last_success_at      INTEGER,
  last_status          TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_at          INTEGER
);

CREATE TABLE IF NOT EXISTS deals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint           TEXT NOT NULL UNIQUE,
  source_id             TEXT NOT NULL,
  external_id           TEXT,
  title                 TEXT NOT NULL,
  url                   TEXT NOT NULL,
  merchant              TEXT,
  condition             TEXT NOT NULL DEFAULT 'new',
  price_cents           INTEGER NOT NULL,
  was_price_cents       INTEGER,
  currency              TEXT NOT NULL DEFAULT 'USD',
  category              TEXT NOT NULL DEFAULT 'unknown',
  spec_key              TEXT,
  specs_json            TEXT NOT NULL DEFAULT '{}',
  posted_at             INTEGER,
  first_seen_at         INTEGER NOT NULL,
  last_seen_at          INTEGER NOT NULL,
  score                 INTEGER NOT NULL DEFAULT 0,
  score_reasons_json    TEXT NOT NULL DEFAULT '[]',
  notified_at           INTEGER,
  notified_price_cents  INTEGER,
  dead_at               INTEGER
);

CREATE INDEX IF NOT EXISTS idx_deals_seen  ON deals (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_score ON deals (score DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_spec  ON deals (spec_key);

CREATE TABLE IF NOT EXISTS deal_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  seen_at     INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  upvotes     INTEGER,
  comments    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_events_deal ON deal_events (deal_id, seen_at);

CREATE TABLE IF NOT EXISTS reference_prices (
  spec_key      TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  typical_cents INTEGER NOT NULL,
  floor_cents   INTEGER NOT NULL,
  origin        TEXT NOT NULL DEFAULT 'seed',
  sample_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  label           TEXT NOT NULL,
  query           TEXT NOT NULL,
  max_price_cents INTEGER,
  enabled         INTEGER NOT NULL DEFAULT 1,
  hit_count       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  label          TEXT NOT NULL,
  category       TEXT NOT NULL,
  predicate_json TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  hit_count      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prefs (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  notify_threshold INTEGER NOT NULL DEFAULT 78,
  weights_json     TEXT NOT NULL DEFAULT '{}',
  password_hash    TEXT,
  setup_done       INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO prefs (id) VALUES (1);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  failures   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id  INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  sent_at  INTEGER NOT NULL,
  result   TEXT NOT NULL
);

INSERT OR IGNORE INTO sources (id, name, poll_interval_s, config_json) VALUES
  ('reddit',     'Reddit',     60,  '{"subreddits":["buildapcsales"]}'),
  ('slickdeals', 'Slickdeals', 300, '{}'),
  ('woot',       'Woot',       900, '{}'),
  ('ebay',       'eBay',       300, '{}');
