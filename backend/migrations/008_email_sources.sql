-- Migration 008: Email Sources and Ticket Source Tracking

-- Add ticket source type enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_source_type') THEN
    CREATE TYPE ticket_source_type AS ENUM ('WEB', 'MOBILE', 'EMAIL', 'GLPI', 'SOLMAN', 'CHATBOT');
  END IF;
END$$;

-- Add source tracking columns to tickets table
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS source_type ticket_source_type NOT NULL DEFAULT 'WEB',
  ADD COLUMN IF NOT EXISTS source_reference JSONB NULL,
  ADD COLUMN IF NOT EXISTS integration_metadata JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_source_type ON tickets(source_type);

-- Email source configuration table
CREATE TABLE IF NOT EXISTS email_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email_address TEXT NOT NULL UNIQUE,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_secure BOOLEAN NOT NULL DEFAULT true,
  imap_username TEXT NOT NULL,
  imap_password TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_checked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_sources_enabled ON email_sources(enabled) WHERE enabled = true;
