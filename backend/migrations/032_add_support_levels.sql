-- Migration 032: Add Support Levels and Escalation Paths

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'support_level') THEN
    CREATE TYPE support_level AS ENUM ('L1', 'L2', 'L3');
  END IF;
END$$;

-- Add support level to teams table
ALTER TABLE teams ADD COLUMN IF NOT EXISTS support_level support_level NULL;

-- Add escalation path fields to teams
ALTER TABLE teams ADD COLUMN IF NOT EXISTS escalation_team_id UUID NULL REFERENCES teams(id);
ALTER TABLE teams ADD COLUMN IF NOT EXISTS auto_escalate_minutes INTEGER NULL DEFAULT 60;

-- Add complexity and support level tracking to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS complexity_score INTEGER NULL CHECK (complexity_score >= 1 AND complexity_score <= 10);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS current_support_level support_level NULL;

-- Create escalation paths table
CREATE TABLE IF NOT EXISTS escalation_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_team_id UUID NOT NULL REFERENCES teams(id),
  to_team_id UUID NOT NULL REFERENCES teams(id),
  trigger_conditions JSONB NULL,
  auto_escalate_minutes INTEGER NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalation_paths_from_team ON escalation_paths(from_team_id, enabled);
CREATE INDEX IF NOT EXISTS idx_escalation_paths_to_team ON escalation_paths(to_team_id, enabled);

-- Create escalation history table
CREATE TABLE IF NOT EXISTS escalation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  from_level support_level NOT NULL,
  to_level support_level NOT NULL,
  from_team_id UUID NULL REFERENCES teams(id),
  to_team_id UUID NULL REFERENCES teams(id),
  reason TEXT NOT NULL,
  escalated_by UUID NOT NULL REFERENCES users(id),
  auto_escalated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalation_history_ticket ON escalation_history(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_escalation_history_level ON escalation_history(from_level, to_level, created_at);

-- Add trigger for updated_at on escalation_paths
DROP TRIGGER IF EXISTS trg_escalation_paths_updated_at ON escalation_paths;
CREATE TRIGGER trg_escalation_paths_updated_at
BEFORE UPDATE ON escalation_paths
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();

-- Function to get next escalation level for a team
CREATE OR REPLACE FUNCTION get_next_escalation_level(p_team_id UUID)
RETURNS TABLE(team_id UUID, support_level support_level, auto_escalate_minutes INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.escalation_team_id,
        t.support_level,
        t.auto_escalate_minutes
    FROM teams t
    WHERE t.id = p_team_id 
      AND t.escalation_team_id IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to check if ticket should be auto-escalated
CREATE OR REPLACE FUNCTION should_auto_escalate(p_ticket_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_ticket_created TIMESTAMPTZ;
    v_current_team_id UUID;
    v_auto_escalate_minutes INTEGER;
    v_should_escalate BOOLEAN := FALSE;
BEGIN
    -- Get ticket creation time and current team
    SELECT t.created_at, t.assigned_team
    INTO v_ticket_created, v_current_team_id
    FROM tickets t
    WHERE t.id = p_ticket_id;
    
    -- Get auto-escalate minutes for current team
    SELECT t.auto_escalate_minutes
    INTO v_auto_escalate_minutes
    FROM teams t
    WHERE t.id = v_current_team_id;
    
    -- Check if should escalate
    IF v_auto_escalate_minutes IS NOT NULL THEN
        v_should_escalate := (v_ticket_created < (now() - (v_auto_escalate_minutes || ' minutes')::INTERVAL));
    END IF;
    
    RETURN v_should_escalate;
END;
$$ LANGUAGE plpgsql;
