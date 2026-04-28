import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import { syncGlpiTickets, syncTicketToGlpi } from "../../services/integrations/glpi-sync.service.js";

const createGlpiConfigSchema = z.object({
  name: z.string().min(1).max(100),
  api_url: z.string().url(),
  app_token: z.string().min(1),
  user_token: z.string().min(1),
  enabled: z.boolean().default(true),
  sync_interval_minutes: z.number().int().min(1).default(15),
});

const updateGlpiConfigSchema = createGlpiConfigSchema.partial();

export const glpiRoutes: FastifyPluginAsync = async (server) => {
  // GET /integrations/glpi/configs - List GLPI configurations
  server.get(
    "/integrations/glpi/configs",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const result = await pool.query(
        `SELECT id, name, api_url, enabled, sync_interval_minutes, last_sync_at, created_at
         FROM external_system_configs 
         WHERE system_type = 'GLPI'
         ORDER BY created_at DESC`
      );
      return reply.send(result.rows);
    }
  );

  // POST /integrations/glpi/configs - Create GLPI configuration
  server.post(
    "/integrations/glpi/configs",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = createGlpiConfigSchema.parse(request.body);

      const result = await pool.query(
        `INSERT INTO external_system_configs 
         (system_type, name, api_url, app_token, user_token, enabled, sync_interval_minutes)
         VALUES ('GLPI', $1, $2, $3, $4, $5, $6)
         RETURNING id, name, api_url, enabled, sync_interval_minutes, created_at`,
        [
          body.name,
          body.api_url,
          body.app_token,
          body.user_token,
          body.enabled,
          body.sync_interval_minutes,
        ]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  // PATCH /integrations/glpi/configs/:id - Update GLPI configuration
  server.patch(
    "/integrations/glpi/configs/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateGlpiConfigSchema.parse(request.body);

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (body.name !== undefined) {
        updates.push(`name = $${idx++}`);
        values.push(body.name);
      }
      if (body.api_url !== undefined) {
        updates.push(`api_url = $${idx++}`);
        values.push(body.api_url);
      }
      if (body.app_token !== undefined) {
        updates.push(`app_token = $${idx++}`);
        values.push(body.app_token);
      }
      if (body.user_token !== undefined) {
        updates.push(`user_token = $${idx++}`);
        values.push(body.user_token);
      }
      if (body.enabled !== undefined) {
        updates.push(`enabled = $${idx++}`);
        values.push(body.enabled);
      }
      if (body.sync_interval_minutes !== undefined) {
        updates.push(`sync_interval_minutes = $${idx++}`);
        values.push(body.sync_interval_minutes);
      }

      if (updates.length === 0) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      values.push(params.id);
      const result = await pool.query(
        `UPDATE external_system_configs
         SET ${updates.join(", ")}, updated_at = now()
         WHERE id = $${idx} AND system_type = 'GLPI'
         RETURNING id, name, api_url, enabled, sync_interval_minutes, created_at, last_sync_at`,
        values
      );

      const row = result.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Not found" });
      return reply.send(row);
    }
  );

  // DELETE /integrations/glpi/configs/:id - Delete GLPI configuration
  server.delete(
    "/integrations/glpi/configs/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      const res = await pool.query(
        "DELETE FROM external_system_configs WHERE id = $1 AND system_type = 'GLPI'",
        [params.id]
      );
      if (res.rowCount === 0) return reply.code(404).send({ message: "Not found" });
      return reply.code(204).send();
    }
  );

  // POST /integrations/glpi/sync/:configId - Manually sync GLPI tickets
  server.post(
    "/integrations/glpi/sync/:configId",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ configId: z.string().uuid() }).parse(request.params);

      try {
        const result = await syncGlpiTickets(params.configId);
        return reply.send(result);
      } catch (err: any) {
        console.error("GLPI Sync Error:", err);
        return reply.code(500).send({ message: err.message || "Sync failed" });
      }
    }
  );

  // POST /integrations/glpi/sync-ticket/:ticketId - Sync specific ticket to GLPI
  server.post(
    "/integrations/glpi/sync-ticket/:ticketId",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT"])] },
    async (request, reply) => {
      const params = z.object({ ticketId: z.string().uuid() }).parse(request.params);
      const body = z.object({ configId: z.string().uuid() }).parse(request.body);

      try {
        await syncTicketToGlpi(params.ticketId, body.configId);
        return reply.send({ message: "Ticket synced to GLPI" });
      } catch (err: any) {
        return reply.code(500).send({ message: err.message || "Sync failed" });
      }
    }
  );

  // POST /integrations/glpi/sync - Manual sync trigger
  server.post(
    "/integrations/glpi/sync",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      // For now, sync all enabled GLPI configs
      const configs = await pool.query(
        `SELECT id FROM external_system_configs WHERE system_type = 'GLPI' AND enabled = true`
      );

      const results = [];
      for (const config of configs.rows) {
        try {
          const result = await syncGlpiTickets(config.id);
          results.push({ configId: config.id, ...result, status: "success" });
        } catch (error: any) {
          results.push({ configId: config.id, error: error.message, status: "error" });
        }
      }

      return reply.send({ results });
    }
  );

  // GET /integrations/glpi/events - List ingestion events
  server.get(
    "/integrations/glpi/events",
    {
      preHandler: [requireAuth, requireRole(["ADMIN"])],
    },
    async (request, reply) => {
      const querySchema = z.object({
        limit: z.coerce.number().min(1).max(100).default(50),
        offset: z.coerce.number().min(0).default(0),
      });

      const { limit, offset } = querySchema.parse(request.query);

      const result = await pool.query(
        `SELECT 
           e.id,
           e.glpi_config_id,
           e.external_ticket_id,
           e.external_url,
           e.action,
           e.reason,
           e.ticket_id,
           e.created_at,
           c.name as config_name,
           t.title as ticket_title
         FROM glpi_ingestion_events e
         JOIN external_system_configs c ON e.glpi_config_id = c.id
         LEFT JOIN tickets t ON e.ticket_id = t.id
         ORDER BY e.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const totalResult = await pool.query(`SELECT count(*) as count FROM glpi_ingestion_events`);
      
      return reply.send({
        data: result.rows,
        total: parseInt(totalResult.rows[0].count),
        limit,
        offset
      });
    }
  );
};
