import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import { analyzeTicketTrends, getKbSuggestionsForTicket } from "../../services/kb/kb-trend.service.js";

function inferKbCategory(input: string): string {
  const text = (input || "").toLowerCase();
  if (text.includes("vpn") || text.includes("wifi") || text.includes("network") || text.includes("internet")) {
    return "NETWORK";
  }
  if (text.includes("password") || text.includes("reset password") || text.includes("forgot password")) {
    return "ACCESS";
  }
  if (text.includes("unlock") || text.includes("locked") || text.includes("account")) {
    return "ACCESS";
  }
  if (text.includes("email") || text.includes("outlook") || text.includes("mailbox")) {
    return "EMAIL";
  }
  if (text.includes("printer") || text.includes("print")) {
    return "HARDWARE";
  }
  if (text.includes("install") || text.includes("software") || text.includes("application") || text.includes("license")) {
    return "SOFTWARE";
  }
  if (text.includes("browser") || text.includes("cache") || text.includes("website")) {
    return "WEB";
  }
  return "GENERAL";
}

export const kbTrendRoutes: FastifyPluginAsync = async (server) => {
  // GET /kb/trends - Get KB trend analysis
  server.get(
    "/kb/trends",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(10),
        })
        .parse(request.query);

      const trends = await analyzeTicketTrends(query.limit);
      return reply.send(trends);
    }
  );

  // GET /kb/suggestions/:ticketId - Get KB suggestions for a ticket
  server.get(
    "/kb/suggestions/:ticketId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = z.object({ ticketId: z.string().uuid() }).parse(request.params);
      const suggestions = await getKbSuggestionsForTicket(params.ticketId);
      return reply.send(suggestions);
    }
  );

  // GET /kb/suggestions (Admin) - list pending KB suggestions
  server.get(
    "/kb/suggestions",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (_request, reply) => {
      const res = await pool.query(
        `SELECT id, pattern, frequency, suggested_title, suggested_body, related_ticket_ids, status, created_at
         FROM kb_suggestions
         WHERE status = 'pending'
         ORDER BY frequency DESC, created_at DESC
         LIMIT 50`
      );
      return reply.send({ suggestions: res.rows });
    }
  );

  // POST /kb/suggestions/:id/approve - Approve and create KB article from suggestion
  server.post(
    "/kb/suggestions/:id/approve",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const u = request.authUser!;

      const body = z
        .object({
          title: z.string().min(1).max(300).optional(),
          body: z.string().min(1).max(20000).optional(),
          category: z.string().min(1).max(100).optional(),
          tags: z.array(z.string().min(1).max(50)).max(20).optional(),
        })
        .optional()
        .parse(request.body);

      // Get suggestion
      const suggestionResult = await pool.query(
        "SELECT * FROM kb_suggestions WHERE id = $1 AND status = 'pending'",
        [params.id]
      );

      if (suggestionResult.rows.length === 0) {
        return reply.code(404).send({ message: "Suggestion not found or already processed" });
      }

      const suggestion = suggestionResult.rows[0];

      const inferredCategory = inferKbCategory(
        `${suggestion.pattern || ""} ${suggestion.suggested_title || ""} ${suggestion.suggested_body || ""}`
      );

      const finalTitle = body?.title?.trim() ? body.title.trim() : suggestion.suggested_title;
      const finalBody = body?.body?.trim() ? body.body.trim() : suggestion.suggested_body;
      const finalCategory = body?.category?.trim()
        ? body.category.trim()
        : inferredCategory;
      const finalTags = Array.isArray(body?.tags) ? body!.tags : [];

      // Create KB article
      const articleResult = await pool.query(
        `INSERT INTO kb_articles (title, body, category, tags)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          finalTitle,
          finalBody,
          finalCategory,
          finalTags,
        ]
      );

      const articleId = articleResult.rows[0].id;

      // Update suggestion status
      await pool.query(
        `UPDATE kb_suggestions 
         SET status = 'approved', 
             created_article_id = $1,
             reviewed_at = now(),
             reviewed_by = $2
         WHERE id = $3`,
        [articleId, u.id, params.id]
      );

      return reply.send({ articleId, message: "KB article created from suggestion" });
    }
  );

  // POST /kb/articles/:id/feedback - Helpful / Not helpful vote + optional reason
  server.post(
    "/kb/articles/:id/feedback",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const u = request.authUser!;
      const body = z
        .object({
          helpful: z.boolean(),
          reason: z.string().max(2000).optional().nullable(),
        })
        .parse(request.body);

      await pool.query(
        `INSERT INTO kb_article_feedback (article_id, user_id, helpful, reason)
         VALUES ($1, $2, $3, $4)`,
        [params.id, u.id, body.helpful, body.reason ?? null]
      );

      if (body.helpful) {
        await pool.query("SELECT track_kb_article_helpful($1)", [params.id]);
      } else {
        await pool.query("SELECT track_kb_article_not_helpful($1)", [params.id]);
      }

      return reply.send({ message: "Feedback recorded" });
    }
  );

  // POST /kb/articles/:id/track-view - Track KB article view
  server.post(
    "/kb/articles/:id/track-view",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      await pool.query("SELECT track_kb_article_view($1)", [params.id]);

      return reply.send({ message: "View tracked" });
    }
  );

  // POST /kb/articles/:id/track-helpful - Track KB article helpfulness
  server.post(
    "/kb/articles/:id/track-helpful",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      await pool.query("SELECT track_kb_article_helpful($1)", [params.id]);

      return reply.send({ message: "Helpfulness tracked" });
    }
  );
};
