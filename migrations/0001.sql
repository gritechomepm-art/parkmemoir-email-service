-- Dedicated consent audit D1. Never use the Digital Companion database.
CREATE TABLE IF NOT EXISTS pm_seasonal_consent (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','confirming','confirmed','unsubscribed')),
  token_hash TEXT UNIQUE,
  consent_version TEXT NOT NULL,
  source_path TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmation_sent_at INTEGER,
  confirmed_at INTEGER,
  unsubscribed_at INTEGER,
  contact_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pm_seasonal_token ON pm_seasonal_consent(token_hash);
CREATE INDEX IF NOT EXISTS idx_pm_seasonal_status ON pm_seasonal_consent(status,updated_at);
CREATE TABLE IF NOT EXISTS pm_seasonal_rate (
  key TEXT PRIMARY KEY, day INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pm_seasonal_rate_day ON pm_seasonal_rate(day);
