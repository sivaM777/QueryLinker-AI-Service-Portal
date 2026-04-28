import { pool } from "../../config/db.js";
import { updateTicketStatus } from "../tickets/ticket.service.js";
import { createApprovalRequest } from "../approvals/approval.service.js";

async function getSystemPerformerId(ticketId?: string): Promise<string | null> {
  try {
    const admin = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at ASC LIMIT 1"
    );
    if (admin.rows[0]?.id) return admin.rows[0].id;

    if (ticketId) {
      const t = await pool.query<{ created_by: string }>("SELECT created_by FROM tickets WHERE id = $1", [ticketId]);
      if (t.rows[0]?.created_by) return t.rows[0].created_by;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Generate professional tutorial description for a workflow step
 */
function generateStepDescription(step: WorkflowStep, stepResult: any): string {
  const { type, name, config } = step;

  if (typeof config?.ui_description === "string" && config.ui_description.trim()) {
    return config.ui_description.trim();
  }

  switch (type) {
    case "approval":
      if (config.approver === "manager") {
        return "Manager approval was obtained to proceed with the automated resolution.";
      }
      return "Approval was obtained from the designated approver to continue the automated process.";

    case "api_call":
      if (name.includes("grant_access") || name.includes("access")) {
        return "Automated system executed the access grant operation through the IT infrastructure.";
      }
      if (name.includes("vpn") || name.includes("network")) {
        return "Network configuration was automatically updated through the VPN management system.";
      }
      if (name.includes("password") || name.includes("reset")) {
        return "Password reset was initiated through the automated account management system.";
      }
      if (name.includes("email") || name.includes("mailbox")) {
        return "Email configuration was automatically corrected through the mail server management API.";
      }
      if (name.includes("printer") || name.includes("print")) {
        return "Printer configuration was reset and validated through the print management system.";
      }
      return "Automated API call was executed to resolve the issue through the appropriate system.";

    case "ldap_query":
      return "Directory services were queried to verify and update user account information.";

    case "script":
      return "Automated script was executed to perform the necessary system corrections.";

    case "delay":
      return `System waited ${config.duration || 'briefly'} to ensure changes took effect.`;

    case "condition":
      return "System evaluated conditions to determine the appropriate resolution path.";

    default:
      return "Automated resolution step was completed successfully.";
  }
}

export interface WorkflowStep {
  type: "api_call" | "ldap_query" | "script" | "approval" | "condition" | "delay";
  name: string;
  config: Record<string, any>;
  onSuccess?: string; // Next step name
  onFailure?: string; // Next step name
}

export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  intent_filter: string[] | null;
  category_filter: string[] | null;
  keyword_filter: string[] | null;
  steps: WorkflowStep[];
  auto_resolve: boolean;
  create_ticket: boolean;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  ticket_id: string | null;
  session_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  current_step: number;
  input_data: Record<string, any>;
  output_data: Record<string, any> | null;
}

/**
 * Find matching workflows for intent/category/keywords
 */
export async function findMatchingWorkflows(args: {
  intent?: string;
  category?: string | null;
  keywords?: string[];
  description?: string;
}): Promise<Workflow[]> {
  const workflows = await pool.query<Workflow>(
    `SELECT * FROM workflows 
     WHERE enabled = true 
     ORDER BY priority DESC, created_at ASC`
  );

  const matching: Workflow[] = [];

  for (const workflow of workflows.rows) {
    let matches = true;

    // Check intent filter
    if (workflow.intent_filter && workflow.intent_filter.length > 0) {
      if (!args.intent || !workflow.intent_filter.includes(args.intent)) {
        matches = false;
      }
    }

    // Check category filter
    if (workflow.category_filter && workflow.category_filter.length > 0) {
      if (!args.category || !workflow.category_filter.includes(args.category)) {
        matches = false;
      }
    }

    // Check keyword filter
    if (workflow.keyword_filter && workflow.keyword_filter.length > 0) {
      const lowerDesc = (args.description || "").toLowerCase();
      const aiKeywords = (args.keywords || []).map((k) => String(k).toLowerCase());

      const allKeywordsPresent = workflow.keyword_filter.every((keyword) => {
        const k = String(keyword).toLowerCase();
        return lowerDesc.includes(k) || aiKeywords.includes(k);
      });

      if (!allKeywordsPresent) {
        matches = false;
      }
    }

    if (matches) {
      matching.push(workflow);
    }
  }

  return matching;
}

/**
 * Execute a workflow
 */
export async function executeWorkflow(
  workflow: Workflow,
  inputData: Record<string, any>,
  ticketId?: string,
  sessionId?: string
): Promise<WorkflowExecution> {
  // Create execution record
  const execResult = await pool.query<WorkflowExecution>(
    `INSERT INTO workflow_executions 
     (workflow_id, ticket_id, session_id, status, input_data)
     VALUES ($1, $2, $3, 'running', $4)
     RETURNING *`,
    [workflow.id, ticketId || null, sessionId || null, JSON.stringify(inputData)]
  );

  const execution = execResult.rows[0];

  try {
    const outputData: Record<string, any> = {};
    let currentStepIndex = 0;

    for (const step of workflow.steps) {
      currentStepIndex++;

      // Update execution current step
      await pool.query(
        `UPDATE workflow_executions SET current_step = $1 WHERE id = $2`,
        [currentStepIndex, execution.id]
      );

      // Execute step
      const stepResult = await executeStep(step, { ...inputData, ...outputData }, {
        workflow,
        executionId: execution.id,
        stepIndex: currentStepIndex,
        ticketId,
      });

      // Save step result
      await pool.query(
        `INSERT INTO workflow_step_results 
         (execution_id, step_index, step_type, status, input_data, output_data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          execution.id,
          currentStepIndex,
          step.type,
          stepResult.success ? "success" : "failed",
          JSON.stringify({ ...inputData, ...outputData }),
          JSON.stringify(stepResult.output),
        ]
      );

      // Store executed step with professional tutorial description for KB
      if (stepResult.success) {
        const stepDescription = generateStepDescription(step, stepResult);
        await pool.query(
          `INSERT INTO workflow_execution_steps
           (execution_id, step_index, step_type, step_name, step_description, step_config, success, output_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            execution.id,
            currentStepIndex,
            step.type,
            step.name,
            stepDescription,
            JSON.stringify(step.config),
            true,
            JSON.stringify(stepResult.output),
          ]
        );
      }

      if (!stepResult.success) {
        if (stepResult.error === "PENDING_APPROVAL" && ticketId) {
          Object.assign(outputData, stepResult.output);
          await pool.query(
            `UPDATE workflow_executions
             SET status = 'pending',
                 output_data = $1
             WHERE id = $2`,
            [JSON.stringify(outputData), execution.id]
          );

          return { ...execution, status: "pending", current_step: currentStepIndex, output_data: outputData };
        }
        // Handle failure
        if (step.onFailure) {
          // Jump to failure step
          const failureStep = workflow.steps.find((s) => s.name === step.onFailure);
          if (failureStep) {
            continue; // Continue to failure step
          }
        }

        // Mark execution as failed
        await pool.query(
          `UPDATE workflow_executions 
           SET status = 'failed', 
               error_message = $1,
               output_data = $2,
               completed_at = now()
           WHERE id = $3`,
          [
            stepResult.error || "Step failed",
            JSON.stringify(outputData),
            execution.id,
          ]
        );

        return { ...execution, status: "failed", output_data: outputData };
      }

      // Merge step output
      Object.assign(outputData, stepResult.output);

      // Check if should skip to next step
      if (stepResult.skipToStep) {
        const nextStep = workflow.steps.find((s) => s.name === stepResult.skipToStep);
        if (nextStep) {
          continue;
        }
      }
    }

    // Mark execution as completed
    await pool.query(
      `UPDATE workflow_executions 
       SET status = 'completed',
           output_data = $1,
           completed_at = now()
       WHERE id = $2`,
      [JSON.stringify(outputData), execution.id]
    );

    // Auto-resolve ticket if configured
    if (workflow.auto_resolve && ticketId && outputData.success !== false) {
      try {
        const performerId = await getSystemPerformerId(ticketId);
        if (!performerId) {
          console.error(`Cannot auto-resolve ticket ${ticketId}: no performer user available`);
          return { ...execution, status: "completed", output_data: outputData };
        }
        await updateTicketStatus({
          ticketId,
          newStatus: "RESOLVED",
          performedBy: performerId,
        });
      } catch (err) {
        console.error(`Failed to auto-resolve ticket ${ticketId}:`, err);
      }
    }

    return { ...execution, status: "completed", output_data: outputData };
  } catch (err) {
    // Mark execution as failed
    await pool.query(
      `UPDATE workflow_executions 
       SET status = 'failed',
           error_message = $1,
           completed_at = now()
       WHERE id = $2`,
      [err instanceof Error ? err.message : String(err), execution.id]
    );

    return { ...execution, status: "failed" };
  }
}

