-- ============================================================================
-- Enterprise-Grade System: Database Schema
-- Features: Audit Logs, Visual Workflows, Real-Time Presence, Metrics
-- ============================================================================

-- ============================================================================
-- 1. AUDIT LOGS & COMPLIANCE
-- ============================================================================

-- Main audit log table - immutable record of all changes
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL, -- 'ticket', 'user', 'workflow', 'kb', 'settings'
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL, -- 'created', 'updated', 'deleted', 'viewed', 'exported', 'printed'
  field_name VARCHAR(100), -- NULL for entity-level actions
  old_value TEXT,
  new_value TEXT,
  user_id UUID REFERENCES users(id),
  user_email VARCHAR(255),
  user_name VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  session_id VARCHAR(255),
  metadata JSONB DEFAULT '{}', -- Additional context (reason, approval_id, etc.)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit summary for fast statistics
CREATE TABLE IF NOT EXISTS audit_summary (
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  total_changes INTEGER DEFAULT 0,
  total_views INTEGER DEFAULT 0,
  last_updated_at TIMESTAMP,
  last_updated_by UUID REFERENCES users(id),
  PRIMARY KEY (entity_type, entity_id)
);

-- Compliance retention policies
CREATE TABLE IF NOT EXISTS audit_retention_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL UNIQUE,
  retention_days INTEGER NOT NULL DEFAULT 2555, -- 7 years default (SOX compliance)
  archive_enabled BOOLEAN DEFAULT true,
  archive_bucket VARCHAR(255),
  archive_after_days INTEGER DEFAULT 365,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Archived audit logs (moved here after retention period)
CREATE TABLE IF NOT EXISTS audit_logs_archive (
  id UUID PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  user_id UUID,
  user_email VARCHAR(255),
  user_name VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  session_id VARCHAR(255),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP,
  archived_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for audit logs
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_composite ON audit_logs(entity_type, action, created_at DESC);

-- ============================================================================
-- 2. REAL-TIME PRESENCE & COLLISION DETECTION
-- ============================================================================

-- User presence tracking
CREATE TABLE IF NOT EXISTS user_presence (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  ticket_id UUID REFERENCES tickets(id),
  page_path VARCHAR(255), -- Current page location
  status VARCHAR(50) NOT NULL DEFAULT 'online', -- 'online', 'away', 'busy', 'offline'
  last_activity TIMESTAMP DEFAULT NOW(),
  socket_id VARCHAR(100),
  metadata JSONB DEFAULT '{}', -- Active fields, cursor position, etc.
  joined_at TIMESTAMP DEFAULT NOW()
);

-- Field locks for collision detection
CREATE TABLE IF NOT EXISTS field_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL,
  locked_by UUID REFERENCES users(id),
  socket_id VARCHAR(100),
  locked_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  UNIQUE(ticket_id, field_name)
);

-- Conflict history for analysis
CREATE TABLE IF NOT EXISTS conflict_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES tickets(id),
  field_name VARCHAR(100),
  user_a_id UUID REFERENCES users(id),
  user_b_id UUID REFERENCES users(id),
  conflict_type VARCHAR(50), -- 'simultaneous_edit', 'overwrite', 'field_lock_timeout'
  resolution VARCHAR(50), -- 'merged', 'user_a_won', 'user_b_won', 'discarded'
  resolution_data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Session activity log (for audit trail)
CREATE TABLE IF NOT EXISTS session_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  session_id VARCHAR(255) NOT NULL,
  action VARCHAR(50) NOT NULL, -- 'login', 'logout', 'ticket_view', 'ticket_edit', 'export'
  entity_type VARCHAR(50),
  entity_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for presence and locks
