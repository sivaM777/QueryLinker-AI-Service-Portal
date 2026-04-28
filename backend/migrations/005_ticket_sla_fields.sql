ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS sla_first_response_due_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS sla_resolution_due_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_sla_first_response_due_at ON tickets(sla_first_response_due_at);
CREATE INDEX IF NOT EXISTS idx_tickets_sla_resolution_due_at ON tickets(sla_resolution_due_at);
