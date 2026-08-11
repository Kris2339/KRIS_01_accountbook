CREATE TABLE IF NOT EXISTS auth_attempts (
  address_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_blocked_until
ON auth_attempts (blocked_until);
