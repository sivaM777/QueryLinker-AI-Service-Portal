import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth } from "../../middlewares/auth.js";

type SearchResultItem = {
  id: string;
  kind: "ticket" | "knowledge" | "canned_response" | "attachment";
  title: string;
  subtitle: string | null;
  url: string;
  score: number;
  metadata: Record<string, unknown>;
};

export const searchRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    "/global",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.authUser!;
      const query = z
        .object({
          q: z.string().min(1).max(160),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .parse(request.query);

      const q = query.q.trim();
      const like = `%${q}%`;
      const exactDisplay = q.toUpperCase();
      const results: SearchResultItem[] = [];

      const ticketsRes = await pool.query(
        `SELECT
           t.id,
           t.display_number,
           t.title,
           t.status::text AS status,
           requester.email AS requester_email,
           COALESCE(tags.tag_names, ARRAY[]::text[]) AS tag_names,
           CASE
             WHEN upper(COALESCE(t.display_number, '')) = $1 OR t.id::text = $2 THEN 100
             WHEN t.title ILIKE $3 THEN 80
             WHEN t.description ILIKE $3 THEN 70
             WHEN EXISTS (
               SELECT 1
               FROM unnest(COALESCE(tags.tag_names, ARRAY[]::text[])) AS tag_name
               WHERE tag_name ILIKE $3
             ) THEN 60
             ELSE 50
           END AS score
         FROM tickets t
         JOIN users requester ON requester.id = t.created_by
         LEFT JOIN LATERAL (
           SELECT array_remove(array_agg(tt.name ORDER BY tt.name), NULL) AS tag_names
           FROM ticket_tag_links ttl
           JOIN ticket_tags tt ON tt.id = ttl.tag_id
           WHERE ttl.ticket_id = t.id
         ) tags ON true
         WHERE (
           upper(COALESCE(t.display_number, '')) = $1
           OR t.id::text = $2
           OR t.title ILIKE $3
           OR t.description ILIKE $3
           OR requester.email ILIKE $3
           OR EXISTS (
             SELECT 1
             FROM ticket_tag_links sq_ttl
             JOIN ticket_tags sq_tt ON sq_tt.id = sq_ttl.tag_id
             WHERE sq_ttl.ticket_id = t.id
               AND sq_tt.name ILIKE $3
           )
         )
           AND ($4::uuid IS NULL OR t.organization_id = $4)
           AND ($5::text <> 'EMPLOYEE' OR t.created_by = $6)
         ORDER BY score DESC, t.updated_at DESC
         LIMIT $7`,
        [exactDisplay, q, like, user.organization_id ?? null, user.role, user.id, Math.max(query.limit, 8)]
      );

      for (const row of ticketsRes.rows) {
        results.push({
          id: row.id,
          kind: "ticket",
          title: row.title,
          subtitle: `${row.display_number || row.id} • ${row.status} • ${row.requester_email}`,
          url: user.role === "EMPLOYEE" ? `/app/tickets/${row.id}` : `/admin/tickets/${row.id}`,
          score: Number(row.score || 0),
          metadata: {
            display_number: row.display_number,
            status: row.status,
            requester_email: row.requester_email,
            tags: row.tag_names || [],
          },
        });
      }

      const kbRes = await pool.query(
        `SELECT
           id,
           title,
           category,
           CASE
             WHEN title ILIKE $2 THEN 80
             WHEN body ILIKE $2 THEN 70
             WHEN EXISTS (SELECT 1 FROM unnest(tags) AS tag_name WHERE tag_name ILIKE $2) THEN 60
             ELSE 50
           END AS score
         FROM kb_articles
         WHERE title ILIKE $2
            OR body ILIKE $2
            OR EXISTS (SELECT 1 FROM unnest(tags) AS tag_name WHERE tag_name ILIKE $2)
         ORDER BY score DESC, updated_at DESC
         LIMIT $1`,
        [Math.max(query.limit, 8), like]
      );

      for (const row of kbRes.rows) {
        results.push({
          id: row.id,
          kind: "knowledge",
          title: row.title,
          subtitle: row.category,
          url: `/app/kb/${row.id}`,
          score: Number(row.score || 0),
          metadata: {
            category: row.category,
          },
        });
      }

      if (user.role !== "EMPLOYEE") {
        const cannedRes = await pool.query(
          `SELECT
             cr.id,
             cr.title,
             cr.category,
             cr.visibility::text AS visibility,
             CASE
               WHEN cr.title ILIKE $2 THEN 75
               WHEN cr.body ILIKE $2 THEN 65
               WHEN EXISTS (SELECT 1 FROM unnest(COALESCE(cr.tags, ARRAY[]::text[])) AS tag_name WHERE tag_name ILIKE $2) THEN 55
               ELSE 45
             END AS score
           FROM canned_responses cr
           WHERE (
             cr.visibility = 'GLOBAL'
             OR cr.owner_user_id = $3
             OR (cr.visibility = 'TEAM' AND (cr.team_id = $4 OR cr.team_id IS NULL))
           )
             AND (
               cr.title ILIKE $2
               OR cr.body ILIKE $2
               OR EXISTS (SELECT 1 FROM unnest(COALESCE(cr.tags, ARRAY[]::text[])) AS tag_name WHERE tag_name ILIKE $2)
             )
           ORDER BY score DESC, cr.updated_at DESC
           LIMIT $1`,
          [Math.max(query.limit, 8), like, user.id, user.team_id ?? null]
        );

        for (const row of cannedRes.rows) {
          results.push({
            id: row.id,
            kind: "canned_response",
            title: row.title,
            subtitle: `${row.category || "Response"} • ${row.visibility}`,
            url: `/admin/help`,
            score: Number(row.score || 0),
            metadata: {
              category: row.category,
              visibility: row.visibility,
            },
          });
        }
      }

      const attachmentRes = await pool.query(
        `SELECT
           ta.id,
           ta.filename,
           ta.content_type,
           t.id AS ticket_id,
           t.title AS ticket_title,
           COALESCE(t.display_number, t.id::text) AS ticket_number,
           CASE
             WHEN ta.filename ILIKE $3 THEN 40
             WHEN ta.content_type ILIKE $3 THEN 30
             ELSE 20
           END AS score
         FROM ticket_attachments ta
         JOIN tickets t ON t.id = ta.ticket_id
         WHERE (ta.filename ILIKE $3 OR ta.content_type ILIKE $3)
           AND ($1::uuid IS NULL OR t.organization_id = $1)
           AND ($2::text <> 'EMPLOYEE' OR t.created_by = $4)
         ORDER BY score DESC, ta.created_at DESC
         LIMIT $5`,
        [user.organization_id ?? null, user.role, like, user.id, Math.max(query.limit, 8)]
      );

      for (const row of attachmentRes.rows) {
        results.push({
          id: row.id,
          kind: "attachment",
          title: row.filename,
          subtitle: `${row.ticket_number} • ${row.ticket_title}`,
          url: user.role === "EMPLOYEE" ? `/app/tickets/${row.ticket_id}` : `/admin/tickets/${row.ticket_id}`,
          score: Number(row.score || 0),
          metadata: {
            ticket_id: row.ticket_id,
            content_type: row.content_type,
          },
        });
      }

      const deduped = Array.from(
        new Map(results.sort((a, b) => b.score - a.score).map((item) => [`${item.kind}:${item.id}`, item])).values()
      ).slice(0, query.limit);

      return reply.send({
        query: q,
        items: deduped,
      });
    }
  );
};
