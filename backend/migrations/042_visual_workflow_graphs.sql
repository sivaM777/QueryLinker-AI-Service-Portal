-- Migration 042: Visual Workflow Graphs (UI Workflow Builder)

-- Workflow graphs (node-edge definitions)
CREATE TABLE IF NOT EXISTS workflow_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  category_filter TEXT[] DEFAULT '{}',
  trigger_type VARCHAR(50) NOT NULL,
  trigger_config JSONB DEFAULT '{}',
  priority INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_graphs_enabled ON workflow_graphs(enabled, priority);
CREATE INDEX IF NOT EXISTS idx_workflow_graphs_trigger ON workflow_graphs(trigger_type, priority);

-- Workflow nodes
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_graphs(id) ON DELETE CASCADE,
  node_id VARCHAR(50) NOT NULL,
  type VARCHAR(50) NOT NULL,
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  width FLOAT DEFAULT 200,
  height FLOAT DEFAULT 100,
  data JSONB NOT NULL DEFAULT '{}',
  label VARCHAR(200),
  description TEXT,
  UNIQUE(workflow_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON workflow_nodes(workflow_id);

-- Workflow edges
CREATE TABLE IF NOT EXISTS workflow_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_graphs(id) ON DELETE CASCADE,
  edge_id VARCHAR(50) NOT NULL,
  source_node_id VARCHAR(50) NOT NULL,
  target_node_id VARCHAR(50) NOT NULL,
  condition VARCHAR(100),
  condition_expression TEXT,
  animated BOOLEAN DEFAULT false,
  style JSONB DEFAULT '{}',
  UNIQUE(workflow_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow ON workflow_edges(workflow_id);

-- Workflow templates
CREATE TABLE IF NOT EXISTS workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  icon VARCHAR(100),
  template_data JSONB NOT NULL,
  is_system BOOLEAN DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_templates_system ON workflow_templates(is_system);

-- Workflow execution instances for graph workflows (separate from auto-resolution workflows)
CREATE TABLE IF NOT EXISTS workflow_graph_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES workflow_graphs(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  trigger_data JSONB DEFAULT '{}',
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  current_node_id VARCHAR(50),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  logs JSONB DEFAULT '[]',
  error_message TEXT,
  execution_context JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_graph_exec_workflow ON workflow_graph_executions(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_graph_exec_ticket ON workflow_graph_executions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_workflow_graph_exec_status ON workflow_graph_executions(status, started_at DESC);

-- Step-by-step execution logs
CREATE TABLE IF NOT EXISTS workflow_graph_execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES workflow_graph_executions(id) ON DELETE CASCADE,
  node_id VARCHAR(50) NOT NULL,
  node_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error_message TEXT,
  logs JSONB DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_workflow_graph_exec_steps ON workflow_graph_execution_steps(execution_id);

