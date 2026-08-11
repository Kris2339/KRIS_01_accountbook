CREATE TABLE IF NOT EXISTS household_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0, 1)),
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  updated_by TEXT
);

INSERT OR IGNORE INTO household_state (id, revision, initialized, settings_json)
VALUES (1, 0, 0, '{}');

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  transaction_date TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_active_date
ON transactions (deleted_at, transaction_date);

CREATE TABLE IF NOT EXISTS revisions (
  revision INTEGER PRIMARY KEY,
  saved_at TEXT NOT NULL,
  saved_by TEXT NOT NULL,
  transaction_count INTEGER NOT NULL
);

INSERT OR IGNORE INTO revisions (revision, saved_at, saved_by, transaction_count)
VALUES (0, '1970-01-01T00:00:00.000Z', 'system', 0);
