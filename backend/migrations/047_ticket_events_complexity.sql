DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'ticket_event_action'
      AND e.enumlabel = 'COMPLEXITY_SCORED'
  ) THEN
    ALTER TYPE ticket_event_action ADD VALUE 'COMPLEXITY_SCORED';
  END IF;
END $$;
