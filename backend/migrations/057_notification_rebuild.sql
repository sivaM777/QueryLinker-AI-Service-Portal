DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'actor_user_id'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'audience_role'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN audience_role user_role NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'action_url'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN action_url TEXT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE notifications
      ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

UPDATE notifications
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

UPDATE alert_rules
SET channels = array_remove(channels, 'IN_APP'::alert_channel)
WHERE channels IS NOT NULL
  AND 'IN_APP'::alert_channel = ANY(channels);

UPDATE alert_rules
SET enabled = false
WHERE enabled = true
  AND channels IS NOT NULL
  AND cardinality(channels) = 0;

DELETE FROM notifications;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
  ON notifications(user_id, read_at, created_at DESC);
