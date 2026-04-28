import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";

type AutofixCatalogRow = {
  id: string;
  code: string;
  enabled: boolean;
  mode: "AUTOMATION" | "GUIDED";
  risk: "LOW" | "MEDIUM" | "HIGH";
  match_intents: string[] | null;
  match_categories: string[] | null;
  match_keywords: string[] | null;
  min_confidence: number | null;
  eligible_priorities: string[];
  approval_required: boolean;
  approval_title: string;
  approval_body: string;
  user_title: string;
  user_description: string;
  workflow_steps: any;
  created_at: string;
  updated_at: string;
};

const playbookBaseSchema = z.object({
  code: z.string().min(1).max(80),
  enabled: z.boolean().optional(),
  mode: z.enum(["AUTOMATION", "GUIDED"]).optional(),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),

  match_intents: z.array(z.string()).nullable().optional(),
  match_categories: z.array(z.string()).nullable().optional(),
  match_keywords: z.array(z.string()).nullable().optional(),
  min_confidence: z.number().min(0).max(1).nullable().optional(),

  eligible_priorities: z.array(z.enum(["LOW", "MEDIUM", "HIGH"]))
    .optional(),

  approval_required: z.boolean().optional(),
  approval_title: z.string().min(1).max(200).optional(),
  approval_body: z.string().min(1).max(4000).optional(),

  user_title: z.string().min(1).max(200).optional(),
  user_description: z.string().min(1).max(4000).optional(),

  workflow_steps: z.array(z.any()).optional(),
});

const createPlaybookSchema = playbookBaseSchema.extend({
  enabled: z.boolean().default(true),
  mode: z.enum(["AUTOMATION", "GUIDED"]).default("GUIDED"),
  risk: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),

  match_intents: z.array(z.string()).nullable().optional(),
  match_categories: z.array(z.string()).nullable().optional(),
  match_keywords: z.array(z.string()).nullable().optional(),
  min_confidence: z.number().min(0).max(1).nullable().optional(),

  eligible_priorities: z.array(z.enum(["LOW", "MEDIUM", "HIGH"]))
    .default(["LOW", "MEDIUM"]),

  approval_required: z.boolean().default(true),
  approval_title: z.string().min(1).max(200),
  approval_body: z.string().min(1).max(4000),

  user_title: z.string().min(1).max(200),
  user_description: z.string().min(1).max(4000),

  workflow_steps: z.array(z.any()).default([]),
});

const updatePlaybookSchema = playbookBaseSchema.partial().omit({ code: true });

export const autofixCatalogRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    "/autofix/catalog",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (_request, reply) => {
      const res = await pool.query<AutofixCatalogRow>(
        `SELECT * FROM autofix_catalog ORDER BY updated_at DESC, created_at DESC`
      );
      return reply.send(res.rows);
    }
  );

  server.get(
    "/autofix/catalog/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const res = await pool.query<AutofixCatalogRow>(
        `SELECT * FROM autofix_catalog WHERE id = $1`,
        [params.id]
      );
      const row = res.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Not found" });
      return reply.send(row);
    }
  );

  server.post(
    "/autofix/catalog",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const body = createPlaybookSchema.parse(request.body);

      try {
        const res = await pool.query<AutofixCatalogRow>(
          `INSERT INTO autofix_catalog
           (code, enabled, mode, risk, match_intents, match_categories, match_keywords, min_confidence,
            eligible_priorities, approval_required, approval_title, approval_body,
            user_title, user_description, workflow_steps)
           VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
           RETURNING *`,
          [
            body.code,
            body.enabled,
            body.mode,
            body.risk,
            body.match_intents ?? null,
            body.match_categories ?? null,
            body.match_keywords ?? null,
            body.min_confidence ?? null,
            body.eligible_priorities,
            body.approval_required,
            body.approval_title,
            body.approval_body,
            body.user_title,
            body.user_description,
            JSON.stringify(body.workflow_steps),
          ]
        );
        return reply.code(201).send(res.rows[0]);
      } catch (e: any) {
        if (String(e?.code) === "23505") {
          return reply.code(409).send({ message: "Code already exists" });
        }
        return reply.code(500).send({ message: "Error" });
      }
    }
  );

  server.patch(
    "/autofix/catalog/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updatePlaybookSchema.parse(request.body);

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      const set = (sqlKey: string, value: any, cast?: string) => {
        updates.push(`${sqlKey} = $${idx}${cast ? `::${cast}` : ""}`);
        values.push(value);
        idx += 1;
      };

      if (body.enabled !== undefined) set("enabled", body.enabled);
      if (body.mode !== undefined) set("mode", body.mode);
      if (body.risk !== undefined) set("risk", body.risk);

      if (body.match_intents !== undefined) set("match_intents", body.match_intents);
      if (body.match_categories !== undefined) set("match_categories", body.match_categories);
      if (body.match_keywords !== undefined) set("match_keywords", body.match_keywords);
      if (body.min_confidence !== undefined) set("min_confidence", body.min_confidence);

      if (body.eligible_priorities !== undefined) set("eligible_priorities", body.eligible_priorities);

      if (body.approval_required !== undefined) set("approval_required", body.approval_required);
      if (body.approval_title !== undefined) set("approval_title", body.approval_title);
      if (body.approval_body !== undefined) set("approval_body", body.approval_body);

      if (body.user_title !== undefined) set("user_title", body.user_title);
      if (body.user_description !== undefined) set("user_description", body.user_description);

      if (body.workflow_steps !== undefined) set("workflow_steps", JSON.stringify(body.workflow_steps), "jsonb");

      if (updates.length === 0) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      updates.push("updated_at = now()");
      values.push(params.id);

      const res = await pool.query<AutofixCatalogRow>(
        `UPDATE autofix_catalog
         SET ${updates.join(", ")}
         WHERE id = $${idx}
         RETURNING *`,
        values
      );

      const row = res.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Not found" });
      return reply.send(row);
    }
  );

  server.post(
    "/autofix/catalog/:id/clone",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({ newCode: z.string().min(1).max(80) }).parse(request.body);

      const existing = await pool.query<AutofixCatalogRow>(
        `SELECT * FROM autofix_catalog WHERE id = $1`,
        [params.id]
      );
      const row = existing.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Not found" });

      try {
        const res = await pool.query<AutofixCatalogRow>(
          `INSERT INTO autofix_catalog
           (code, enabled, mode, risk, match_intents, match_categories, match_keywords, min_confidence,
            eligible_priorities, approval_required, approval_title, approval_body,
            user_title, user_description, workflow_steps)
           VALUES
           ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
           RETURNING *`,
          [
            body.newCode,
            row.enabled,
            row.mode,
            row.risk,
            row.match_intents,
            row.match_categories,
            row.match_keywords,
            row.min_confidence,
            row.eligible_priorities,
            row.approval_required,
            row.approval_title,
            row.approval_body,
            row.user_title,
            row.user_description,
            JSON.stringify(row.workflow_steps ?? []),
          ]
        );
        return reply.code(201).send(res.rows[0]);
      } catch (e: any) {
        if (String(e?.code) === "23505") {
          return reply.code(409).send({ message: "Code already exists" });
        }
        return reply.code(500).send({ message: "Error" });
      }
    }
  );

  server.delete(
    "/autofix/catalog/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const res = await pool.query(`DELETE FROM autofix_catalog WHERE id = $1`, [params.id]);
      if (res.rowCount === 0) return reply.code(404).send({ message: "Not found" });
      return reply.code(204).send();
    }
  );
};
