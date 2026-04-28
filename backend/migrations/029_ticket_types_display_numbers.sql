DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_type') THEN
    CREATE TYPE ticket_type AS ENUM ('INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM');
  END IF;
END$$;

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS type ticket_type NOT NULL DEFAULT 'INCIDENT',
ADD COLUMN IF NOT EXISTS display_number TEXT;

-- Create sequences for display numbers
CREATE SEQUENCE IF NOT EXISTS ticket_display_number_seq START 1;

-- Function to generate display number
CREATE OR REPLACE FUNCTION generate_display_number(ticket_type ticket_type)
RETURNS TEXT AS $$
DECLARE
  prefix TEXT;
  seq_num INTEGER;
BEGIN
  CASE ticket_type
    WHEN 'INCIDENT' THEN prefix := 'INC';
    WHEN 'SERVICE_REQUEST' THEN prefix := 'REQ';
    WHEN 'CHANGE' THEN prefix := 'CHG';
    WHEN 'PROBLEM' THEN prefix := 'PRB';
  END CASE;

  -- Get next sequence value
  SELECT nextval('ticket_display_number_seq') INTO seq_num;

  -- Return formatted number (e.g., INC0000123)
  RETURN prefix || LPAD(seq_num::TEXT, 9, '0');
END;
$$ LANGUAGE plpgsql;

-- Add unique constraint on display_number
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'unique_display_number'
  ) THEN
    ALTER TABLE tickets ADD CONSTRAINT unique_display_number UNIQUE (display_number);
  END IF;
END$$;

-- Create index on type for filtering
CREATE INDEX IF NOT EXISTS idx_tickets_type ON tickets(type);

-- Incident details (optional)
CREATE TABLE IF NOT EXISTS incident_details (
  ticket_id UUID PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  impact TEXT, -- e.g., 'HIGH', 'MEDIUM', 'LOW'
  urgency TEXT, -- e.g., 'HIGH', 'MEDIUM', 'LOW'
  screenshot_urls TEXT[], -- array of URLs
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service request details
CREATE TABLE IF NOT EXISTS service_request_details (
  ticket_id UUID PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  request_category TEXT NOT NULL, -- e.g., 'ACCESS', 'SOFTWARE', 'HARDWARE'
  due_date TIMESTAMPTZ,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Change details
CREATE TABLE IF NOT EXISTS change_details (
  ticket_id UUID PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  risk_level TEXT, -- e.g., 'HIGH', 'MEDIUM', 'LOW'
  rollback_plan TEXT,
  scheduled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Problem details
CREATE TABLE IF NOT EXISTS problem_details (
  ticket_id UUID PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  rca_notes TEXT, -- Root Cause Analysis notes
  permanent_fix TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Set display_number for existing tickets
UPDATE tickets SET display_number = generate_display_number(type) WHERE display_number IS NULL;
