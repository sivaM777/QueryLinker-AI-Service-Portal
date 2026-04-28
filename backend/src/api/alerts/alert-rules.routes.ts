import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import { AlertRule } from "../../services/alerts/alert-rules.service.js";

const createAlertRuleSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
  event_type: z.enum([
    "TICKET_CREATED",
    "TICKET_ASSIGNED",
    "TICKET_STATUS_CHANGED",
    "TICKET_RESOLVED",
    "TICKET_CLOSED",
    "SLA_FIRST_RESPONSE_BREACH",
    "SLA_RESOLUTION_BREACH",
    "TICKET_ESCALATED",
    "TICKET_COMMENTED",
  ]),
  conditions: z.record(z.any()).default({}),
  channels: z.array(z.enum(["EMAIL", "SMS", "IN_APP", "WEBHOOK"])).default(["EMAIL"]),
  recipient_user_ids: z.array(z.string().uuid()).nullable().optional(),
  recipient_team_ids: z.array(z.string().uuid()).nullable().optional(),
  recipient_roles: z.array(z.enum(["EMPLOYEE", "AGENT", "MANAGER", "ADMIN"])).nullable().optional(),
  recipient_emails: z.array(z.string().email()).nullable().optional(),
  recipient_phones: z.array(z.string()).nullable().optional(),
  webhook_url: z.string().url().nullable().optional(),
  webhook_secret: z.string().nullable().optional(),
  email_subject_template: z.string().nullable().optional(),
  email_body_template: z.string().nullable().optional(),
  sms_template: z.string().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

const updateAlertRuleSchema = createAlertRuleSchema.partial();

export const alertRulesRoutes: FastifyPluginAsync = async (server) => {
  // GET /alerts/rules - List all alert rules
  server.get(
    "/alerts/rules",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const result = await pool.query<AlertRule>(
        "SELECT * FROM alert_rules ORDER BY priority DESC, created_at ASC"
      );
      return reply.send(result.rows);
    }
  );

  // GET /alerts/rules/:id - Get alert rule
  server.get(
    "/alerts/rules/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const result = await pool.query<AlertRule>("SELECT * FROM alert_rules WHERE id = $1", [
        params.id,
      ]);

      if (result.rows.length === 0) {
        return reply.code(404).send({ message: "Alert rule not found" });
      }

      return reply.send(result.rows[0]);
    }
  );

  // POST /alerts/rules - Create alert rule
  server.post(
    "/alerts/rules",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = createAlertRuleSchema.parse(request.body);

      const result = await pool.query(
        `INSERT INTO alert_rules 
         (name, enabled, priority, event_type, conditions, channels, recipient_user_ids, 
          recipient_team_ids, recipient_roles, recipient_emails, recipient_phones,
          webhook_url, webhook_secret, email_subject_template, email_body_template,
          sms_template, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING *`,
        [
          body.name,
          body.enabled,
          body.priority,
          body.event_type,
          JSON.stringify(body.conditions),
          body.channels,
          body.recipient_user_ids,
          body.recipient_team_ids,
          body.recipient_roles,
          body.recipient_emails,
          body.recipient_phones,
          body.webhook_url,
          body.webhook_secret,
          body.email_subject_template,
          body.email_body_template,
          body.sms_template,
          body.description,
        ]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  // PATCH /alerts/rules/:id - Update alert rule
  server.patch(
    "/alerts/rules/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateAlertRuleSchema.parse(request.body);

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      Object.entries(body).forEach(([key, value]) => {
        if (value !== undefined) {
          if (key === "conditions") {
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
        `UPDATE alert_rules SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ message: "Alert rule not found" });
      }

      return reply.send(result.rows[0]);
    }
  );

  // DELETE /alerts/rules/:id - Delete alert rule
  server.delete(
    "/alerts/rules/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await pool.query("DELETE FROM alert_rules WHERE id = $1", [params.id]);
      return reply.code(204).send();
    }
  );

  // GET /alerts/history - Get alert history
  server.get(
    "/alerts/history",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
          ticket_id: z.string().uuid().optional(),
          status: z.enum(["pending", "sent", "failed"]).optional(),
        })
        .parse(request.query);

      let where = "1=1";
      const params: any[] = [];
      let paramIndex = 1;

      if (query.ticket_id) {
        where += ` AND ticket_id = $${paramIndex++}`;
        params.push(query.ticket_id);
      }

      if (query.status) {
        where += ` AND status = $${paramIndex++}`;
        params.push(query.status);
      }

      params.push(query.limit);
      params.push(query.offset);

      const result = await pool.query(
        `SELECT * FROM alert_history 
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        params
      );

      return reply.send(result.rows);
    }
  );
};
