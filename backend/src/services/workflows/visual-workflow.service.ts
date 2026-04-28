import { pool } from "../../config/db.js";
import { broadcastWorkflowUpdate } from "../../websocket/socket-server.js";
import { sendMail } from "../tickets/ticket.service.js";
import { insertNotification, type NotificationType } from "../notifications/notification.service.js";

export const VISUAL_WORKFLOW_NODE_TYPES = [
  "trigger",
  "start",
  "end",
  "action",
  "condition",
  "delay",
  "notification",
] as const;

export type VisualWorkflowNodeType = (typeof VISUAL_WORKFLOW_NODE_TYPES)[number];

const AUTO_TRIGGER_TYPES = ["ticket_created", "ticket_updated", "scheduled", "api"] as const;
type AutoTriggerType = (typeof AUTO_TRIGGER_TYPES)[number];
type ExecuteTriggerOptions = {
  triggerType: AutoTriggerType;
  ticketId: string;
  category?: string | null;
  triggerData?: Record<string, any>;
  userId?: string;
};

let scheduledWorkflowTimer: NodeJS.Timeout | null = null;
let scheduledWorkflowRunInFlight = false;
const SCHEDULED_WORKFLOW_POLL_MS = 30_000;

export interface WorkflowNode {
  id: string;
  type: VisualWorkflowNodeType;
  position: { x: number; y: number };
  data: {
    label?: string;
    description?: string;
    actionType?: string;
    config?: Record<string, any>;
  };
}

type TemplateRecord = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  template_data: Record<string, any>;
  is_system: boolean;
  created_by: string | null;
  created_at: Date;
};

type ExecutionRecordRow = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  ticket_id: string | null;
  ticket_title: string | null;
  status: string;
  current_node_id: string | null;
  started_at: Date;
  completed_at: Date | null;
  error_message: string | null;
  trigger_data: Record<string, any> | null;
  execution_context: Record<string, any> | null;
};

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition?: string;
  animated?: boolean;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  categoryFilter: string[];
  triggerType: string;
  triggerConfig?: Record<string, any>;
  priority: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  ticketId?: string;
  status: "running" | "completed" | "failed" | "cancelled" | "paused";
  currentNodeId?: string;
  startedAt: Date;
  completedAt?: Date;
  logs: ExecutionLog[];
  errorMessage?: string;
  executionContext: Record<string, any>;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  versionNumber: number;
  snapshot: WorkflowGraph;
  changeSummary?: string | null;
  createdBy?: string | null;
  createdAt: Date;
}

export interface WorkflowExecutionStepDetail {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  startedAt: Date;
  completedAt?: Date | null;
  inputData?: Record<string, any> | null;
  outputData?: Record<string, any> | null;
  errorMessage?: string | null;
  logs?: Record<string, any>[] | null;
}

export interface WorkflowExecutionDetail {
  id: string;
  workflowId: string;
  workflowName: string;
  ticketId?: string | null;
  ticketTitle?: string | null;
  status: string;
  currentNodeId?: string | null;
  startedAt: Date;
  completedAt?: Date | null;
  errorMessage?: string | null;
  triggerData?: Record<string, any>;
  executionContext?: Record<string, any>;
  steps: WorkflowExecutionStepDetail[];
}

export interface ExecutionLog {
  timestamp: string;
  nodeId: string;
  nodeType: string;
  status: string;
  message: string;
  data?: any;
}

/**
 * Create a new visual workflow
 */
export async function createWorkflow(
  workflow: Omit<WorkflowGraph, "id" | "createdAt" | "updatedAt">
): Promise<WorkflowGraph> {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Insert workflow
    const workflowResult = await client.query(
      `INSERT INTO workflow_graphs 
       (name, description, enabled, category_filter, trigger_type, trigger_config, priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at, updated_at`,
      [
        workflow.name,
        workflow.description,
        workflow.enabled,
        workflow.categoryFilter,
        workflow.triggerType,
        JSON.stringify(workflow.triggerConfig || {}),
        workflow.priority,
        workflow.createdBy,
      ]
    );

    const workflowId = workflowResult.rows[0].id;
    const createdAt = workflowResult.rows[0].created_at;
    const updatedAt = workflowResult.rows[0].updated_at;

    // Insert nodes
    for (const node of workflow.nodes) {
      await client.query(
        `INSERT INTO workflow_nodes 
         (workflow_id, node_id, type, position_x, position_y, data, label, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          workflowId,
          node.id,
          node.type,
          node.position.x,
          node.position.y,
          JSON.stringify(node.data),
          node.data.label,
          node.data.description,
        ]
      );
    }

    // Insert edges
    for (const edge of workflow.edges) {
      await client.query(
        `INSERT INTO workflow_edges 
         (workflow_id, edge_id, source_node_id, target_node_id, condition, animated)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          workflowId,
          edge.id,
          edge.source,
          edge.target,
          edge.condition,
          edge.animated || false,
        ]
      );
    }

    await client.query("COMMIT");

    const createdWorkflow: WorkflowGraph = {
      ...workflow,
      id: workflowId,
      createdAt,
      updatedAt,
    };

    await createWorkflowVersionRecord({
      workflowId,
      snapshot: createdWorkflow,
      userId: workflow.createdBy,
      changeSummary: "Initial version",
    });

    return createdWorkflow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get workflow by ID with all nodes and edges
 */