CREATE INDEX IF NOT EXISTS idx_presence_ticket ON user_presence(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_presence_activity ON user_presence(last_activity);
CREATE INDEX IF NOT EXISTS idx_field_locks_ticket ON field_locks(ticket_id);
CREATE INDEX IF NOT EXISTS idx_field_locks_expires ON field_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_session_activity_user ON session_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_activity_session ON session_activity(session_id, created_at DESC);

-- ============================================================================
-- 3. VISUAL WORKFLOW AUTOMATION
-- ============================================================================

-- Visual workflow definitions (node-edge graph structure)
CREATE TABLE IF NOT EXISTS workflow_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  category_filter VARCHAR[] DEFAULT '{}',
  trigger_type VARCHAR(50) NOT NULL, -- 'ticket_created', 'ticket_updated', 'scheduled', 'manual', 'api'
  trigger_config JSONB DEFAULT '{}', -- Additional trigger conditions
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Workflow nodes (visual builder nodes)
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_graphs(id) ON DELETE CASCADE,
  node_id VARCHAR(50) NOT NULL, -- React Flow node ID
  type VARCHAR(50) NOT NULL, -- 'trigger', 'action', 'condition', 'delay', 'loop', 'subworkflow'
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  width FLOAT DEFAULT 200,
  height FLOAT DEFAULT 100,
  data JSONB NOT NULL DEFAULT '{}', -- Node configuration (action type, params, etc.)
  label VARCHAR(200),
  description TEXT,
  UNIQUE(workflow_id, node_id)
);

-- Workflow edges (connections between nodes)
CREATE TABLE IF NOT EXISTS workflow_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_graphs(id) ON DELETE CASCADE,
  edge_id VARCHAR(50) NOT NULL,
  source_node_id VARCHAR(50) NOT NULL,
  target_node_id VARCHAR(50) NOT NULL,
  condition VARCHAR(100), -- 'true', 'false', 'always', custom condition
  condition_expression TEXT, -- For complex conditions
  animated BOOLEAN DEFAULT false,
  style JSONB DEFAULT '{}', -- Line style (color, width, etc.)
  UNIQUE(workflow_id, edge_id)
);

-- Workflow execution instances
CREATE TABLE IF NOT EXISTS workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_graphs(id),
  ticket_id UUID REFERENCES tickets(id),
  trigger_data JSONB DEFAULT '{}', -- Data that triggered the workflow
  status VARCHAR(50) NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed', 'cancelled', 'paused'
  current_node_id VARCHAR(50), -- Currently executing node
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  logs JSONB DEFAULT '[]', -- Execution log entries
  error_message TEXT,
  error_node_id VARCHAR(50),
  execution_context JSONB DEFAULT '{}', -- Variables and state during execution
  created_by UUID REFERENCES users(id) -- For manual executions
);

-- Workflow execution history (step-by-step)
CREATE TABLE IF NOT EXISTS workflow_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_executions(id) ON DELETE CASCADE,
  node_id VARCHAR(50) NOT NULL,
  node_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'pending', 'running', 'completed', 'failed', 'skipped'
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  logs JSONB DEFAULT '[]'
);

-- Workflow templates (pre-built workflows)
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- 'incident', 'service_request', 'change', 'problem'
  icon VARCHAR(100),
  template_data JSONB NOT NULL, -- Complete workflow graph export
  is_system BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Workflow schedules (for scheduled triggers)
CREATE TABLE IF NOT EXISTS workflow_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_graphs(id) ON DELETE CASCADE,
  cron_expression VARCHAR(100) NOT NULL,
  timezone VARCHAR(50) DEFAULT 'UTC',
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  run_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for workflows
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_ticket ON workflow_executions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow ON workflow_edges(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_steps_execution ON workflow_execution_steps(execution_id);

-- ============================================================================
-- 4. EXECUTIVE COMMAND CENTER - METRICS & ANALYTICS
-- ============================================================================

-- Metric definitions
CREATE TABLE IF NOT EXISTS metric_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'sla', 'volume', 'performance', 'quality', 'business'
  description TEXT,
  data_type VARCHAR(50) NOT NULL DEFAULT 'number', -- 'number', 'percentage', 'duration', 'currency', 'count'
  unit VARCHAR(50), -- 'minutes', 'hours', 'tickets', 'dollars', '%'
  calculation_query TEXT, -- SQL query to calculate this metric
  refresh_interval_seconds INTEGER DEFAULT 60,
  alert_threshold_high FLOAT,
  alert_threshold_low FLOAT,
  alert_threshold_direction VARCHAR(20), -- 'above', 'below', 'outside_range'
  comparison_enabled BOOLEAN DEFAULT true, -- Compare to previous period
  target_value FLOAT, -- Target/benchmark value
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Cached metrics data (time-series)
CREATE TABLE IF NOT EXISTS metrics_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID REFERENCES metric_definitions(id),
  time_bucket VARCHAR(20) NOT NULL, -- '1min', '5min', '15min', '1hour', '1day', '1week'
  bucket_start TIMESTAMP NOT NULL,
  value_float FLOAT,
  value_int INTEGER,
  value_json JSONB,
  metadata JSONB DEFAULT '{}',
  calculated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(metric_id, time_bucket, bucket_start)
);

