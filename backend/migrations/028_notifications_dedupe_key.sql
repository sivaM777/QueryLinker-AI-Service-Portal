DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'dedupe_key'
  ) THEN
    ALTER TABLE notifications ADD COLUMN dedupe_key TEXT NULL;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe_key
  ON notifications(dedupe_key);
