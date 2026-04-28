ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

UPDATE users SET session_version = 0 WHERE session_version IS NULL;
