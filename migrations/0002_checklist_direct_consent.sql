-- Independent, auditable single-opt-in consent from the Packing List only.
-- Does not change legacy Double Opt-in tokens or pm_seasonal_consent records.
CREATE TABLE IF NOT EXISTS pm_checklist_direct_consent (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','unsubscribed')),
  consent_version TEXT NOT NULL,
  source_path TEXT NOT NULL CHECK(source_path='/national-park-packing-list/'),
  requested_at INTEGER NOT NULL,
  subscribed_at INTEGER,
  contact_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pm_checklist_direct_consent_status
  ON pm_checklist_direct_consent(status,updated_at);