export async function getWorkflow(id: string): Promise<WorkflowGraph | null> {
  // Get workflow
  const workflowResult = await pool.query(
    `SELECT * FROM workflow_graphs WHERE id = $1`,
    [id]
  );

  if (workflowResult.rows.length === 0) {
    return null;
  }

  const workflow = workflowResult.rows[0];

  // Get nodes
  const nodesResult = await pool.query(
    `SELECT node_id as id, type, position_x as x, position_y as y, data, label, description
     FROM workflow_nodes WHERE workflow_id = $1`,
    [id]
  );

  const nodes = nodesResult.rows.map((row) => ({
    id: row.id,
    type: row.type,
    position: { x: row.x, y: row.y },
    data: {
      ...row.data,
      label: row.label,
      description: row.description,
    },
  }));

  // Get edges
  const edgesResult = await pool.query(
    `SELECT edge_id as id, source_node_id as source, target_node_id as target, 
            condition, animated
     FROM workflow_edges WHERE workflow_id = $1`,
    [id]
  );

  const edges = edgesResult.rows.map((row) => ({
    id: row.id,
    source: row.source,
    target: row.target,
    condition: row.condition,
    animated: row.animated,
  }));

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    enabled: workflow.enabled,
    categoryFilter: workflow.category_filter || [],
    triggerType: workflow.trigger_type,
    triggerConfig: workflow.trigger_config,
    priority: workflow.priority,
    nodes,
    edges,
    createdBy: workflow.created_by,
    updatedBy: workflow.updated_by,
    createdAt: workflow.created_at,
    updatedAt: workflow.updated_at,
  };
}

/**
 * Update workflow
 */
export async function updateWorkflow(
  id: string,
  updates: Partial<WorkflowGraph>,
  userId: string
): Promise<WorkflowGraph | null> {
  const client = await pool.connect();
  
  try {
    const currentWorkflow = await getWorkflow(id);
    if (!currentWorkflow) {
      return null;
    }

    await client.query("BEGIN");

    // Update workflow metadata
    const setClause: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClause.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClause.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      setClause.push(`enabled = $${paramIndex++}`);
      values.push(updates.enabled);
    }
    if (updates.categoryFilter !== undefined) {
      setClause.push(`category_filter = $${paramIndex++}`);
      values.push(updates.categoryFilter);
    }
    if (updates.triggerType !== undefined) {
      setClause.push(`trigger_type = $${paramIndex++}`);
      values.push(updates.triggerType);
    }
    if (updates.triggerConfig !== undefined) {
      setClause.push(`trigger_config = $${paramIndex++}`);
      values.push(JSON.stringify(updates.triggerConfig));
    }
    if (updates.priority !== undefined) {
      setClause.push(`priority = $${paramIndex++}`);
      values.push(updates.priority);
    }

    setClause.push(`updated_by = $${paramIndex++}`);
    values.push(userId);
    setClause.push(`updated_at = NOW()`);

    values.push(id);

    if (setClause.length > 0) {
      await client.query(
        `UPDATE workflow_graphs SET ${setClause.join(", ")} WHERE id = $${paramIndex}`,
        values
      );
    }

    // Update nodes if provided
    if (updates.nodes) {
      // Delete existing nodes
      await client.query(`DELETE FROM workflow_nodes WHERE workflow_id = $1`, [id]);

      // Insert new nodes
      for (const node of updates.nodes) {
        await client.query(
          `INSERT INTO workflow_nodes 
           (workflow_id, node_id, type, position_x, position_y, data, label, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            node.id,
            node.type,
            node.position.x,
            node.position.y,
            JSON.stringify(node.data),
            node.data.label,
            node.data.description,
          ]
        );
      }
    }

    // Update edges if provided
    if (updates.edges) {
      // Delete existing edges
      await client.query(`DELETE FROM workflow_edges WHERE workflow_id = $1`, [id]);

      // Insert new edges
      for (const edge of updates.edges) {
        await client.query(
          `INSERT INTO workflow_edges 
           (workflow_id, edge_id, source_node_id, target_node_id, condition, animated)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            id,
            edge.id,
            edge.source,
            edge.target,
            edge.condition,
            edge.animated || false,
          ]
        );
      }
    }

    await client.query("COMMIT");

    const updatedWorkflow = await getWorkflow(id);
    if (updatedWorkflow) {
      await createWorkflowVersionRecord({
        workflowId: id,
        snapshot: updatedWorkflow,
        userId,
        changeSummary: buildWorkflowChangeSummary(currentWorkflow, updates),
      });
    }

    return updatedWorkflow;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List all workflows
 */
