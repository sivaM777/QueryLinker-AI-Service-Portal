-- Auto-fix workflow steps for KB content
-- Store executed workflow steps with professional tutorial descriptions

CREATE TABLE IF NOT EXISTS workflow_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  step_name TEXT NOT NULL,
  step_description TEXT NOT NULL,
  step_config JSONB,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL,
  output_data JSONB
);

CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_execution_id ON workflow_execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_executed_at ON workflow_execution_steps(executed_at);
