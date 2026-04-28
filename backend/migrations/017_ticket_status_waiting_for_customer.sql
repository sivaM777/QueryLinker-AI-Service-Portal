DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ticket_status'
        AND e.enumlabel = 'WAITING_FOR_CUSTOMER'
    ) THEN
      ALTER TYPE ticket_status ADD VALUE 'WAITING_FOR_CUSTOMER';
    END IF;
  END IF;
END$$;