/**
 * Resume a pending workflow execution from a specific step (after approval)
 */
export async function resumeWorkflowExecution(
  executionId: string,
  workflow: Workflow,
  resumeFromStepIndex: number,
  inputData: Record<string, any>,
  ticketId?: string
): Promise<WorkflowExecution> {
  // Fetch the existing execution
  const execResult = await pool.query<WorkflowExecution>(
    `SELECT * FROM workflow_executions WHERE id = $1`,
    [executionId]
  );

  const execution = execResult.rows[0];
  if (!execution) {
    throw new Error("Workflow execution not found");
  }

  if (execution.status !== "pending") {
    throw new Error("Workflow execution is not in pending state");
  }

  // Get saved output data from pending state
  const outputData: Record<string, any> = (execution.output_data as Record<string, any>) || {};

  // Mark as running again
  await pool.query(
    `UPDATE workflow_executions SET status = 'running', output_data = $2::jsonb WHERE id = $1`,
    [executionId, JSON.stringify(outputData)]
  );

  try {
    let currentStepIndex = resumeFromStepIndex;

    // Continue from the step AFTER the approval step
    const remainingSteps = workflow.steps.slice(resumeFromStepIndex);

    for (const step of remainingSteps) {
      currentStepIndex++;

      // Update execution current step
      await pool.query(
        `UPDATE workflow_executions SET current_step = $1 WHERE id = $2`,
        [currentStepIndex, executionId]
      );

      // Execute step
      const stepResult = await executeStep(step, { ...inputData, ...outputData }, {
        workflow,
        executionId,
        stepIndex: currentStepIndex,
        ticketId,
      });

      // Save step result
      await pool.query(
        `INSERT INTO workflow_step_results 
         (execution_id, step_index, step_type, status, input_data, output_data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          executionId,
          currentStepIndex,
          step.type,
          stepResult.success ? "success" : "failed",
          JSON.stringify({ ...inputData, ...outputData }),
          JSON.stringify(stepResult.output),
        ]
      );

      // Store executed step with professional tutorial description for KB/UI
      if (stepResult.success) {
        const stepDescription = generateStepDescription(step, stepResult);
        await pool.query(
          `INSERT INTO workflow_execution_steps
           (execution_id, step_index, step_type, step_name, step_description, step_config, success, output_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            executionId,
            currentStepIndex,
            step.type,
            step.name,
            stepDescription,
            JSON.stringify(step.config),
            true,
            JSON.stringify(stepResult.output),
          ]
        );
      }

      if (!stepResult.success) {
        // Handle failure
        if (step.onFailure) {
          const failureStep = workflow.steps.find((s) => s.name === step.onFailure);
          if (failureStep) {
            continue;
          }
        }

        // Mark execution as failed
        await pool.query(
          `UPDATE workflow_executions 
           SET status = 'failed', 
               error_message = $1,
               output_data = $2,
               completed_at = now()
           WHERE id = $3`,
          [
            stepResult.error || "Step failed",
            JSON.stringify(outputData),
            executionId,
          ]
        );

        return { ...execution, status: "failed", output_data: outputData };
      }

      // Merge step output
      Object.assign(outputData, stepResult.output);

      // Check if should skip to next step
      if (stepResult.skipToStep) {
        const nextStep = workflow.steps.find((s) => s.name === stepResult.skipToStep);
        if (nextStep) {
          continue;
        }
      }
    }

    // Mark execution as completed
    await pool.query(
      `UPDATE workflow_executions 
       SET status = 'completed',
           output_data = $1,
           completed_at = now()
       WHERE id = $2`,
      [JSON.stringify(outputData), executionId]
    );

    // Auto-resolve ticket if configured
    if (workflow.auto_resolve && ticketId && outputData.success !== false) {
      try {
        const performerId = await getSystemPerformerId(ticketId);
        if (!performerId) {
          console.error(`Cannot auto-resolve ticket ${ticketId}: no performer user available`);
          return { ...execution, status: "completed", output_data: outputData };
        }
        await updateTicketStatus({
          ticketId,
          newStatus: "RESOLVED",
          performedBy: performerId,
        });
      } catch (err) {
        console.error(`Failed to auto-resolve ticket ${ticketId}:`, err);
      }
    }

    return { ...execution, status: "completed", output_data: outputData };
  } catch (err) {
    // Mark execution as failed
    await pool.query(
      `UPDATE workflow_executions 
       SET status = 'failed',
           error_message = $1,
           completed_at = now()
       WHERE id = $2`,
      [err instanceof Error ? err.message : String(err), executionId]
    );

    return { ...execution, status: "failed" };
  }
}

