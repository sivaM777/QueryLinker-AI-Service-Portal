CREATE TABLE IF NOT EXISTS ticket_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  resolution_summary TEXT NOT NULL,
  symptoms TEXT NULL,
  root_cause TEXT NULL,
  steps_performed TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_resolutions_ticket_id ON ticket_resolutions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_resolutions_created_at ON ticket_resolutions(created_at);
