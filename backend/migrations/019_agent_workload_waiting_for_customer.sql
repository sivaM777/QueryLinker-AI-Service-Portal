-- Count WAITING_FOR_CUSTOMER as in-progress workload.

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
      last_updated_at = now()
    WHERE agent_id = OLD.assigned_agent;
  END IF;

  -- Update workload for new agent
  IF NEW.assigned_agent IS NOT NULL THEN
    INSERT INTO agent_workload (agent_id, open_tickets_count, in_progress_tickets_count, last_updated_at)
    VALUES (
      NEW.assigned_agent,
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status = 'OPEN'),
      (SELECT COUNT(*) FROM tickets WHERE assigned_agent = NEW.assigned_agent AND status IN ('IN_PROGRESS', 'WAITING_FOR_CUSTOMER')),
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

