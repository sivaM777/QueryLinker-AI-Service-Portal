import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import { emailMonitor } from "../../services/integrations/email-monitor.service.js";

const createEmailSourceSchema = z.object({
  name: z.string().min(1).max(100),
  email_address: z.string().email(),
  imap_host: z.string().min(1),
  imap_port: z.number().int().min(1).max(65535).default(993),
  imap_secure: z.boolean().default(true),
  imap_username: z.string().min(1),
  imap_password: z.string().min(1),
  enabled: z.boolean().default(true),
});

const updateEmailSourceSchema = createEmailSourceSchema.partial();

export const emailRoutes: FastifyPluginAsync = async (server) => {
  // GET /email-sources - List all email sources
  server.get(
    "/email-sources",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const result = await pool.query(
        `SELECT
          id,
          name,
          email_address,
          imap_host,
          imap_port,
          imap_secure,
          enabled,
          last_checked_at,
          last_connect_at,
          last_success_at,
          last_error,
          last_error_at,
          created_at,
          CASE
            WHEN enabled = false THEN 'DISABLED'
            WHEN last_error_at IS NOT NULL AND (last_success_at IS NULL OR last_error_at > last_success_at) THEN 'ERROR'
            WHEN last_success_at IS NOT NULL THEN 'OK'
            WHEN last_connect_at IS NOT NULL THEN 'CONNECTED'
            ELSE 'PENDING'
          END AS status
        FROM email_sources
        ORDER BY created_at DESC`
      );
      return reply.send(result.rows);
    }
  );

  // GET /email-sources/:id/events - Recent ingestion audit events
  server.get(
    "/email-sources/:id/events",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(request.query);

      const [itemsRes, countRes] = await Promise.all([
        pool.query(
          `SELECT id, email_source_id, message_id, from_email, subject, action, reason, classifier_confidence, classifier_label, created_ticket_id, created_at
           FROM email_ingestion_events
           WHERE email_source_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [params.id, query.limit, query.offset]
        ),
        pool.query<{ total: string }>(
          `SELECT count(*)::text as total
           FROM email_ingestion_events
           WHERE email_source_id = $1`,
          [params.id]
        ),
      ]);

      return reply.send({
        items: itemsRes.rows,
        total: parseInt(countRes.rows[0]?.total || "0", 10),
      });
    }
  );

  // POST /email-sources - Create email source
  server.post(
    "/email-sources",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = createEmailSourceSchema.parse(request.body);

      const result = await pool.query(
        `INSERT INTO email_sources (name, email_address, imap_host, imap_port, imap_secure, imap_username, imap_password, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, email_address, enabled, created_at`,
        [
          body.name,
          body.email_address,
          body.imap_host,
          body.imap_port,
          body.imap_secure,
          body.imap_username,
          body.imap_password,
          body.enabled,
        ]
      );

      // Reload email monitor if enabled
      if (body.enabled) {
        try {
          await emailMonitor.start();
        } catch (err) {
          console.error(
            `Failed to reload email monitor after creating email source: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      return reply.code(201).send(result.rows[0]);
    }
  );

  // PATCH /email-sources/:id - Update email source
  server.patch(
    "/email-sources/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateEmailSourceSchema.parse(request.body);

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (body.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(body.name);
      }
      if (body.email_address !== undefined) {
        updates.push(`email_address = $${paramIndex++}`);
        values.push(body.email_address);
      }
      if (body.imap_host !== undefined) {
        updates.push(`imap_host = $${paramIndex++}`);
        values.push(body.imap_host);
      }
      if (body.imap_port !== undefined) {
        updates.push(`imap_port = $${paramIndex++}`);
        values.push(body.imap_port);
      }
      if (body.imap_secure !== undefined) {
        updates.push(`imap_secure = $${paramIndex++}`);
        values.push(body.imap_secure);
      }
      if (body.imap_username !== undefined) {
        updates.push(`imap_username = $${paramIndex++}`);
        values.push(body.imap_username);
      }
      if (body.imap_password !== undefined) {
        updates.push(`imap_password = $${paramIndex++}`);
        values.push(body.imap_password);
      }
      if (body.enabled !== undefined) {
        updates.push(`enabled = $${paramIndex++}`);
        values.push(body.enabled);
      }

      if (updates.length === 0) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      updates.push(`updated_at = now()`);
      values.push(params.id);

      const result = await pool.query(
        `UPDATE email_sources SET ${updates.join(", ")} WHERE id = $${paramIndex} RETURNING id, name, email_address, enabled`,
        values
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ message: "Email source not found" });
      }

      // Reload email monitor
      await emailMonitor.start();

      return reply.send(result.rows[0]);
    }
  );

  // DELETE /email-sources/:id - Delete email source
  server.delete(
    "/email-sources/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      await pool.query("DELETE FROM email_sources WHERE id = $1", [params.id]);

      // Reload email monitor
      await emailMonitor.start();

      return reply.code(204).send();
    }
  );

  // POST /email-sources/:id/check - Manually check for emails
  server.post(
    "/email-sources/:id/check",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      try {
        const res = await emailMonitor.checkSource(params.id);
        return reply.send(res);
      } catch (err: any) {
        return reply.code(500).send({ message: err.message || "Error checking emails" });
      }
    }
  );
};
