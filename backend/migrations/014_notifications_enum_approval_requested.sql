DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    BEGIN
      ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'APPROVAL_REQUESTED';
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
    END;
  END IF;
END$$;