/**
 * Execute a workflow step
 */
async function executeStep(
  step: WorkflowStep,
  context: Record<string, any>,
  meta: { workflow: Workflow; executionId: string; stepIndex: number; ticketId?: string }
): Promise<{
  success: boolean;
  output: Record<string, any>;
  error?: string;
  skipToStep?: string;
}> {
  try {
    switch (step.type) {
      case "api_call":
        return await executeApiCallStep(step, context);
      case "ldap_query":
        return await executeLdapStep(step, context);
      case "script":
        return await executeScriptStep(step, context);
      case "approval":
        return await executeApprovalStep(step, context, meta);
      case "condition":
        return await executeConditionStep(step, context);
      case "delay":
        return await executeDelayStep(step, context);
      default:
        return {
          success: false,
          output: {},
          error: `Unknown step type: ${step.type}`,
        };
    }
  } catch (err) {
    return {
      success: false,
      output: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Execute API call step
 */
async function executeApiCallStep(
  step: WorkflowStep,
  context: Record<string, any>
): Promise<{ success: boolean; output: Record<string, any>; error?: string }> {
  const { url, method = "GET", headers = {}, body, responsePath } = step.config;

  if (!url) {
    return { success: false, output: {}, error: "API URL not configured" };
  }

  // Replace template variables in URL and body
  const resolvedUrl = replaceTemplateVars(url, context);
  const resolvedBody = body ? JSON.parse(replaceTemplateVars(JSON.stringify(body), context)) : undefined;

  const response = await fetch(resolvedUrl, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: resolvedBody ? JSON.stringify(resolvedBody) : undefined,
  });

  if (!response.ok) {
    return {
      success: false,
      output: {},
      error: `API call failed: ${response.statusText}`,
    };
  }

  const data = await response.json();
  const output: Record<string, any> = { apiResponse: data };

  // Extract specific path from response if configured
  if (responsePath) {
    const value = getNestedValue(data, responsePath);
    output[step.name] = value;
  }

  return { success: true, output };
}

/**
 * Execute LDAP query step (password reset, account unlock, etc.)
 */
async function executeLdapStep(
  step: WorkflowStep,
  context: Record<string, any>
): Promise<{ success: boolean; output: Record<string, any>; error?: string }> {
  const { action } = step.config;
  const email =
    step.config.email ||
    context.requesterEmail ||
    (Array.isArray(context?.entities?.emails) ? context.entities.emails[0] : undefined);
  const username =
    step.config.username ||
    context.username ||
    (Array.isArray(context?.entities?.usernames) ? context.entities.usernames[0] : undefined);

  // This is a placeholder - actual LDAP integration would go here
  // In production, use ldapjs or similar library

  if (action === "password_reset") {
    // Simulate password reset
    return {
      success: true,
      output: {
        passwordReset: true,
        message: `Password reset email sent to ${email || username || "user"}`,
      },
    };
  }

  if (action === "account_unlock") {
    // Simulate account unlock
    return {
      success: true,
      output: {
        accountUnlocked: true,
        message: `Account unlocked for ${username || email || "user"}`,
      },
    };
  }

  return { success: false, output: {}, error: `Unknown LDAP action: ${action}` };
}

/**
 * Execute script step (custom JavaScript logic)
 */
async function executeScriptStep(
  step: WorkflowStep,
  context: Record<string, any>
): Promise<{ success: boolean; output: Record<string, any>; error?: string }> {
  const { script } = step.config;

  if (!script) {
    return { success: false, output: {}, error: "Script not provided" };
  }

  // In production, use a sandboxed script executor
  // For now, just return success (security risk if not sandboxed)
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const result = new Function("context", `return ${script}`)(context);
    return { success: true, output: { [step.name]: result } };
  } catch (err) {
    return {
      success: false,
      output: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Execute approval step (requires manual approval)
 */
async function executeApprovalStep(
  step: WorkflowStep,
  context: Record<string, any>,
  meta: { workflow: Workflow; executionId: string; stepIndex: number; ticketId?: string }
): Promise<{ success: boolean; output: Record<string, any>; skipToStep?: string }> {
  // In a real implementation, this would create an approval request
  // and wait for approval. For now, auto-approve if configured.
  const { autoApprove = false } = step.config;

  if (context.approved === true) {
    return {
      success: true,
      output: { approved: true, approvedBy: "employee" },
    };
  }

  if (autoApprove) {
    return {
      success: true,
      output: { approved: true, approvedBy: "system" },
    };
  }

  if (!meta.ticketId) {
    return {
      success: false,
      output: {},
      skipToStep: step.onFailure,
    } as any;
  }

  const actionTitle =
    typeof step.config?.title === "string" && step.config.title.trim()
      ? step.config.title.trim()
      : `Approval required: ${step.name}`;
  const actionBody =
    typeof step.config?.body === "string" && step.config.body.trim()
      ? step.config.body.trim()
      : "AI can auto-resolve this issue. Please approve to proceed.";

  const expiresInHours = typeof step.config?.expiresInHours === "number" ? step.config.expiresInHours : 24;

  const { request } = await createApprovalRequest({
    ticketId: meta.ticketId,
    workflowId: meta.workflow.id,
    workflowExecutionId: meta.executionId,
    stepIndex: meta.stepIndex,
    actionTitle,
    actionBody,
    inputData: { ...context, approver: step.config?.approver },
    expiresInHours,
  });

  return {
    success: false,
    output: { approvalPending: true, approvalId: request.id },
    error: "PENDING_APPROVAL",
  } as any;
}

/**
 * Execute condition step (if/then logic)
 */
async function executeConditionStep(
  step: WorkflowStep,
  context: Record<string, any>
): Promise<{ success: boolean; output: Record<string, any>; skipToStep?: string }> {
  const { condition, thenStep, elseStep } = step.config;

  // Evaluate condition
  const conditionMet = evaluateCondition(condition, context);

  return {
    success: true,
    output: { conditionMet },
    skipToStep: conditionMet ? thenStep : elseStep,
  };
}

/**
 * Execute delay step
 */
async function executeDelayStep(
  step: WorkflowStep,
  context: Record<string, any>
): Promise<{ success: boolean; output: Record<string, any> }> {
  const { durationMs = 1000 } = step.config;
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  return { success: true, output: {} };
}

/**
 * Replace template variables in string
 */
function replaceTemplateVars(template: string, context: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return context[key] !== undefined ? String(context[key]) : `{{${key}}}`;
  });
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: any, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], obj);
}

/**
 * Evaluate condition expression
 */
function evaluateCondition(condition: string, context: Record<string, any>): boolean {
  // Simple condition evaluation (in production, use a proper expression evaluator)
  // Format: "key == value" or "key != value"
  const match = condition.match(/(\w+)\s*(==|!=)\s*(.+)/);
  if (!match) {
    return false;
  }

  const [, key, operator, value] = match;
  const contextValue = context[key];

  if (operator === "==") {
    return String(contextValue) === value;
  } else if (operator === "!=") {
    return String(contextValue) !== value;
  }

  return false;
}
