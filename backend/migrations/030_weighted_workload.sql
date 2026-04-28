-- Migration 030: Weighted Workload Distribution

-- Add priority-based counts to agent_workload
ALTER TABLE agent_workload
ADD COLUMN IF NOT EXISTS high_priority_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS medium_priority_count INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS low_priority_count INTEGER NOT NULL DEFAULT 0;

-- Function to update agent workload with priority weighting
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
        WHERE assigned_agent = OLD.assigned_agent AND status IN ('IN_PROGRESS', 'WAITING_FOR_CUSTOMER')
      ),
      high_priority_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = OLD.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'HIGH'
      ),
      medium_priority_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = OLD.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'MEDIUM'
      ),
      low_priority_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = OLD.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'LOW'
      ),
      last_updated_at = now()
    WHERE agent_id = OLD.assigned_agent;
  END IF;

  -- Update workload for new agent
  IF NEW.assigned_agent IS NOT NULL THEN
    INSERT INTO agent_workload (
      agent_id, 
      open_tickets_count, 
      in_progress_tickets_count, 
      high_priority_count,
      medium_priority_count,
      low_priority_count,
      last_updated_at
    )
    VALUES (
      NEW.assigned_agent,
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status = 'OPEN'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status IN ('IN_PROGRESS', 'WAITING_FOR_CUSTOMER')),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'HIGH'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'MEDIUM'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'LOW'),
      now()
    )
    ON CONFLICT (agent_id) DO UPDATE SET
      open_tickets_count = EXCLUDED.open_tickets_count,
      in_progress_tickets_count = EXCLUDED.in_progress_tickets_count,
      high_priority_count = EXCLUDED.high_priority_count,
      medium_priority_count = EXCLUDED.medium_priority_count,
      low_priority_count = EXCLUDED.low_priority_count,
      last_updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recalculate workload for all agents
DO $$
DECLARE
  agent_record RECORD;
BEGIN
  FOR agent_record IN SELECT DISTINCT assigned_agent FROM tickets WHERE assigned_agent IS NOT NULL LOOP
    -- Simulate an update to trigger recalculation (or just run the logic directly)
    -- Here we'll just run the update logic directly for each agent
    UPDATE agent_workload
    SET 
      open_tickets_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = agent_record.assigned_agent AND status = 'OPEN'
      ),
      in_progress_tickets_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = agent_record.assigned_agent AND status IN ('IN_PROGRESS', 'WAITING_FOR_CUSTOMER')
      ),
      high_priority_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = agent_record.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'HIGH'
      ),
      medium_priority_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = agent_record.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'MEDIUM'
      ),
      low_priority_count = (
        SELECT COUNT(*) FROM tickets 
        WHERE assigned_agent = agent_record.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'LOW'
      ),
      last_updated_at = now()
    WHERE agent_id = agent_record.assigned_agent;

    -- Insert if not exists (for agents not yet in workload table but in tickets)
    INSERT INTO agent_workload (
      agent_id, 
      open_tickets_count, 
      in_progress_tickets_count, 
      high_priority_count,
      medium_priority_count,
      low_priority_count,
      last_updated_at
    )
    SELECT
      agent_record.assigned_agent,
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = agent_record.assigned_agent AND status = 'OPEN'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = agent_record.assigned_agent AND status IN ('IN_PROGRESS', 'WAITING_FOR_CUSTOMER')),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = agent_record.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'HIGH'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = agent_record.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'MEDIUM'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = agent_record.assigned_agent AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER') AND priority = 'LOW'),
      now()
    WHERE NOT EXISTS (SELECT 1 FROM agent_workload WHERE agent_id = agent_record.assigned_agent);
  END LOOP;
END$$;
