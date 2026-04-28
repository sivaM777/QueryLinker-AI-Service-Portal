-- Migration 030: Email dedupe index

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_email_message_id 
ON tickets ((source_reference->>'message_id')) 
WHERE source_type = 'EMAIL';
