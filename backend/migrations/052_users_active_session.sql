ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_session_id UUID NULL,
  ADD COLUMN IF NOT EXISTS active_session_seen_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS active_session_tab_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS active_session_url TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_users_active_session_seen
  ON users (active_session_seen_at);
