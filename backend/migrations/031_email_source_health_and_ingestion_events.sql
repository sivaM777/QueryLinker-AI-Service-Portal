-- Migration 031: Email source health fields + ingestion audit

ALTER TABLE email_sources
  ADD COLUMN IF NOT EXISTS last_connect_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS last_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS email_ingestion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_source_id UUID NOT NULL REFERENCES email_sources(id) ON DELETE CASCADE,
  message_id TEXT NULL,
  from_email TEXT NULL,
  subject TEXT NULL,
  action TEXT NOT NULL,
  reason TEXT NULL,
  classifier_confidence REAL NULL,
  classifier_label TEXT NULL,
  created_ticket_id UUID NULL REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_ingestion_events_source_created_at
  ON email_ingestion_events(email_source_id, created_at DESC);