-- Dashboard definitions
CREATE TABLE IF NOT EXISTS dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  is_system BOOLEAN DEFAULT false,
  owner_id UUID REFERENCES users(id), -- NULL for system dashboards
  layout JSONB DEFAULT '[]', -- Dashboard layout configuration
  filters JSONB DEFAULT '{}', -- Default filters
  refresh_interval INTEGER DEFAULT 30, -- Auto-refresh in seconds
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Dashboard widgets
CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id UUID REFERENCES dashboards(id) ON DELETE CASCADE,
  widget_type VARCHAR(50) NOT NULL, -- 'metric_card', 'chart_line', 'chart_bar', 'chart_pie', 'heatmap', 'table', 'list'
  title VARCHAR(200),
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 4,
  height INTEGER NOT NULL DEFAULT 4,
  metric_id UUID REFERENCES metric_definitions(id),
  config JSONB DEFAULT '{}', -- Widget-specific configuration
  filters JSONB DEFAULT '{}', -- Widget-specific filters
  refresh_interval INTEGER, -- Override dashboard refresh
  created_at TIMESTAMP DEFAULT NOW()
);

-- Executive alerts
CREATE TABLE IF NOT EXISTS executive_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID REFERENCES metric_definitions(id),
  alert_type VARCHAR(50) NOT NULL, -- 'threshold_breach', 'trend_change', 'anomaly', 'target_miss'
  severity VARCHAR(50) NOT NULL, -- 'info', 'warning', 'critical'
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'acknowledged', 'resolved', 'ignored'
  message TEXT NOT NULL,
  current_value FLOAT,
  threshold_value FLOAT,
  metadata JSONB DEFAULT '{}',
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMP,
  acknowledged_note TEXT,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Alert subscriptions (who gets notified)
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID REFERENCES metric_definitions(id),
  user_id UUID REFERENCES users(id),
  notification_channels VARCHAR[] DEFAULT '{email}', -- 'email', 'sms', 'push', 'slack'
  severity_threshold VARCHAR(50) DEFAULT 'warning', -- Minimum severity to notify
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Report definitions
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  report_type VARCHAR(50) NOT NULL, -- 'executive_summary', 'team_performance', 'sla_compliance', 'custom'
  parameters JSONB DEFAULT '{}', -- Report parameters
  schedule_enabled BOOLEAN DEFAULT false,
  schedule_cron VARCHAR(100),
  last_generated_at TIMESTAMP,
  last_generated_file VARCHAR(500),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for metrics
