import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import {
  createWorkflow,
  createWorkflowTemplate,
  getWorkflow,
  updateWorkflow,
  listWorkflows,
  listWorkflowTemplates,
  listWorkflowVersions,
  deleteWorkflow,
  executeWorkflow,
  executeTriggeredWorkflows,
  getWorkflowExecutionDetail,
  restoreWorkflowVersion,
  VISUAL_WORKFLOW_NODE_TYPES,
  type WorkflowGraph,
} from "../../services/workflows/visual-workflow.service.js";

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
  categoryFilter: z.array(z.string()).default([]),
  triggerType: z.enum(["ticket_created", "ticket_updated", "scheduled", "manual", "api"]),
  triggerConfig: z.record(z.any()).default({}),
  priority: z.number().int().min(0).max(1000).default(0),
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(VISUAL_WORKFLOW_NODE_TYPES),
      position: z.object({ x: z.number(), y: z.number() }),
      data: z.record(z.any()),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      condition: z.string().optional(),
      animated: z.boolean().optional(),
    })
  ),
});

const updateWorkflowSchema = createWorkflowSchema.partial();

const executeSchema = z.object({
  ticketId: z.string().uuid(),
  triggerData: z.record(z.any()).default({}),
});

const executeTriggerSchema = z.object({
  ticketId: z.string().uuid(),
  category: z.string().optional().nullable(),
  triggerData: z.record(z.any()).default({}),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  icon: z.string().max(100).optional(),
  templateData: createWorkflowSchema,
});

