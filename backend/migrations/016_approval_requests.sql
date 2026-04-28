-- Migration 016: Approval Requests (employee confirmation for auto-resolution)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_status') THEN
    CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
  END IF;
END$$;

-- Add approval notification type
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'notification_type' AND e.enumlabel = 'APPROVAL_REQUESTED'
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'APPROVAL_REQUESTED';
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_execution_id UUID NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL DEFAULT 0,
  requested_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status approval_status NOT NULL DEFAULT 'pending',
  action_title TEXT NOT NULL,
  action_body TEXT NOT NULL,
  input_data JSONB NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NULL,
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_ticket_status ON approval_requests(ticket_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_requests_execution ON approval_requests(workflow_execution_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_token_hash ON approval_requests(token_hash);
