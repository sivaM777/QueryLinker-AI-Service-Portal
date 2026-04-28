DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ticket_events'
      AND column_name = 'performed_by'
  ) THEN
    ALTER TABLE ticket_events
    ADD COLUMN performed_by UUID NULL;
  END IF;
END$$;

UPDATE ticket_events e
SET performed_by = t.created_by
FROM tickets t
WHERE e.ticket_id = t.id
  AND e.performed_by IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'ticket_events'
      AND column_name = 'performed_by'
  ) THEN
    ALTER TABLE ticket_events
    ALTER COLUMN performed_by SET NOT NULL;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ticket_events_performed_by_fkey'
  ) THEN
    ALTER TABLE ticket_events
    ADD CONSTRAINT ticket_events_performed_by_fkey
    FOREIGN KEY (performed_by) REFERENCES users(id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_ticket_events_performed_by ON ticket_events(performed_by);