export const visualWorkflowRoutes: FastifyPluginAsync = async (server) => {
  // GET /workflows/visual - List all visual workflows
  server.get(
    "/workflows/visual",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      try {
        const { enabled, category, triggerType } = request.query as any;
        const workflows = await listWorkflows({ enabled, category, triggerType });
        return reply.send({ data: workflows });
      } catch (error) {
        console.error("Error listing workflows:", error);
        return reply.status(500).send({ error: "Failed to list workflows" });
      }
    }
  );

  // POST /workflows/visual - Create new workflow
  server.post(
    "/workflows/visual",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      try {
        const data = createWorkflowSchema.parse(request.body);
        const workflow = await createWorkflow({
          name: data.name,
          description: data.description,
          enabled: data.enabled,
          categoryFilter: data.categoryFilter,
          triggerType: data.triggerType,
          triggerConfig: data.triggerConfig,
          priority: data.priority,
          nodes: data.nodes as WorkflowGraph["nodes"],
          edges: data.edges as WorkflowGraph["edges"],
          createdBy: request.authUser?.id,
          updatedBy: request.authUser?.id,
        });
        return reply.status(201).send(workflow);
      } catch (error) {
        console.error("Error creating workflow:", error);
        return reply.status(400).send({ error: "Invalid workflow data" });
      }
    }
  );

  // GET /workflows/visual/:id - Get workflow by ID
  server.get(
    "/workflows/visual/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const workflow = await getWorkflow(id);

        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        return reply.send(workflow);
      } catch (error) {
        console.error("Error getting workflow:", error);
        return reply.status(500).send({ error: "Failed to get workflow" });
      }
    }
  );

  // PUT /workflows/visual/:id - Update workflow
  server.put(
    "/workflows/visual/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const data = updateWorkflowSchema.parse(request.body) as Partial<WorkflowGraph>;

        const workflow = await updateWorkflow(id, data, request.authUser!.id);

        if (!workflow) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        return reply.send(workflow);
      } catch (error) {
        console.error("Error updating workflow:", error);
        return reply.status(400).send({ error: "Invalid workflow data" });
      }
    }
  );

  // DELETE /workflows/visual/:id - Delete workflow
  server.delete(
    "/workflows/visual/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const success = await deleteWorkflow(id);

        if (!success) {
          return reply.status(404).send({ error: "Workflow not found" });
        }

        return reply.send({ success: true });
      } catch (error) {
        console.error("Error deleting workflow:", error);
        return reply.status(500).send({ error: "Failed to delete workflow" });
      }
    }
  );

  // POST /workflows/visual/:id/execute - Execute workflow
  server.post(
    "/workflows/visual/:id/execute",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { ticketId, triggerData } = executeSchema.parse(request.body);

        const execution = await executeWorkflow(id, ticketId, triggerData, request.authUser?.id);

        return reply.send(execution);
      } catch (error) {
        console.error("Error executing workflow:", error);
        return reply.status(400).send({ error: "Failed to execute workflow" });
      }
    }
  );

  // GET /workflows/visual/:id/executions - Get execution history
  server.get(
    "/workflows/visual/:id/executions",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { status, limit = "50", offset = "0" } = request.query as any;

        const result = await pool.query(
          `SELECT * FROM workflow_graph_executions 
           WHERE workflow_id = $1 ${status ? "AND status = $2" : ""}
           ORDER BY started_at DESC
           LIMIT $${status ? "3" : "2"} OFFSET $${status ? "4" : "3"}`,
          status ? [id, status, parseInt(limit), parseInt(offset)] : [id, parseInt(limit), parseInt(offset)]
        );

        return reply.send({ data: result.rows });
      } catch (error) {
        console.error("Error getting executions:", error);
        return reply.status(500).send({ error: "Failed to get executions" });
      }
    }
  );

  server.get(
    "/workflows/visual/:id/versions",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const versions = await listWorkflowVersions(id);
        return reply.send({ data: versions });
      } catch (error) {
        console.error("Error getting workflow versions:", error);
        return reply.status(500).send({ error: "Failed to get workflow versions" });
      }
    }
  );

  server.post(
    "/workflows/visual/:id/versions/:versionId/restore",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      try {
        const { id, versionId } = request.params as { id: string; versionId: string };
        const workflow = await restoreWorkflowVersion(id, versionId, request.authUser!.id);
        if (!workflow) {
          return reply.status(404).send({ error: "Workflow version not found" });
        }
        return reply.send(workflow);
      } catch (error) {
        console.error("Error restoring workflow version:", error);
        return reply.status(500).send({ error: "Failed to restore workflow version" });
      }
    }
  );

  server.get(
    "/workflows/visual/executions/:executionId",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      try {
        const { executionId } = request.params as { executionId: string };
        const detail = await getWorkflowExecutionDetail(executionId);
        if (!detail) {
          return reply.status(404).send({ error: "Execution not found" });
        }
        return reply.send(detail);
      } catch (error) {
        console.error("Error getting execution detail:", error);
        return reply.status(500).send({ error: "Failed to get execution detail" });
      }
    }
  );

  // GET /workflows/templates - Get workflow templates
  server.get(
    "/workflows/templates",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      try {
        const templates = await listWorkflowTemplates(request.authUser?.id);
        return reply.send({ data: templates });
      } catch (error) {
        console.error("Error getting templates:", error);
        return reply.status(500).send({ error: "Failed to get templates" });
      }
    }
  );

  server.post(
    "/workflows/templates",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      try {
        const data = createTemplateSchema.parse(request.body);
        const template = await createWorkflowTemplate({
          name: data.name,
          description: data.description,
          category: data.category,
          icon: data.icon,
          templateData: data.templateData,
          createdBy: request.authUser?.id,
        });
        return reply.status(201).send(template);
      } catch (error) {
        console.error("Error creating template:", error);
        return reply.status(400).send({ error: "Invalid template data" });
      }
    }
  );

  // POST /workflows/templates/:id/use - Use a template
  server.post(
    "/workflows/templates/:id/use",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };

        const templateResult = await pool.query(
          "SELECT * FROM workflow_templates WHERE id = $1",
          [id]
        );

        if (templateResult.rows.length === 0) {
          return reply.status(404).send({ error: "Template not found" });
        }

        const template = templateResult.rows[0];
        const workflowData = {
          name: template.name,
          description: template.description,
          ...template.template_data,
        };

        const workflow = await createWorkflow({
          ...workflowData,
          createdBy: request.authUser?.id,
          updatedBy: request.authUser?.id,
        });

        return reply.status(201).send(workflow);
      } catch (error) {
        console.error("Error using template:", error);
        return reply.status(500).send({ error: "Failed to create workflow from template" });
      }
    }
  );

  server.post(
    "/workflows/visual/trigger/:triggerType",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      try {
        const { triggerType } = request.params as { triggerType: "api" };
        if (triggerType !== "api") {
          return reply.status(400).send({ error: "Only api trigger can be invoked manually" });
        }

        const { ticketId, category, triggerData } = executeTriggerSchema.parse(request.body);
        const executions = await executeTriggeredWorkflows({
          triggerType,
          ticketId,
          category: category || undefined,
          triggerData,
          userId: request.authUser?.id,
        });

        return reply.send({ data: executions });
      } catch (error) {
        console.error("Error triggering workflows:", error);
        return reply.status(400).send({ error: "Failed to trigger workflows" });
      }
    }
  );
};
