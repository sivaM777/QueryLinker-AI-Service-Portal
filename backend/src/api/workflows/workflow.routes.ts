import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import { findMatchingWorkflows, executeWorkflow } from "../../services/workflows/auto-resolution.service.js";
import { Workflow } from "../../services/workflows/auto-resolution.service.js";

const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
  intent_filter: z.array(z.string()).nullable().optional(),
  category_filter: z.array(z.string()).nullable().optional(),
  keyword_filter: z.array(z.string()).nullable().optional(),
  steps: z.array(z.object({
    type: z.enum(["api_call", "ldap_query", "script", "approval", "condition", "delay"]),
    name: z.string(),
    config: z.record(z.any()),
    onSuccess: z.string().optional(),
    onFailure: z.string().optional(),
  })),
  auto_resolve: z.boolean().default(false),
  create_ticket: z.boolean().default(false),
});

const updateWorkflowSchema = createWorkflowSchema.partial();

export const workflowRoutes: FastifyPluginAsync = async (server) => {
  // GET /workflows - List all workflows
  server.get(
    "/workflows",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const result = await pool.query<Workflow>(
        "SELECT * FROM workflows ORDER BY priority DESC, created_at ASC"
      );
      return reply.send(result.rows);
    }
  );

  // GET /workflows/metrics - Auto-resolution success metrics by category
  server.get(
    "/workflows/metrics",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (_request, reply) => {
      const result = await pool.query(
        `SELECT category,
                action,
                total_attempts,
                successful_resolutions,
                failed_resolutions,
                escalated_count
         FROM workflow_success_metrics
         ORDER BY category ASC`
      );
      return reply.send({ metrics: result.rows });
    }
  );

  // GET /workflows/:id - Get workflow
  server.get(
    "/workflows/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = await pool.query<Workflow>("SELECT * FROM workflows WHERE id = $1", [
        params.id,
      ]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ message: "Workflow not found" });
      }

      return reply.send(result.rows[0]);
    }
  );

  // POST /workflows - Create workflow
  server.post(
    "/workflows",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = createWorkflowSchema.parse(request.body);

      const result = await pool.query(
        `INSERT INTO workflows 
         (name, description, enabled, priority, intent_filter, category_filter, keyword_filter, 
          steps, auto_resolve, create_ticket)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          body.name,
          body.description || null,
          body.enabled,
          body.priority,
          body.intent_filter,
          body.category_filter,
          body.keyword_filter,
          JSON.stringify(body.steps),
          body.auto_resolve,
          body.create_ticket,
        ]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  // PATCH /workflows/:id - Update workflow
  server.patch(
    "/workflows/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateWorkflowSchema.parse(request.body);

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined) {
          if (key === "steps") {
            updates.push(`${key} = $${paramIndex++}::jsonb`);
            values.push(JSON.stringify(value));
          } else {
            updates.push(`${key} = $${paramIndex++}`);
            values.push(value);
          }
        }
      });

      if (updates.length === 0) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      updates.push(`updated_at = now()`);
      values.push(params.id);

      const result = await pool.query(
        `UPDATE workflows SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ message: "Workflow not found" });
      }

      return reply.send(result.rows[0]);
    }
  );

  // DELETE /workflows/:id - Delete workflow
  server.delete(
    "/workflows/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await pool.query("DELETE FROM workflows WHERE id = $1", [params.id]);
      return reply.code(204).send();
    }
  );

  // POST /workflows/test - Test workflow matching
  server.post(
    "/workflows/test",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = z
        .object({
          intent: z.string().optional(),
          category: z.string().nullable().optional(),
          keywords: z.array(z.string()).optional(),
          description: z.string().optional(),
        })
        .parse(request.body);

      const matching = await findMatchingWorkflows(body);
      return reply.send({
        matchingWorkflows: matching.map((w) => ({
          id: w.id,
          name: w.name,
          priority: w.priority,
        })),
      });
    }
  );

  // POST /workflows/:id/execute - Execute workflow
  server.post(
    "/workflows/:id/execute",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          inputData: z.record(z.any()).default({}),
          ticketId: z.string().uuid().optional(),
          sessionId: z.string().uuid().optional(),
        })
        .parse(request.body);

      // Get workflow
      const workflowResult = await pool.query<Workflow>("SELECT * FROM workflows WHERE id = $1", [
        params.id,
      ]);

      if (workflowResult.rows.length === 0) {
        return reply.code(404).send({ message: "Workflow not found" });
      }

      const workflow = workflowResult.rows[0];

      const execution = await executeWorkflow(
        workflow,
        body.inputData,
        body.ticketId,
        body.sessionId
      );

      return reply.send({ execution });
    }
  );
};