export async function listWorkflows(filters?: {
  enabled?: boolean;
  category?: string;
  triggerType?: string;
}): Promise<WorkflowGraph[]> {
  let query = `SELECT * FROM workflow_graphs WHERE 1=1`;
  const values: any[] = [];
  let paramIndex = 1;

  if (filters?.enabled !== undefined) {
    query += ` AND enabled = $${paramIndex++}`;
    values.push(filters.enabled);
  }

  if (filters?.category) {
    query += ` AND $${paramIndex++} = ANY(category_filter)`;
    values.push(filters.category);
  }

  if (filters?.triggerType) {
    query += ` AND trigger_type = $${paramIndex++}`;
    values.push(filters.triggerType);
  }

  query += ` ORDER BY priority DESC, created_at ASC`;

  const result = await pool.query(query, values);

  const workflows: WorkflowGraph[] = [];
  for (const row of result.rows) {
    const workflow = await getWorkflow(row.id);
    if (workflow) workflows.push(workflow);
  }

  return workflows;
}

/**
 * Delete workflow
 */
export async function deleteWorkflow(id: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM workflow_graphs WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows.length > 0;
}

export async function listWorkflowVersions(workflowId: string): Promise<WorkflowVersion[]> {
  const result = await pool.query<{
    id: string;
    workflow_id: string;
    version_number: number;
    snapshot: WorkflowGraph;
    change_summary: string | null;
    created_by: string | null;
    created_at: Date;
  }>(
    `SELECT id, workflow_id, version_number, snapshot, change_summary, created_by, created_at
     FROM workflow_graph_versions
     WHERE workflow_id = $1
     ORDER BY version_number DESC`,
    [workflowId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    changeSummary: row.change_summary,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

export async function restoreWorkflowVersion(workflowId: string, versionId: string, userId: string): Promise<WorkflowGraph | null> {
  const result = await pool.query<{
    snapshot: WorkflowGraph;
    version_number: number;
  }>(
    `SELECT snapshot, version_number
     FROM workflow_graph_versions
     WHERE id = $1 AND workflow_id = $2`,
    [versionId, workflowId]
  );

  const version = result.rows[0];
  if (!version) return null;

  return updateWorkflow(
    workflowId,
    {
      name: version.snapshot.name,
      description: version.snapshot.description,
      enabled: version.snapshot.enabled,
      categoryFilter: version.snapshot.categoryFilter,
      triggerType: version.snapshot.triggerType,
      triggerConfig: version.snapshot.triggerConfig,
      priority: version.snapshot.priority,
      nodes: version.snapshot.nodes,
      edges: version.snapshot.edges,
    },
    userId
  );
}

export async function listWorkflowTemplates(userId?: string): Promise<TemplateRecord[]> {
  const result = await pool.query<TemplateRecord>(
    `SELECT id, name, description, category, icon, template_data, is_system, created_by, created_at
     FROM workflow_templates
     WHERE is_system = true OR created_by = $1
     ORDER BY is_system DESC, created_at DESC, name ASC`,
    [userId || null]
  );
  return result.rows;
}

export async function createWorkflowTemplate(args: {
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  templateData: Record<string, any>;
  createdBy?: string;
}): Promise<TemplateRecord> {
  const result = await pool.query<TemplateRecord>(
    `INSERT INTO workflow_templates
      (name, description, category, icon, template_data, is_system, created_by)
     VALUES ($1, $2, $3, $4, $5, false, $6)
     RETURNING id, name, description, category, icon, template_data, is_system, created_by, created_at`,
    [
      args.name,
      args.description || null,
      args.category || null,
      args.icon || null,
      JSON.stringify(args.templateData),
      args.createdBy || null,
    ]
  );
  return result.rows[0]!;
}

async function createWorkflowVersionRecord(args: {
  workflowId: string;
  snapshot: WorkflowGraph;
  userId?: string;
  changeSummary?: string | null;
}) {
  const nextVersionRes = await pool.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM workflow_graph_versions
     WHERE workflow_id = $1`,
    [args.workflowId]
  );

  const versionNumber = nextVersionRes.rows[0]?.next_version ?? 1;

  await pool.query(
    `INSERT INTO workflow_graph_versions
      (workflow_id, version_number, snapshot, change_summary, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      args.workflowId,
      versionNumber,
      JSON.stringify(args.snapshot),
      args.changeSummary || null,
      args.userId || null,
    ]
  );
}

function buildWorkflowChangeSummary(previous: WorkflowGraph, updates: Partial<WorkflowGraph>) {
  const changes: string[] = [];

  if (updates.name !== undefined && updates.name !== previous.name) changes.push("name updated");
  if (updates.description !== undefined && updates.description !== previous.description) changes.push("description updated");
  if (updates.enabled !== undefined && updates.enabled !== previous.enabled) changes.push(updates.enabled ? "workflow enabled" : "workflow paused");
  if (updates.triggerType !== undefined && updates.triggerType !== previous.triggerType) changes.push(`trigger set to ${updates.triggerType}`);
  if (updates.triggerConfig !== undefined) changes.push("trigger settings updated");
  if (updates.nodes !== undefined) changes.push("canvas nodes updated");
  if (updates.edges !== undefined) changes.push("workflow connections updated");

  return changes.length ? changes.join(", ") : "Workflow updated";
}

/**
 * Execute workflow for a ticket
 */
export async function executeWorkflow(
  workflowId: string,
  ticketId: string,
  triggerData: Record<string, any>,
  userId?: string
): Promise<WorkflowExecution> {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

    // Create execution record
    const executionResult = await client.query(
      `INSERT INTO workflow_graph_executions 
       (workflow_id, ticket_id, trigger_data, status, execution_context, created_by)
       VALUES ($1, $2, $3, 'running', $4, $5)
       RETURNING id, started_at`,
      [
        workflowId,
        ticketId,
        JSON.stringify(triggerData),
        JSON.stringify({ triggerData, ticketId, userId }),
        userId,
      ]
    );

    const executionId = executionResult.rows[0].id;
    const startedAt = executionResult.rows[0].started_at;

    await client.query("COMMIT");

    // Start execution asynchronously
    processWorkflowExecution(executionId, workflowId, ticketId);

    return {
      id: executionId,
      workflowId,
      ticketId,
      status: "running",
      startedAt,
      logs: [],
      executionContext: { triggerData, ticketId },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function executeTriggeredWorkflows(options: ExecuteTriggerOptions): Promise<WorkflowExecution[]> {
  const workflows = await listWorkflows({
    enabled: true,
    triggerType: options.triggerType,
    category: options.category || undefined,
  });

  const eligible = workflows.filter((workflow) => {
    const filters = Array.isArray(workflow.categoryFilter) ? workflow.categoryFilter : [];
    if (!filters.length) return true;
    if (!options.category) return false;
    return filters.includes(options.category);
  });

  const executions = await Promise.allSettled(
    eligible.map((workflow) =>
      executeWorkflow(
        workflow.id,
        options.ticketId,
        {
          ...(options.triggerData || {}),
          triggerType: options.triggerType,
          workflowId: workflow.id,
        },
        options.userId
      )
    )
  );

  return executions
    .filter((result): result is PromiseFulfilledResult<WorkflowExecution> => result.status === "fulfilled")
    .map((result) => result.value);
}

export async function runScheduledWorkflowScan(): Promise<void> {
  if (scheduledWorkflowRunInFlight) return;
  scheduledWorkflowRunInFlight = true;

  try {
    const workflows = await listWorkflows({ enabled: true, triggerType: "scheduled" });

    for (const workflow of workflows) {
      const triggerConfig = (workflow.triggerConfig || {}) as Record<string, any>;
      const ticketId = String(
        triggerConfig.ticketId ||
          triggerConfig.targetTicketId ||
          triggerConfig.contextTicketId ||
          ""
      ).trim();
      if (!ticketId) continue;

      const intervalMinutes = Math.max(
        1,
        Math.min(Number(triggerConfig.intervalMinutes ?? triggerConfig.everyMinutes ?? 60), 24 * 60)
      );

      const lastRunRes = await pool.query<{ started_at: Date }>(
        `SELECT started_at
         FROM workflow_graph_executions
         WHERE workflow_id = $1
         ORDER BY started_at DESC
         LIMIT 1`,
        [workflow.id]
      );

      const lastRunAt = lastRunRes.rows[0]?.started_at ? new Date(lastRunRes.rows[0].started_at).getTime() : 0;
      const now = Date.now();
      if (lastRunAt && now - lastRunAt < intervalMinutes * 60 * 1000) {
        continue;
      }

      await executeWorkflow(
        workflow.id,
        ticketId,
        {
          ...(triggerConfig.payload && typeof triggerConfig.payload === "object" ? triggerConfig.payload : {}),
          triggerType: "scheduled",
          scheduledAt: new Date(now).toISOString(),
        },
        workflow.updatedBy || workflow.createdBy
      );
    }
  } catch (error) {
    console.error("Scheduled workflow scan failed:", error);
  } finally {
    scheduledWorkflowRunInFlight = false;
  }
}

export function startScheduledWorkflowRunner() {
  if (scheduledWorkflowTimer) return;
  scheduledWorkflowTimer = setInterval(() => {
    void runScheduledWorkflowScan();
  }, SCHEDULED_WORKFLOW_POLL_MS);
  void runScheduledWorkflowScan();
}

export async function getWorkflowExecutionDetail(executionId: string): Promise<WorkflowExecutionDetail | null> {
  const executionResult = await pool.query<ExecutionRecordRow>(
    `SELECT
       exec.id,
       exec.workflow_id,
       wf.name AS workflow_name,
       exec.ticket_id,
       ticket.title AS ticket_title,
       exec.status,
       exec.current_node_id,
       exec.started_at,
       exec.completed_at,
       exec.error_message,
       exec.trigger_data,
       exec.execution_context
     FROM workflow_graph_executions exec
     JOIN workflow_graphs wf ON wf.id = exec.workflow_id
     LEFT JOIN tickets ticket ON ticket.id = exec.ticket_id
     WHERE exec.id = $1`,
    [executionId]
  );

  const execution = executionResult.rows[0];
  if (!execution) return null;

  const stepsResult = await pool.query<{
    id: string;
    node_id: string;
    node_type: string;
    status: string;
    started_at: Date;
    completed_at: Date | null;
    input_data: Record<string, any> | null;
    output_data: Record<string, any> | null;
    error_message: string | null;
    logs: Record<string, any>[] | null;
  }>(
    `SELECT
       id,
       node_id,
       node_type,
       status,
       started_at,
       completed_at,
       input_data,
       output_data,
       error_message,
       logs
     FROM workflow_graph_execution_steps
     WHERE execution_id = $1
     ORDER BY started_at ASC`,
    [executionId]
  );

  return {
    id: execution.id,
    workflowId: execution.workflow_id,
    workflowName: execution.workflow_name,
    ticketId: execution.ticket_id,
    ticketTitle: execution.ticket_title,
    status: execution.status,
    currentNodeId: execution.current_node_id,
    startedAt: execution.started_at,
    completedAt: execution.completed_at,
    errorMessage: execution.error_message,
    triggerData: execution.trigger_data || {},
    executionContext: execution.execution_context || {},
    steps: stepsResult.rows.map((step) => ({
      id: step.id,
      nodeId: step.node_id,
      nodeType: step.node_type,
      status: step.status,
      startedAt: step.started_at,
      completedAt: step.completed_at,
      inputData: step.input_data,
      outputData: step.output_data,
      errorMessage: step.error_message,
      logs: step.logs,
    })),
  };
}

/**
 * Process workflow execution (async)
 */
async function processWorkflowExecution(
  executionId: string,
  workflowId: string,
  ticketId: string
): Promise<void> {
  try {
    const workflow = await getWorkflow(workflowId);
    if (!workflow) {
      throw new Error("Workflow not found");
    }

    // Find trigger node
      const triggerNode = workflow.nodes.find((n) => n.type === "trigger" || n.type === "start");
    if (!triggerNode) {
      throw new Error("No start node found");
    }

    // Execute nodes in order
    const visited = new Set<string>();
    const queue = [triggerNode.id];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = workflow.nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      // Update current node
      await pool.query(
        `UPDATE workflow_graph_executions SET current_node_id = $1 WHERE id = $2`,
        [nodeId, executionId]
      );

      // Execute node
      const stepResult = await executeNode(executionId, node, ticketId);

      // Broadcast update
      broadcastWorkflowUpdate(executionId, {
        nodeId,
        status: stepResult.status,
        message: stepResult.message,
      });

      if (stepResult.status === "failed") {
        await pool.query(
          `UPDATE workflow_graph_executions 
           SET status = 'failed', error_message = $1, completed_at = NOW()
           WHERE id = $2`,
          [stepResult.message, executionId]
        );
        return;
      }

      // Find next nodes
      const outgoingEdges = workflow.edges.filter((e) => e.source === nodeId);
      for (const edge of outgoingEdges) {
        if (node.type === "condition") {
          const branchValue = typeof edge.condition === "string" ? edge.condition.trim().toLowerCase() : "";
          const conditionMet = Boolean(stepResult.output?.conditionMet);
          if (branchValue === "true" || branchValue === "yes" || branchValue === "matched" || branchValue === "success") {
            if (!conditionMet) continue;
          } else if (branchValue === "false" || branchValue === "no" || branchValue === "unmatched" || branchValue === "failure") {
            if (conditionMet) continue;
          } else if (edge.condition && edge.condition !== "always") {
            const branchMatches = await evaluateCondition(edge.condition, {
              ticketId,
              previousOutput: stepResult.output,
              nodeData: node.data,
            });
            if (!branchMatches) continue;
          }
        } else if (edge.condition && edge.condition !== "always") {
          const conditionMet = await evaluateCondition(edge.condition, {
            ticketId,
            previousOutput: stepResult.output,
            nodeData: node.data,
          });
          if (!conditionMet) continue;
        }
        queue.push(edge.target);
      }
    }

    // Mark as completed
    await pool.query(
      `UPDATE workflow_graph_executions 
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1`,
      [executionId]
    );

    broadcastWorkflowUpdate(executionId, {
      status: "completed",
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Workflow execution failed:", error);
    await pool.query(
      `UPDATE workflow_graph_executions 
       SET status = 'failed', error_message = $1, completed_at = NOW()
       WHERE id = $2`,
      [error instanceof Error ? error.message : "Unknown error", executionId]
    );

    broadcastWorkflowUpdate(executionId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Execute a single node
 */
async function executeNode(
  executionId: string,
  node: WorkflowNode,
  ticketId: string
): Promise<{ status: string; message: string; output?: any }> {
  const stepStart = new Date();

  try {
    let result: any;

    switch (node.type) {
      case "start":
      case "trigger":
        result = { success: true, message: "Trigger accepted" };
        break;

      case "end":
        result = { success: true, message: "Workflow reached end node" };
        break;

      case "condition":
        result = await executeConditionNode(ticketId, node.data);
        break;

      case "delay":
        result = await executeDelayNode(node.data);
        break;

      case "notification":
        result = await executeCreateNotification(ticketId, node.data.config || node.data);
        break;

      default:
        switch (node.data.actionType) {
          case "assign_ticket":
            result = await executeAssignTicket(ticketId, node.data.config);
            break;
          case "set_priority":
            result = await executeSetPriority(ticketId, node.data.config);
            break;
          case "send_email":
            result = await executeSendEmail(ticketId, node.data.config);
            break;
          case "add_comment":
            result = await executeAddComment(ticketId, node.data.config);
            break;
          case "create_notification":
            result = await executeCreateNotification(ticketId, node.data.config);
            break;
          case "wait_for_condition":
            result = await executeWaitCondition(ticketId, node.data.config);
            break;
          case "webhook":
            result = await executeWebhook(ticketId, node.data.config);
            break;
          default:
            result = { success: true, message: "No action specified" };
        }
    }

    // Log step
    await pool.query(
      `INSERT INTO workflow_graph_execution_steps 
       (execution_id, node_id, node_type, status, started_at, completed_at, output_data)
       VALUES ($1, $2, $3, 'completed', $4, NOW(), $5)`,
      [executionId, node.id, node.type, stepStart, JSON.stringify(result)]
    );

    return {
      status: "completed",
      message: result.message || "Success",
      output: result,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Log failed step
    await pool.query(
      `INSERT INTO workflow_graph_execution_steps 
       (execution_id, node_id, node_type, status, started_at, completed_at, error_message)
       VALUES ($1, $2, $3, 'failed', $4, NOW(), $5)`,
      [executionId, node.id, node.type, stepStart, errorMessage]
    );

    return {
      status: "failed",
      message: errorMessage,
    };
  }
}

/**
 * Evaluate condition expression
 */
async function evaluateCondition(
  condition: string,
  context: any
): Promise<boolean> {
  try {
    const normalized = String(condition || "").trim();
    if (!normalized) return true;
    if (normalized === "true") return true;
    if (normalized === "false") return false;

    const ticketContext = context?.ticketId ? await getTicketRuntimeContext(context.ticketId) : null;
    const previousOutput = context?.previousOutput || {};
    const nodeData = context?.nodeData || {};

    const sources: Record<string, Record<string, any>> = {
      ticket: ticketContext || {},
      output: previousOutput,
      node: nodeData,
    };

    const expressionMatch = normalized.match(
      /^(?:(ticket|output|node)\.)?([a-zA-Z0-9_]+)\s*(===|==|!==|!=|>=|<=|>|<|contains|includes)\s*(.+)$/
    );

    if (expressionMatch) {
      const [, sourceKeyRaw, field, operator, rawExpected] = expressionMatch;
      const sourceKey = (sourceKeyRaw || "ticket").toLowerCase();
      const leftValue = sources[sourceKey]?.[field];
      const rightValue = parseConditionValue(rawExpected);
      return compareConditionValues(leftValue, rightValue, operator);
    }

    if (normalized.includes(".")) {
      const [sourceKey, field] = normalized.split(".", 2);
      return Boolean(sources[sourceKey]?.[field]);
    }

    return Boolean(ticketContext?.[normalized as keyof typeof ticketContext]);
  } catch (error) {
    console.error("Condition evaluation failed:", error);
    return false;
  }
}

async function getTicketRuntimeContext(ticketId: string): Promise<Record<string, any> | null> {
  const result = await pool.query<Record<string, any>>(
    `SELECT
       id,
       display_number,
       title,
       description,
       type,
       status,
       priority,
       category,
       assigned_agent,
       assigned_team,
       created_by,
       current_support_level
     FROM tickets
     WHERE id = $1`,
    [ticketId]
  );

  return result.rows[0] ?? null;
}

function parseConditionValue(rawValue: string): any {
  const trimmed = rawValue.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && trimmed !== "") return asNumber;
  return trimmed;
}

function compareConditionValues(leftValue: any, rightValue: any, operator: string): boolean {
  switch (operator) {
    case "===":
    case "==":
      return leftValue == rightValue;
    case "!==":
    case "!=":
      return leftValue != rightValue;
    case ">":
      return Number(leftValue) > Number(rightValue);
    case ">=":
      return Number(leftValue) >= Number(rightValue);
    case "<":
      return Number(leftValue) < Number(rightValue);
    case "<=":
      return Number(leftValue) <= Number(rightValue);
    case "contains":
    case "includes":
      if (Array.isArray(leftValue)) return leftValue.includes(rightValue);
      return String(leftValue ?? "").toLowerCase().includes(String(rightValue ?? "").toLowerCase());
    default:
      return false;
  }
}

async function executeConditionNode(
  ticketId: string,
  data: WorkflowNode["data"]
): Promise<any> {
  const expression = data?.config?.expression || (data as Record<string, any>)?.expression || "true";
  const conditionMet = await evaluateCondition(expression, { ticketId, nodeData: data });
  return {
    success: true,
    message: conditionMet ? "Condition matched" : "Condition did not match",
    conditionMet,
    expression,
  };
}

async function executeDelayNode(data: WorkflowNode["data"]): Promise<any> {
  const rawSeconds = Number(data?.config?.durationSeconds ?? (data as Record<string, any>)?.durationSeconds ?? (data as Record<string, any>)?.duration ?? 0);
  const durationSeconds = Math.max(0, Math.min(rawSeconds, 900));
  if (durationSeconds > 0) {
    await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
  }
  return {
    success: true,
    message: durationSeconds > 0 ? `Paused for ${durationSeconds} seconds` : "No delay configured",
    durationSeconds,
  };
}

// Action implementations
async function executeAssignTicket(
  ticketId: string,
  config: any
): Promise<any> {
  const assignedAgent = config?.assignedAgentId || config?.assigneeId || null;
  const assignedTeam = config?.assignedTeamId || config?.teamId || null;

  await pool.query(
    `UPDATE tickets SET assigned_agent = $1, assigned_team = $2, updated_at = NOW() WHERE id = $3`,
    [assignedAgent, assignedTeam, ticketId]
  );

  return { success: true, message: `Ticket assigned to ${assignedAgent || assignedTeam}` };
}

async function executeSetPriority(
  ticketId: string,
  config: any
): Promise<any> {
  const { priority } = config;

  await pool.query(
    `UPDATE tickets SET priority = $1, updated_at = NOW() WHERE id = $2`,
    [priority, ticketId]
  );

  return { success: true, message: `Priority set to ${priority}` };
}

async function executeSendEmail(
  ticketId: string,
  config: any
): Promise<any> {
  const { to, subject, body, message } = config || {};

  let recipient = to;
  if (!recipient) {
    const res = await pool.query<{ email: string }>(
      `SELECT u.email
       FROM tickets t
       JOIN users u ON u.id = t.created_by
       WHERE t.id = $1`,
      [ticketId]
    );
    recipient = res.rows[0]?.email;
  }

  if (!recipient) {
    return { success: false, message: "No recipient available for email" };
  }

  await sendMail({
    to: recipient,
    subject: subject || "Workflow notification",
    text: body || message || "This is an automated workflow notification.",
  });

  return { success: true, message: `Email sent to ${recipient}` };
}

async function executeAddComment(
  ticketId: string,
  config: any
): Promise<any> {
  const body = config?.body || config?.content || "";
  const isInternal = Boolean(config?.isInternal);
  const authorId = config?.authorId || null;

  let finalAuthorId = authorId;
  if (!finalAuthorId) {
    const res = await pool.query<{ created_by: string }>(
      "SELECT created_by FROM tickets WHERE id = $1",
      [ticketId]
    );
    finalAuthorId = res.rows[0]?.created_by || null;
  }

  if (!finalAuthorId) {
    return { success: false, message: "No author available for comment" };
  }

  await pool.query(
    `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [ticketId, finalAuthorId, body, isInternal]
  );

  return { success: true, message: "Comment added" };
}

async function executeCreateNotification(
  ticketId: string,
  config: any
): Promise<any> {
  const { userId, recipientMode, type, title, body, message, actionUrl } = config || {};
  const safeType = normalizeNotificationType(type);

  const finalTitle = title || "Workflow notification";
  const finalBody = body || message || "Workflow generated a notification.";
  const finalUserId = userId || (await resolveNotificationRecipient(ticketId, recipientMode));

  if (!finalUserId) {
    return { success: false, message: "No notification recipient available" };
  }

  await insertNotification({
    userId: finalUserId,
    ticketId,
      type: safeType,
    title: finalTitle,
    body: finalBody,
    actionUrl: actionUrl || null,
  });

  return { success: true, message: "Notification created" };
}

function normalizeNotificationType(value: unknown): NotificationType {
  const input = String(value || "").trim();
  const supported = new Set<NotificationType>([
    "TICKET_CREATED",
    "TICKET_ASSIGNED",
    "TICKET_STATUS_CHANGED",
    "TICKET_COMMENTED",
    "TICKET_SLA_RISK",
    "TICKET_ESCALATED",
    "SLA_FIRST_RESPONSE_BREACH",
    "SLA_RESOLUTION_BREACH",
    "APPROVAL_REQUESTED",
  ]);
  return supported.has(input as NotificationType) ? (input as NotificationType) : "TICKET_STATUS_CHANGED";
}

async function executeWaitCondition(
  ticketId: string,
  config: any
): Promise<any> {
  const condition = config?.condition || "true";
  const timeoutMs = Math.max(5_000, Math.min(Number(config?.timeoutMs ?? config?.timeout ?? 60_000), 900_000));
  const pollMs = Math.max(1_000, Math.min(Number(config?.pollIntervalMs ?? 5_000), 30_000));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const met = await evaluateCondition(condition, { ticketId });
    if (met) {
      return { success: true, message: "Condition met", waitedMs: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Condition wait timed out");
}

async function executeWebhook(
  ticketId: string,
  config: any
): Promise<any> {
  const { url, method, headers, body } = config || {};

  if (!url) {
    return { success: false, message: "Webhook URL not provided" };
  }

  const response = await fetch(url, {
    method: method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Webhook failed: ${errorText}`);
  }

  return { success: true, message: `Webhook called: ${url}` };
}

async function resolveNotificationRecipient(
  ticketId: string,
  recipientMode?: string
): Promise<string | null> {
  const target = String(recipientMode || "requester").toLowerCase();
  const result = await pool.query<{
    requester_id: string | null;
    assigned_agent_id: string | null;
    team_manager_id: string | null;
  }>(
    `SELECT
       t.created_by AS requester_id,
       t.assigned_agent AS assigned_agent_id,
       team.manager_id AS team_manager_id
     FROM tickets t
     LEFT JOIN teams team ON team.id = t.assigned_team
     WHERE t.id = $1`,
    [ticketId]
  );

  const row = result.rows[0];
  if (!row) return null;

  switch (target) {
    case "assigned_agent":
      return row.assigned_agent_id || row.requester_id || null;
    case "team_manager":
      return row.team_manager_id || row.assigned_agent_id || row.requester_id || null;
    case "requester":
    default:
      return row.requester_id || null;
  }
}
