DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'teams_name_unique'
  ) THEN
    ALTER TABLE teams
    ADD CONSTRAINT teams_name_unique UNIQUE (name);
  END IF;
END$$;