CREATE INDEX IF NOT EXISTS idx_metrics_cache_metric ON metrics_cache(metric_id, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_cache_time ON metrics_cache(time_bucket, bucket_start DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON executive_alerts(status, severity);
CREATE INDEX IF NOT EXISTS idx_alerts_metric ON executive_alerts(metric_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id);
CREATE INDEX IF NOT EXISTS idx_widgets_dashboard ON dashboard_widgets(dashboard_id);

-- ============================================================================
-- 5. SEED DATA
-- ============================================================================

-- Insert default retention policies
INSERT INTO audit_retention_config (entity_type, retention_days, archive_enabled, archive_after_days)
VALUES 
  ('ticket', 2555, true, 365),
  ('user', 2555, true, 365),
  ('workflow', 2555, true, 730),
  ('kb', 1825, true, 365),
  ('settings', 3650, true, 1825)
ON CONFLICT (entity_type) DO NOTHING;

-- Insert default metric definitions
INSERT INTO metric_definitions (name, display_name, category, description, data_type, unit, refresh_interval_seconds)
VALUES
  ('first_response_time', 'First Response Time', 'sla', 'Average time to first response', 'duration', 'minutes', 300),
  ('resolution_time', 'Resolution Time', 'sla', 'Average time to resolution', 'duration', 'minutes', 300),
  ('sla_breach_rate', 'SLA Breach Rate', 'sla', 'Percentage of tickets breaching SLA', 'percentage', '%', 300),
  ('tickets_created', 'Tickets Created', 'volume', 'Number of tickets created', 'count', 'tickets', 60),
  ('tickets_resolved', 'Tickets Resolved', 'volume', 'Number of tickets resolved', 'count', 'tickets', 60),
  ('backlog_size', 'Backlog Size', 'volume', 'Current open tickets count', 'count', 'tickets', 60),
  ('agent_utilization', 'Agent Utilization', 'performance', 'Percentage of agent capacity used', 'percentage', '%', 300),
  ('customer_satisfaction', 'Customer Satisfaction', 'quality', 'Average customer satisfaction score', 'number', 'score', 300),
  ('reopen_rate', 'Reopen Rate', 'quality', 'Percentage of tickets reopened', 'percentage', '%', 300),
  ('first_contact_resolution', 'First Contact Resolution', 'quality', 'Percentage resolved on first contact', 'percentage', '%', 300)
ON CONFLICT (name) DO NOTHING;

-- Insert system dashboard
INSERT INTO dashboards (name, description, is_default, is_system, layout)
VALUES (
  'Executive Command Center',
  'Real-time metrics and KPIs for executive oversight',
  true,
  true,
  '[]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Insert workflow templates
INSERT INTO workflow_templates (name, description, category, icon, template_data, is_system)
VALUES
  (
    'Auto-Assign by Category',
    'Automatically assign tickets to teams based on category',
    'incident',
    'auto-assign',
    '{}'::jsonb,
    true
  ),
  (
    'SLA Breach Alert',
    'Send alerts when tickets are approaching SLA breach',
    'incident',
    'alert',
    '{}'::jsonb,
    true
  ),
  (
    'VIP Priority Boost',
    'Automatically boost priority for VIP customer tickets',
    'service_request',
    'priority',
    '{}'::jsonb,
    true
  )
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 6. FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function to update audit summary
CREATE OR REPLACE FUNCTION update_audit_summary()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_summary (entity_type, entity_id, total_changes, last_updated_at, last_updated_by)
  VALUES (NEW.entity_type, NEW.entity_id, 1, NEW.created_at, NEW.user_id)
  ON CONFLICT (entity_type, entity_id) 
  DO UPDATE SET 
    total_changes = audit_summary.total_changes + 1,
    last_updated_at = NEW.created_at,
    last_updated_by = NEW.user_id;
  
  IF NEW.action = 'viewed' THEN
    UPDATE audit_summary 
    SET total_views = total_views + 1
    WHERE entity_type = NEW.entity_type AND entity_id = NEW.entity_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for audit summary updates
DROP TRIGGER IF EXISTS audit_log_summary_trigger ON audit_logs;
CREATE TRIGGER audit_log_summary_trigger
AFTER INSERT ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION update_audit_summary();

-- Function to cleanup old audit logs
CREATE OR REPLACE FUNCTION archive_old_audit_logs()
RETURNS void AS $$
DECLARE
  retention RECORD;
BEGIN
  FOR retention IN SELECT * FROM audit_retention_config WHERE archive_enabled LOOP
    -- Move old logs to archive
    INSERT INTO audit_logs_archive 
    SELECT *, NOW() as archived_at 
    FROM audit_logs 
    WHERE entity_type = retention.entity_type 
      AND created_at < NOW() - INTERVAL '1 day' * retention.archive_after_days
      AND created_at >= NOW() - INTERVAL '1 day' * retention.retention_days;
    
    -- Delete very old logs (past retention period)
    DELETE FROM audit_logs 
    WHERE entity_type = retention.entity_type 
      AND created_at < NOW() - INTERVAL '1 day' * retention.retention_days;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup expired field locks
CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS void AS $$
BEGIN
  DELETE FROM field_locks WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup stale presence
CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS void AS $$
BEGIN
  DELETE FROM user_presence WHERE last_activity < NOW() - INTERVAL '10 minutes';
END;
$$ LANGUAGE plpgsql;
