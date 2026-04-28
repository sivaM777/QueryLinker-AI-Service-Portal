DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TIME_OFF_REQUESTED';
    ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TIME_OFF_APPROVED';
    ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TIME_OFF_DENIED';
  END IF;
END$$;

ALTER TABLE time_off_requests
  ADD COLUMN IF NOT EXISTS subject VARCHAR(160),
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_content_type TEXT;

UPDATE time_off_requests
SET subject = COALESCE(NULLIF(BTRIM(subject), ''), 'Time off request')
WHERE subject IS NULL OR BTRIM(subject) = '';

UPDATE time_off_requests
SET reason = COALESCE(NULLIF(BTRIM(reason), ''), 'No reason provided')
WHERE reason IS NULL OR BTRIM(reason) = '';

ALTER TABLE time_off_requests
  ALTER COLUMN subject SET NOT NULL;

ALTER TABLE time_off_requests
  ALTER COLUMN reason SET NOT NULL;
