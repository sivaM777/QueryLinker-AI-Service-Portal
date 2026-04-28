import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import {
  findMatchingRules,
  routeTicket,
  applyRouting,
  RoutingRule,
} from "../../services/routing/intelligent-routing.service.js";
import {
  calculateComplexityScore,
  batchUpdateComplexityScores,
} from "../../services/routing/complexity-scoring.service.js";

const createRoutingRuleSchema = z.object({
  name: z.string().min(1).max(100),
  priority: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  category_filter: z.array(z.string()).nullable().optional(),
  priority_filter: z.array(z.enum(["LOW", "MEDIUM", "HIGH"])).nullable().optional(),
  keyword_filter: z.array(z.string()).nullable().optional(),
  urgency_keywords: z.array(z.string()).nullable().optional(),
  assigned_team_id: z.string().uuid().nullable().optional(),
  assigned_agent_id: z.string().uuid().nullable().optional(),
  auto_priority: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

const updateRoutingRuleSchema = createRoutingRuleSchema.partial();

export const routingRoutes: FastifyPluginAsync = async (server) => {
  // GET /routing/rules - List all routing rules
  server.get(
    "/routing/rules",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const result = await pool.query<RoutingRule>(
        "SELECT * FROM routing_rules ORDER BY priority DESC, created_at ASC"
      );
      return reply.send(result.rows);
    }
  );

  // POST /routing/rules - Create routing rule
  server.post(
    "/routing/rules",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = createRoutingRuleSchema.parse(request.body);

      const result = await pool.query(
        `INSERT INTO routing_rules 
         (name, priority, enabled, category_filter, priority_filter, keyword_filter, 
          urgency_keywords, assigned_team_id, assigned_agent_id, auto_priority, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          body.name,
          body.priority,
          body.enabled,
          body.category_filter,
          body.priority_filter,
          body.keyword_filter,
          body.urgency_keywords,
          body.assigned_team_id,
          body.assigned_agent_id,
          body.auto_priority,
          body.description,
        ]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  // PATCH /routing/rules/:id - Update routing rule
  server.patch(
    "/routing/rules/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateRoutingRuleSchema.parse(request.body);

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined) {
          updates.push(`${key} = $${paramIndex++}`);
          values.push(value);
        }
      });

      if (updates.length === 0) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      updates.push(`updated_at = now()`);
      values.push(params.id);

      const result = await pool.query(
        `UPDATE routing_rules SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ message: "Routing rule not found" });
      }

      return reply.send(result.rows[0]);
    }
  );

  // DELETE /routing/rules/:id - Delete routing rule
  server.delete(
    "/routing/rules/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await pool.query("DELETE FROM routing_rules WHERE id = $1", [params.id]);
      return reply.code(204).send();
    }
  );

  // POST /routing/test - Test routing for a ticket
  server.post(
    "/routing/test",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT"])] },
    async (request, reply) => {
      const body = z
        .object({
          category: z.string().nullable(),
          priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
          title: z.string(),
          description: z.string(),
        })
        .parse(request.body);

      const matchingRules = await findMatchingRules(body);
      const u = request.authUser!;
      const routingResult = await routeTicket({
        ticketId: "test", // Dummy ID for testing
        ...body,
        performedBy: u.id,
      });

      return reply.send({
        matchingRules: matchingRules.map((r) => ({
          id: r.id,
          name: r.name,
          priority: r.priority,
        })),
        routingResult,
      });
    }
  );

  // POST /routing/apply/:ticketId - Apply routing to a ticket
  server.post(
    "/routing/apply/:ticketId",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT"])] },
    async (request, reply) => {
      const params = z.object({ ticketId: z.string().uuid() }).parse(request.params);
      const u = request.authUser!;

      // Get ticket details
      const ticketResult = await pool.query(
        "SELECT category, priority, title, description FROM tickets WHERE id = $1",
        [params.ticketId]
      );

      if (ticketResult.rows.length === 0) {
        return reply.code(404).send({ message: "Ticket not found" });
      }

      const ticket = ticketResult.rows[0];
      const routingResult = await routeTicket({
        ticketId: params.ticketId,
        category: ticket.category,
        priority: ticket.priority,
        title: ticket.title,
        description: ticket.description,
        performedBy: u.id,
      });

      await applyRouting(params.ticketId, routingResult, u.id);

      return reply.send({ routingResult });
    }
  );

  // POST /routing/complexity - Calculate complexity score
  server.post(
    "/routing/complexity",
    { 
      preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])]
    },
    async (request, reply) => {
      const body = z.object({
        category: z.string().nullable(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(2000),
      }).parse(request.body);
      
      const complexity = await calculateComplexityScore({
        category: body.category,
        priority: body.priority,
        title: body.title,
        description: body.description,
        keywords: [],
      });
      
      return reply.send(complexity);
    }
  );

  // POST /routing/batch-update-complexity - Batch update complexity scores
  server.post(
    "/routing/batch-update-complexity",
    { 
      preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])]
    },
    async (_request, reply) => {
      const updated = await batchUpdateComplexityScores();
      
      return reply.send({
        message: `Updated complexity scores for ${updated} tickets`,
        updated
      });
    }
  );
};
