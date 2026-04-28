-- Migration 010: Routing Rules and Configuration

-- Routing rules table for category/priority to team mapping
CREATE TABLE IF NOT EXISTS routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0, -- Higher priority rules evaluated first
  enabled BOOLEAN NOT NULL DEFAULT true,
  
  -- Conditions (all must match)
  category_filter TEXT[] NULL, -- Array of categories to match
  priority_filter ticket_priority[] NULL, -- Array of priorities to match
  keyword_filter TEXT[] NULL, -- Keywords that must appear in description
  urgency_keywords TEXT[] NULL, -- Keywords that indicate urgency
  
  -- Actions
  assigned_team_id UUID NULL REFERENCES teams(id),
  assigned_agent_id UUID NULL REFERENCES users(id),
  auto_priority ticket_priority NULL, -- Override priority
  
  -- Metadata
  description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_enabled ON routing_rules(enabled, priority) WHERE enabled = true;

-- Agent workload tracking
CREATE TABLE IF NOT EXISTS agent_workload (
  agent_id UUID PRIMARY KEY REFERENCES users(id),
  open_tickets_count INTEGER NOT NULL DEFAULT 0,
  in_progress_tickets_count INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_workload_open ON agent_workload(open_tickets_count, in_progress_tickets_count);

-- Agent skills/capabilities
CREATE TABLE IF NOT EXISTS agent_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  skill_level INTEGER NOT NULL DEFAULT 5 CHECK (skill_level >= 1 AND skill_level <= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id, category)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_category ON agent_skills(category, skill_level);

-- Routing history for ML training
CREATE TABLE IF NOT EXISTS routing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  routing_method TEXT NOT NULL, -- 'rule', 'ml', 'manual'
  suggested_team_id UUID NULL REFERENCES teams(id),
  suggested_agent_id UUID NULL REFERENCES users(id),
  actual_team_id UUID NULL REFERENCES teams(id),
  actual_agent_id UUID NULL REFERENCES users(id),
  confidence_score REAL NULL,
  routing_rules_applied UUID[] NULL, -- Array of rule IDs that matched
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routing_history_ticket ON routing_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_routing_history_method ON routing_history(routing_method, created_at);

-- Function to update agent workload
CREATE OR REPLACE FUNCTION update_agent_workload()
RETURNS TRIGGER AS $$
BEGIN
  -- Update workload for old agent if assigned_agent changed
  IF OLD.assigned_agent IS NOT NULL AND (OLD.assigned_agent != NEW.assigned_agent OR NEW.assigned_agent IS NULL) THEN
    UPDATE agent_workload
    SET 
      open_tickets_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = OLD.assigned_agent AND status = 'OPEN'
      ),
      in_progress_tickets_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = OLD.assigned_agent AND status = 'IN_PROGRESS'
      ),
      last_updated_at = now()
    WHERE agent_id = OLD.assigned_agent;
  END IF;

  -- Update workload for new agent
  IF NEW.assigned_agent IS NOT NULL THEN
    INSERT INTO agent_workload (agent_id, open_tickets_count, in_progress_tickets_count, last_updated_at)
    VALUES (
      NEW.assigned_agent,
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status = 'OPEN'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status = 'IN_PROGRESS'),
      now()
    )
    ON CONFLICT (agent_id) DO UPDATE SET
      open_tickets_count = EXCLUDED.open_tickets_count,
      in_progress_tickets_count = EXCLUDED.in_progress_tickets_count,
      last_updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to maintain agent workload
DROP TRIGGER IF EXISTS trg_update_agent_workload ON tickets;
CREATE TRIGGER trg_update_agent_workload
AFTER INSERT OR UPDATE OF assigned_agent, status ON tickets
FOR EACH ROW
EXECUTE FUNCTION update_agent_workload();
