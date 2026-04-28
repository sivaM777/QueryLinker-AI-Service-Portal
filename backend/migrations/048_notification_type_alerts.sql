DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type'
      AND e.enumlabel = 'TICKET_COMMENTED'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'TICKET_COMMENTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type'
      AND e.enumlabel = 'TICKET_ESCALATED'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'TICKET_ESCALATED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type'
      AND e.enumlabel = 'SLA_FIRST_RESPONSE_BREACH'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'SLA_FIRST_RESPONSE_BREACH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type'
      AND e.enumlabel = 'SLA_RESOLUTION_BREACH'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'SLA_RESOLUTION_BREACH';
  END IF;
END $$;
