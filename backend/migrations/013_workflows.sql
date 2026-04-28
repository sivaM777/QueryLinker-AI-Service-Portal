-- Migration 013: Auto-Resolution Workflows

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_status') THEN
    CREATE TYPE workflow_status AS ENUM ('pending', 'running', 'completed', 'failed', 'skipped');
  END IF;
END$$;

-- Workflow definitions
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  
  -- Trigger conditions
  intent_filter TEXT[] NULL, -- Intents that trigger this workflow
  category_filter TEXT[] NULL, -- Categories that trigger this workflow
  keyword_filter TEXT[] NULL, -- Keywords that must be present
  
  -- Workflow steps (JSONB array)
  steps JSONB NOT NULL DEFAULT '[]', -- Array of step definitions
  
  -- Actions
  auto_resolve BOOLEAN NOT NULL DEFAULT false, -- Auto-close ticket if workflow succeeds
  create_ticket BOOLEAN NOT NULL DEFAULT false, -- Create ticket if workflow fails
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled, priority) WHERE enabled = true;

-- Workflow executions
CREATE TABLE IF NOT EXISTS workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  ticket_id UUID NULL REFERENCES tickets(id) ON DELETE SET NULL,
  session_id UUID NULL REFERENCES chatbot_sessions(id) ON DELETE SET NULL,
  status workflow_status NOT NULL DEFAULT 'pending',
  current_step INTEGER NOT NULL DEFAULT 0,
  input_data JSONB NOT NULL DEFAULT '{}',
  output_data JSONB NULL,
  error_message TEXT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_ticket ON workflow_executions(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status, started_at) WHERE status IN ('pending', 'running');

-- Workflow step results
CREATE TABLE IF NOT EXISTS workflow_step_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL, -- 'api_call', 'ldap_query', 'script', 'approval', etc.
  status TEXT NOT NULL, -- 'success', 'failed', 'skipped'
  input_data JSONB NULL,
  output_data JSONB NULL,
  error_message TEXT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_results_execution ON workflow_step_results(execution_id, step_index);
