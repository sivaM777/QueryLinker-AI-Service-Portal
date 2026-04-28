-- Migration 038: Ensure Workload Trigger

-- Drop trigger if it exists to ensure we use the latest function version
DROP TRIGGER IF EXISTS trigger_update_workload ON tickets;

-- Create the trigger to update agent workload on ticket changes
CREATE TRIGGER trigger_update_workload
AFTER INSERT OR UPDATE OR DELETE ON tickets
FOR EACH ROW EXECUTE FUNCTION update_agent_workload();
