-- Migration 033: Enhanced User Profiles for Professional Helpdesk

-- Add additional profile fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(100) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) DEFAULT 'ONLINE' CHECK (availability_status IN ('ONLINE', 'BUSY', 'OFFLINE', 'ON_BREAK', 'AWAY'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_concurrent_tickets INTEGER DEFAULT 5;
ALTER TABLE users ADD COLUMN IF NOT EXISTS certifications JSONB NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE NULL;

-- Create agent performance tracking table
CREATE TABLE IF NOT EXISTS agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tickets_resolved INTEGER DEFAULT 0,
  avg_resolution_time_minutes INTEGER DEFAULT 0,
  customer_satisfaction_score DECIMAL(3,2) DEFAULT 0.00 CHECK (customer_satisfaction_score >= 0 AND customer_satisfaction_score <= 5),
  first_call_resolution_rate DECIMAL(5,2) DEFAULT 0.00 CHECK (first_call_resolution_rate >= 0 AND first_call_resolution_rate <= 100),
  escalation_rate DECIMAL(5,2) DEFAULT 0.00 CHECK (escalation_rate >= 0 AND escalation_rate <= 100),
  knowledge_base_contributions INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_performance_agent ON agent_performance(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_performance_updated ON agent_performance(last_updated DESC);

-- Add trigger for updated_at on agent_performance
DROP TRIGGER IF EXISTS trg_agent_performance_updated_at ON agent_performance;
CREATE TRIGGER trg_agent_performance_updated_at
  BEFORE UPDATE ON agent_performance
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();

-- Create user activity tracking table
CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type VARCHAR(50) NOT NULL,
  description TEXT NULL,
  metadata JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_type ON user_activity(activity_type, created_at DESC);

-- Create agent availability tracking table
CREATE TABLE IF NOT EXISTS agent_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('ONLINE', 'BUSY', 'OFFLINE', 'ON_BREAK', 'AWAY')),
  reason TEXT NULL,
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_agent ON agent_availability(agent_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_agent_availability_status ON agent_availability(status, start_time DESC);

-- Function to update agent performance metrics
CREATE OR REPLACE FUNCTION update_agent_performance(
  p_agent_id UUID,
  p_tickets_resolved INTEGER DEFAULT 0,
  p_resolution_time INTEGER DEFAULT 0,
  p_satisfaction DECIMAL DEFAULT NULL,
  p_fcr_rate DECIMAL DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO agent_performance (agent_id, tickets_resolved, avg_resolution_time_minutes, customer_satisfaction_score, first_call_resolution_rate)
  VALUES (p_agent_id, p_tickets_resolved, p_resolution_time, p_satisfaction, p_fcr_rate)
  ON CONFLICT (agent_id) DO UPDATE SET
    tickets_resolved = agent_performance.tickets_resolved + p_tickets_resolved,
    avg_resolution_time_minutes = CASE 
      WHEN p_resolution_time > 0 THEN (agent_performance.avg_resolution_time_minutes + p_resolution_time) / 2
      ELSE agent_performance.avg_resolution_time_minutes
    END,
    customer_satisfaction_score = COALESCE(p_satisfaction, agent_performance.customer_satisfaction_score),
    first_call_resolution_rate = COALESCE(p_fcr_rate, agent_performance.first_call_resolution_rate),
    last_updated = now();
END;
$$ LANGUAGE plpgsql;

-- Function to log user activity
CREATE OR REPLACE FUNCTION log_user_activity(
  p_user_id UUID,
  p_activity_type VARCHAR(50),
  p_description TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO user_activity (user_id, activity_type, description, metadata)
  VALUES (p_user_id, p_activity_type, p_description, p_metadata);
END;
$$ LANGUAGE plpgsql;

-- Function to get agent current availability
CREATE OR REPLACE FUNCTION get_agent_availability(p_agent_id UUID)
  RETURNS TABLE(status VARCHAR(20), reason TEXT, is_available BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.status,
    a.reason,
    CASE WHEN a.status = 'ONLINE' THEN true ELSE false END as is_available
  FROM agent_availability a
  WHERE a.agent_id = p_agent_id
    AND a.end_time IS NULL
  ORDER BY a.start_time DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;
