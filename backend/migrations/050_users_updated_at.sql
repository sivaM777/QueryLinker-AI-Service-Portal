ALTER TABLE users
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill existing rows in case default didn't apply
UPDATE users SET updated_at = now() WHERE updated_at IS NULL;
