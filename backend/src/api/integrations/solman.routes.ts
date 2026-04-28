import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import { syncSolmanTickets } from "../../services/integrations/solman-sync.service.js";

const createSolmanConfigSchema = z.object({
  name: z.string().min(1).max(100),
  api_url: z.string().min(1),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  client_id: z.string().optional().nullable(),
  client_secret: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  sync_interval_minutes: z.number().int().min(1).default(15),
});
const updateSolmanConfigSchema = createSolmanConfigSchema.partial();

export const solmanRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    "/integrations/solman/configs",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (_request, reply) => {
      const result = await pool.query(
        `SELECT id, name, api_url, enabled, sync_interval_minutes, last_sync_at, created_at
         FROM external_system_configs
         WHERE system_type = 'SOLMAN'
         ORDER BY created_at DESC`
      );
      return reply.send(result.rows);
    }
  );

  server.post(
    "/integrations/solman/configs",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = createSolmanConfigSchema.parse(request.body);

      const result = await pool.query(
        `INSERT INTO external_system_configs
         (system_type, name, api_url, username, password, api_token, api_key, enabled, sync_interval_minutes)
         VALUES ('SOLMAN', $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, api_url, enabled, sync_interval_minutes, created_at`,
        [
          body.name,
          body.api_url,
          body.username || null,
          body.password || null,
          body.client_id || null,
          body.client_secret || null,
          body.enabled,
          body.sync_interval_minutes,
        ]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  server.patch(
    "/integrations/solman/configs/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateSolmanConfigSchema.parse(request.body);

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
      if (body.username !== undefined) {
        updates.push(`username = $${idx++}`);
        values.push(body.username ?? null);
      }
      if (body.password !== undefined) {
        updates.push(`password = $${idx++}`);
        values.push(body.password ?? null);
      }
      if (body.client_id !== undefined) {
        updates.push(`api_token = $${idx++}`);
        values.push(body.client_id ?? null);
      }
      if (body.client_secret !== undefined) {
        updates.push(`api_key = $${idx++}`);
        values.push(body.client_secret ?? null);
      }
      if (body.enabled !== undefined) {
        updates.push(`enabled = $${idx++}`);
        values.push(body.enabled);
      }
      if (body.sync_interval_minutes !== undefined) {
        updates.push(`sync_interval_minutes = $${idx++}`);
        values.push(body.sync_interval_minutes);
      }

      if (!updates.length) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      values.push(params.id);
      const result = await pool.query(
        `UPDATE external_system_configs
         SET ${updates.join(", ")}, updated_at = now()
         WHERE id = $${idx} AND system_type = 'SOLMAN'
         RETURNING id, name, api_url, enabled, sync_interval_minutes, last_sync_at, created_at`,
        values
      );

      const row = result.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Not found" });
      return reply.send(row);
    }
  );

  server.delete(
    "/integrations/solman/configs/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      const res = await pool.query(
        "DELETE FROM external_system_configs WHERE id = $1 AND system_type = 'SOLMAN'",
        [params.id]
      );
      if (res.rowCount === 0) return reply.code(404).send({ message: "Not found" });
      return reply.code(204).send();
    }
  );

  server.post(
    "/integrations/solman/sync/:configId",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ configId: z.string().uuid() }).parse(request.params);
      try {
        const result = await syncSolmanTickets(params.configId);
        return reply.send(result);
      } catch (err: any) {
        return reply.code(500).send({ message: err.message || "Sync failed" });
      }
    }
  );

  server.post(
    "/integrations/solman/sync",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (_request, reply) => {
      const configs = await pool.query<{ id: string }>(
        `SELECT id
         FROM external_system_configs
         WHERE system_type = 'SOLMAN' AND enabled = true`
      );

      const results: Array<Record<string, unknown>> = [];
      for (const config of configs.rows) {
        try {
          const sync = await syncSolmanTickets(config.id);
          results.push({ configId: config.id, ...sync, status: "success" });
        } catch (error: any) {
          results.push({ configId: config.id, status: "error", error: error?.message || "Sync failed" });
        }
      }

      return reply.send({ results });
    }
  );

  server.get(
    "/integrations/solman/events",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(request.query);

      const [itemsRes, totalRes] = await Promise.all([
        pool.query(
          `SELECT
             e.id,
             e.solman_config_id,
             e.external_ticket_id,
             e.external_url,
             e.action,
             e.reason,
             e.ticket_id,
             e.created_at,
             c.name AS config_name,
             t.title AS ticket_title
           FROM solman_ingestion_events e
           LEFT JOIN external_system_configs c ON c.id = e.solman_config_id
           LEFT JOIN tickets t ON t.id = e.ticket_id
           ORDER BY e.created_at DESC
           LIMIT $1 OFFSET $2`,
          [query.limit, query.offset]
        ),
        pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM solman_ingestion_events"),
      ]);

      return reply.send({
        data: itemsRes.rows,
        total: parseInt(totalRes.rows[0]?.count || "0", 10),
        limit: query.limit,
        offset: query.offset,
      });
    }
  );
};
