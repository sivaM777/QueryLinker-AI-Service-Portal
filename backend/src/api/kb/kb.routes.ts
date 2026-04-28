import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { env } from "../../config/env.js";
import { incrementAiUsage, resolveAiTier } from "../../services/ai/tier-routing.service.js";

export const kbRoutes: FastifyPluginAsync = async (server) => {
  const listLimitSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(12),
  });

  const cannedVisibilitySchema = z.enum(["GLOBAL", "TEAM", "PRIVATE"]);
  const cannedResponseCreateSchema = z.object({
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(5000),
    category: z.string().max(120).optional().nullable(),
    tags: z.array(z.string().max(40)).max(20).optional().nullable(),
    visibility: cannedVisibilitySchema.default("TEAM"),
    team_id: z.string().uuid().optional().nullable(),
    linked_article_id: z.string().uuid().optional().nullable(),
  });
  const cannedResponseUpdateSchema = cannedResponseCreateSchema.partial();

  server.get(
    "/canned-responses",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const user = request.authUser!;
      const query = z
        .object({
          q: z.string().optional(),
          category: z.string().optional(),
          visibility: cannedVisibilitySchema.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
          include_all: z.coerce.boolean().optional(),
        })
        .parse(request.query);

      const values: any[] = [];
      const filters: string[] = [];
      let idx = 1;

      const includeAll = user.role === "ADMIN" && Boolean(query.include_all);
      if (!includeAll) {
        values.push(user.id);
        const ownerIdx = idx++;
        values.push(user.team_id ?? null);
        const teamIdx = idx++;
        filters.push(
          `(cr.visibility = 'GLOBAL' OR cr.owner_user_id = $${ownerIdx} OR (cr.visibility = 'TEAM' AND (cr.team_id = $${teamIdx} OR cr.team_id IS NULL)))`
        );
      }

      if (query.q) {
        values.push(`%${query.q}%`);
        filters.push(`(cr.title ILIKE $${idx} OR cr.body ILIKE $${idx})`);
        idx += 1;
      }

      if (query.category && query.category !== "All") {
        values.push(query.category);
        filters.push(`cr.category = $${idx}`);
        idx += 1;
      }

      if (query.visibility) {
        values.push(query.visibility);
        filters.push(`cr.visibility = $${idx}::canned_response_visibility`);
        idx += 1;
      }

      values.push(query.limit);

      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const result = await pool.query(
        `SELECT
           cr.id,
           cr.title,
           cr.body,
           cr.category,
           cr.tags,
           cr.visibility,
           cr.owner_user_id,
           cr.team_id,
           cr.linked_article_id,
           cr.usage_count,
           cr.created_at,
           cr.updated_at,
           u.name AS owner_name,
           t.name AS team_name,
           kb.title AS linked_article_title
         FROM canned_responses cr
         JOIN users u ON u.id = cr.owner_user_id
         LEFT JOIN teams t ON t.id = cr.team_id
         LEFT JOIN kb_articles kb ON kb.id = cr.linked_article_id
         ${where}
         ORDER BY cr.usage_count DESC, cr.updated_at DESC
         LIMIT $${values.length}`,
        values
      );

      return reply.send(result.rows);
    }
  );

  server.post(
    "/canned-responses",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const user = request.authUser!;
      const body = cannedResponseCreateSchema.parse(request.body);

      if (user.role === "AGENT" && body.visibility === "GLOBAL") {
        return reply.code(403).send({ message: "Only admins or managers can create global responses" });
      }

      const teamId =
        body.visibility === "TEAM"
          ? body.team_id ?? user.team_id ?? null
          : body.team_id ?? null;

      const result = await pool.query(
        `INSERT INTO canned_responses
          (title, body, category, tags, visibility, owner_user_id, team_id, linked_article_id)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          body.title.trim(),
          body.body.trim(),
          body.category ?? null,
          body.tags ?? null,
          body.visibility,
          user.id,
          teamId,
          body.linked_article_id ?? null,
        ]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  server.patch(
    "/canned-responses/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const user = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = cannedResponseUpdateSchema.parse(request.body);

      const existing = await pool.query<{
        id: string;
        owner_user_id: string;
      }>(
        `SELECT id, owner_user_id
         FROM canned_responses
         WHERE id = $1`,
        [params.id]
      );

      const row = existing.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Canned response not found" });
      if (user.role === "AGENT" && row.owner_user_id !== user.id) {
        return reply.code(403).send({ message: "Agents can only edit their own canned responses" });
      }

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (body.title !== undefined) {
        updates.push(`title = $${idx}`);
        values.push(body.title.trim());
        idx += 1;
      }
      if (body.body !== undefined) {
        updates.push(`body = $${idx}`);
        values.push(body.body.trim());
        idx += 1;
      }
      if (body.category !== undefined) {
        updates.push(`category = $${idx}`);
        values.push(body.category ?? null);
        idx += 1;
      }
      if (body.tags !== undefined) {
        updates.push(`tags = $${idx}`);
        values.push(body.tags ?? null);
        idx += 1;
      }
      if (body.visibility !== undefined) {
        if (user.role === "AGENT" && body.visibility === "GLOBAL") {
          return reply.code(403).send({ message: "Only admins or managers can set global visibility" });
        }
        updates.push(`visibility = $${idx}`);
        values.push(body.visibility);
        idx += 1;
      }
      if (body.team_id !== undefined) {
        updates.push(`team_id = $${idx}`);
        values.push(body.team_id ?? null);
        idx += 1;
      }
      if (body.linked_article_id !== undefined) {
        updates.push(`linked_article_id = $${idx}`);
        values.push(body.linked_article_id ?? null);
        idx += 1;
      }

      if (!updates.length) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      values.push(params.id);
      const result = await pool.query(
        `UPDATE canned_responses
         SET ${updates.join(", ")}, updated_at = now()
         WHERE id = $${idx}
         RETURNING *`,
        values
      );

      return reply.send(result.rows[0]);
    }
  );

  server.delete(
    "/canned-responses/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const user = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      const existing = await pool.query<{ owner_user_id: string }>(
        "SELECT owner_user_id FROM canned_responses WHERE id = $1",
        [params.id]
      );
      const row = existing.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Canned response not found" });
      if (user.role === "AGENT" && row.owner_user_id !== user.id) {
        return reply.code(403).send({ message: "Agents can only delete their own canned responses" });
      }

      await pool.query("DELETE FROM canned_responses WHERE id = $1", [params.id]);
      return reply.code(204).send();
    }
  );

  server.post(
    "/canned-responses/:id/use",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const user = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      const result = await pool.query(
        `UPDATE canned_responses cr
         SET usage_count = usage_count + 1, updated_at = now()
         WHERE cr.id = $1
           AND (
             cr.visibility = 'GLOBAL'
             OR cr.owner_user_id = $2
             OR (cr.visibility = 'TEAM' AND (cr.team_id = $3 OR cr.team_id IS NULL))
           )
         RETURNING cr.*`,
        [params.id, user.id, user.team_id]
      );

      const row = result.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Canned response not found" });
      return reply.send(row);
    }
  );

  server.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const querySchema = z.object({
      q: z.string().optional(),
      category: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      track: z.coerce.boolean().optional(),
      sortBy: z.enum(["relevance", "updated", "created", "views", "helpful"]).optional(),
    });
    const q = querySchema.parse(request.query);

    let analyticsId: string | null = null;

    const where: string[] = [];
    const params: any[] = [];

    if (q.category && q.category !== "All") {
      params.push(q.category);
      where.push(`a.category = $${params.length}`);
    }

    if (q.q) {
      params.push(`%${q.q}%`);
      where.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`);
    }

    let orderBy = "a.updated_at DESC";
    if (q.sortBy === "created") orderBy = "a.created_at DESC";
    else if (q.sortBy === "views") orderBy = "e.views_count DESC NULLS LAST";
    else if (q.sortBy === "helpful") orderBy = "e.helpful_count DESC NULLS LAST";

    params.push(q.limit);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const res = await pool.query(
      `SELECT a.id, a.title, a.category, a.tags, a.updated_at, a.created_at,
              COALESCE(e.views_count, 0) as view_count,
              COALESCE(e.helpful_count, 0) as helpful_count,
              COALESCE(e.avg_rating, 0) as avg_rating
       FROM kb_articles a
       LEFT JOIN kb_article_effectiveness e ON a.id = e.article_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${params.length}`,
      params
    );

    if (q.track && q.q && q.q.trim()) {
      const userId = (request as any).authUser?.id ?? null;
      const a = await pool.query<{ id: string }>(
        `INSERT INTO kb_search_analytics (query, results_count, user_id)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [q.q.trim(), res.rows.length, userId]
      );
      analyticsId = a.rows[0]?.id ?? null;
    }

    if (analyticsId) {
      return reply.send({ analyticsId, items: res.rows });
    }
    return reply.send(res.rows);
  });

  server.get("/featured", { preHandler: [requireAuth] }, async (request, reply) => {
    const { limit } = listLimitSchema.parse(request.query);
    const res = await pool.query(
      `SELECT a.id, a.title, a.body, a.category, a.tags, a.created_at, a.updated_at,
              COALESCE(e.views_count, 0) as view_count,
              COALESCE(e.helpful_count, 0) as helpful_count,
              COALESCE(e.avg_rating, 0) as avg_rating
       FROM kb_articles a
       LEFT JOIN kb_article_effectiveness e ON a.id = e.article_id
       ORDER BY (COALESCE(e.views_count, 0) + COALESCE(e.helpful_count, 0) * 10) DESC
       LIMIT $1`,
      [limit]
    );
    return reply.send(res.rows);
  });

  server.get("/most-viewed", { preHandler: [requireAuth] }, async (request, reply) => {
    const { limit } = listLimitSchema.parse(request.query);
    const res = await pool.query(
      `SELECT a.id, a.title, a.body, a.category, a.tags, a.created_at, a.updated_at,
              COALESCE(e.views_count, 0) as view_count,
              COALESCE(e.avg_rating, 0) as avg_rating
       FROM kb_articles a
       LEFT JOIN kb_article_effectiveness e ON a.id = e.article_id
       ORDER BY e.views_count DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return reply.send(res.rows);
  });

  server.get("/most-useful", { preHandler: [requireAuth] }, async (request, reply) => {
    const { limit } = listLimitSchema.parse(request.query);
    const res = await pool.query(
      `SELECT a.id, a.title, a.body, a.category, a.tags, a.created_at, a.updated_at,
              COALESCE(e.helpful_count, 0) as helpful_count,
              COALESCE(e.avg_rating, 0) as avg_rating
       FROM kb_articles a
       LEFT JOIN kb_article_effectiveness e ON a.id = e.article_id
       ORDER BY e.helpful_count DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return reply.send(res.rows);
  });

  server.post("/search-analytics/:id/click", { preHandler: [requireAuth] }, async (request, reply) => {
    const p = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ articleId: z.string().uuid() }).parse(request.body);

    await pool.query(
      `UPDATE kb_search_analytics
       SET clicked_article_id = $2
       WHERE id = $1`,
      [p.id, body.articleId]
    );

    return reply.send({ ok: true });
  });

  server.get("/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const p = paramsSchema.parse(request.params);
    const res = await pool.query(
      `SELECT a.id, a.title, a.body, a.category, a.tags, a.created_at, a.updated_at,
              COALESCE(e.views_count, 0) as view_count,
              COALESCE(e.helpful_count, 0) as helpful_count,
              COALESCE(e.avg_rating, 0) as avg_rating
       FROM kb_articles a
       LEFT JOIN kb_article_effectiveness e ON a.id = e.article_id
       WHERE a.id = $1`,
      [p.id]
    );
    const row = res.rows[0];
    if (!row) return reply.code(404).send({ message: "Not found" });

    // Track view asynchronously
    await pool.query("SELECT track_kb_article_view($1)", [p.id]);

    return reply.send(row);
  });

  server.get("/:id/comments", { preHandler: [requireAuth] }, async (request, reply) => {
    const p = z.object({ id: z.string().uuid() }).parse(request.params);
    const res = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.name as author_name, u.email as author_email
       FROM kb_article_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.article_id = $1
       ORDER BY c.created_at DESC`,
      [p.id]
    );
    return reply.send(res.rows);
  });

  server.post("/:id/comments", { preHandler: [requireAuth] }, async (request, reply) => {
    const p = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ body: z.string().min(1) }).parse(request.body);
    const userId = (request as any).authUser?.id;

    const res = await pool.query(
      `INSERT INTO kb_article_comments (article_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [p.id, userId, body.body]
    );
    
    // Fetch author details
    const userRes = await pool.query("SELECT name, email FROM users WHERE id = $1", [userId]);
    
    return reply.send({
      ...res.rows[0],
      author_name: userRes.rows[0].name,
      author_email: userRes.rows[0].email
    });
  });

  server.post("/:id/rate", { preHandler: [requireAuth] }, async (request, reply) => {
    const p = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      rating: z.number().int().min(1).max(5).optional(),
      helpful: z.boolean()
    }).parse(request.body);
    const userId = (request as any).authUser?.id;

    // Update helpful count using function
    if (body.helpful) {
      await pool.query("SELECT track_kb_article_helpful($1)", [p.id]);
    } else {
      await pool.query("SELECT track_kb_article_not_helpful($1)", [p.id]);
    }

    // Record detailed feedback
    await pool.query(
      `INSERT INTO kb_article_feedback (article_id, user_id, helpful, rating)
       VALUES ($1, $2, $3, $4)`,
      [p.id, userId, body.helpful, body.rating || (body.helpful ? 5 : 1)]
    );

    return reply.send({ ok: true });
  });

  // Chat Session Management
  server.post("/chat/sessions", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).authUser?.id;
    const sessionRes = await pool.query<{ id: string }>(
      `INSERT INTO kb_chat_sessions (user_id) VALUES ($1) RETURNING id`,
      [userId]
    );
    return reply.send({ sessionId: sessionRes.rows[0].id });
  });

  server.get("/chat/sessions", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).authUser?.id;
    const sessionsRes = await pool.query(
      `SELECT s.id, s.created_at, s.updated_at,
              COALESCE(ARRAY_AGG(m.content ORDER BY m.timestamp) FILTER (WHERE m.role = 'user'), ARRAY[]::text[]) as messages
       FROM kb_chat_sessions s
       LEFT JOIN kb_chat_messages m ON s.id = m.session_id
       WHERE s.user_id = $1
       GROUP BY s.id, s.created_at, s.updated_at
       ORDER BY s.updated_at DESC
       LIMIT 50`,
      [userId]
    );

    const sessions = sessionsRes.rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: row.messages.slice(0, 1).map((content: string) => ({
        id: 'temp',
        role: 'user',
        content,
        timestamp: new Date(),
      }))
    }));

    return reply.send({ sessions });
  });

  server.get("/chat/sessions/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const userId = (request as any).authUser?.id;

    const sessionRes = await pool.query(
      `SELECT s.id, s.created_at, s.updated_at
       FROM kb_chat_sessions s
       WHERE s.id = $1 AND s.user_id = $2`,
      [params.id, userId]
    );

    if (sessionRes.rows.length === 0) {
      return reply.code(404).send({ message: "Session not found" });
    }

    const messagesRes = await pool.query(
      `SELECT id, role, content, timestamp
       FROM kb_chat_messages
       WHERE session_id = $1
       ORDER BY timestamp`,
      [params.id]
    );

    const session = {
      id: sessionRes.rows[0].id,
      createdAt: sessionRes.rows[0].created_at,
      updatedAt: sessionRes.rows[0].updated_at,
      messages: messagesRes.rows.map(row => ({
        id: row.id,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
      }))
    };

    return reply.send({ session });
  });

  server.post("/chat/sessions/:id/messages", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ message: z.string().min(1) }).parse(request.body);
    const userId = (request as any).authUser?.id;
    const tierInfo = await resolveAiTier({ userId });

    // Verify session ownership
    const sessionCheck = await pool.query(
      "SELECT id FROM kb_chat_sessions WHERE id = $1 AND user_id = $2",
      [params.id, userId]
    );
    if (sessionCheck.rows.length === 0) {
      return reply.code(404).send({ message: "Session not found" });
    }

    // Store user message
    const userMessageRes = await pool.query<{ id: string }>(
      `INSERT INTO kb_chat_messages (session_id, role, content)
       VALUES ($1, 'user', $2)
       RETURNING id`,
      [params.id, body.message]
    );

    // Get AI response
    let aiResponse = "I'm sorry, I'm currently unable to process your request. Please try searching our knowledge base.";
    let suggestions: string[] = [];
    let relatedArticles: Array<{ id: string; title: string; snippet: string }> = [];

    try {
      // Search for relevant KB articles first
      const searchRes = await pool.query(
        `SELECT id, title, body
         FROM kb_articles
         WHERE title ILIKE $1 OR body ILIKE $1
         ORDER BY updated_at DESC
         LIMIT 5`,
        [`%${body.message}%`]
      );

      relatedArticles = searchRes.rows.map(row => ({
        id: row.id,
        title: row.title,
        snippet: row.body.substring(0, 200) + (row.body.length > 200 ? '...' : '')
      }));

      // Try AI classification
      const aiUrl = env.AI_CLASSIFIER_URL;
      if (aiUrl) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);

          const aiRes = await fetch(aiUrl, {
            method: "POST",
            headers: { "content-type": "application/json", "x-ai-tier": tierInfo.tier },
            body: JSON.stringify({
              text: body.message,
              context: relatedArticles.length > 0 ? relatedArticles.map(a => a.title).join(', ') : undefined
            }),
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            aiResponse = aiData.response || aiResponse;
            suggestions = aiData.suggestions || [];
            if (tierInfo.tier === "premium") {
              await incrementAiUsage(tierInfo.organizationId);
            }
          }
        } catch (aiError) {
          console.error("AI service error:", aiError);
        }
      }

      // Fallback: Generate helpful response based on articles
      if (relatedArticles.length > 0 && !aiResponse.includes("unable to process")) {
        aiResponse += "\n\nI found some relevant articles that might help:\n" +
          relatedArticles.slice(0, 3).map(a => `- ${a.title}`).join('\n');
      }

    } catch (error) {
      console.error("KB chat error:", error);
    }

    // Store AI response
    const aiMessageRes = await pool.query<{ id: string }>(
      `INSERT INTO kb_chat_messages (session_id, role, content)
       VALUES ($1, 'assistant', $2)
       RETURNING id`,
      [params.id, aiResponse]
    );

    // Update session timestamp
    await pool.query(
      "UPDATE kb_chat_sessions SET updated_at = now() WHERE id = $1",
      [params.id]
    );

    const aiMessage = {
      id: aiMessageRes.rows[0].id,
      role: "assistant" as const,
      content: aiResponse,
      timestamp: new Date(),
      suggestions,
      relatedArticles,
    };

    return reply.send({ message: aiMessage });
  });

  server.post("/chat/sessions/:id/messages/:messageId/feedback", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({
      id: z.string().uuid(),
      messageId: z.string().uuid()
    }).parse(request.params);
    const body = z.object({ helpful: z.boolean() }).parse(request.body);
    const userId = (request as any).authUser?.id;

    // Verify session ownership
    const sessionCheck = await pool.query(
      "SELECT id FROM kb_chat_sessions WHERE id = $1 AND user_id = $2",
      [params.id, userId]
    );
    if (sessionCheck.rows.length === 0) {
      return reply.code(404).send({ message: "Session not found" });
    }

    await pool.query(
      `INSERT INTO kb_chat_feedback (session_id, message_id, user_id, helpful)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_id, message_id, user_id) DO UPDATE SET helpful = EXCLUDED.helpful`,
      [params.id, params.messageId, userId, body.helpful]
    );

    return reply.send({ ok: true });
  });

  // Semantic search endpoint for RAG
  server.post("/semantic-search", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = z.object({
      query: z.string().min(1),
      top_k: z.coerce.number().int().min(1).max(20).default(5),
    }).parse(request.body);
    const userId = (request as any).authUser?.id;
    const tierInfo = await resolveAiTier({ userId });

    // Get embedding from AI service
    let embedding: number[] = [];
    const aiUrl = env.AI_CLASSIFIER_URL;
    
    if (aiUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const embedRes = await fetch(`${aiUrl.replace('/predict', '')}/embed`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-ai-tier": tierInfo.tier },
          body: JSON.stringify({ text: body.query }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (embedRes.ok) {
          const embedData = await embedRes.json();
          if (Array.isArray(embedData.embedding)) {
            embedding = embedData.embedding;
            if (tierInfo.tier === "premium") {
              await incrementAiUsage(tierInfo.organizationId);
            }
          }
        }
      } catch (err) {
        console.error("Embedding generation failed:", err);
      }
    }

    // If no embedding available, fall back to text search
    if (embedding.length === 0) {
      const fallbackRes = await pool.query(
        `SELECT id, title, body, category, tags, 
                similarity(title || ' ' || body, $1) as similarity
         FROM kb_articles
         WHERE title ILIKE $2 OR body ILIKE $2
         ORDER BY similarity DESC
         LIMIT $3`,
        [body.query, `%${body.query}%`, body.top_k]
      );
      
      return reply.send({
        results: fallbackRes.rows.map(row => ({
          id: row.id,
          title: row.title,
          body: row.body,
          category: row.category,
          tags: row.tags,
          similarity: parseFloat(row.similarity) || 0,
        })),
        search_type: "text_fallback",
      });
    }

    // Use pgvector semantic search
    const vectorStr = `[${embedding.join(',')}]`;
    const searchRes = await pool.query(
      `SELECT * FROM search_kb_semantic($1::vector(384), 0.7, $2)`,
      [vectorStr, body.top_k]
    );

    return reply.send({
      results: searchRes.rows.map(row => ({
        id: row.id,
        title: row.title,
        body: row.body,
        category: row.category,
        tags: row.tags,
        similarity: parseFloat(row.similarity) || 0,
      })),
      search_type: "semantic",
    });
  });
};
