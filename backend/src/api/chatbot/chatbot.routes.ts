import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth } from "../../middlewares/auth.js";
import {
  createChatSession,
  getOrCreateSession,
  getSessionForUser,
  getSessionMessages,
  listChatSessionsForUser,
  saveMessage,
  generateResponse,
  createTicketFromChat,
  deleteChatSessionForUser,
  updateChatSessionForUser,
  cloneChatSessionForUser,
} from "../../services/chatbot/chatbot.service.js";
const audienceRoleSchema = z.enum(["EMPLOYEE", "AGENT", "ADMIN", "MANAGER"]);

const sendMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionToken: z.string().optional(),
  audienceRole: audienceRoleSchema.optional(),
});

const createTicketFromChatSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
});

export const chatbotRoutes: FastifyPluginAsync = async (server) => {
  // POST /chatbot/session - Create or get session
  server.post("/chatbot/session", { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.authUser!;
    const body = z
      .object({
        sessionToken: z.string().optional(),
        audienceRole: audienceRoleSchema.optional(),
        forceNew: z.boolean().optional(),
      })
      .parse(request.body || {});

    const session = body.forceNew
      ? await createChatSession(user.id, body.audienceRole ? { audienceRole: body.audienceRole } : null)
      : await getOrCreateSession(user.id, body.sessionToken);

    if (body.audienceRole && !body.forceNew) {
      try {
        await pool.query(
          "UPDATE chatbot_sessions SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('audienceRole', $2) WHERE id = $1",
          [session.id, body.audienceRole]
        );
      } catch {
        // ignore
      }
    }

    return reply.send({
      sessionId: session.id,
      sessionToken: session.sessionToken,
    });
  });

  server.get(
    "/chatbot/sessions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.authUser!;
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          includeArchived: z.coerce.boolean().default(false),
          cacheBust: z.string().optional(),
        })
        .parse(request.query);

      reply.header("Cache-Control", "no-store");
      const sessions = await listChatSessionsForUser(user.id, query.limit, query.includeArchived);
      return reply.send(sessions);
    }
  );

  // GET /chatbot/session/:sessionId/messages - Get session messages
  server.get(
    "/chatbot/session/:sessionId/messages",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.authUser!;
      const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          cacheBust: z.string().optional(),
        })
        .parse(request.query);

      reply.header("Cache-Control", "no-store");
      const messages = await getSessionMessages(params.sessionId, user.id, query.limit);
      return reply.send(messages);
    }
  );

  server.delete(
    "/chatbot/session/:sessionId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.authUser!;
      const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);

      const deleted = await deleteChatSessionForUser(params.sessionId, user.id);
      if (!deleted) {
        return reply.code(404).send({ message: "Chat session not found" });
      }

      return reply.send({ ok: true });
    }
  );

  server.patch(
    "/chatbot/session/:sessionId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.authUser!;
      const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          title: z.string().trim().min(1).max(120).optional(),
          pinned: z.boolean().optional(),
          archived: z.boolean().optional(),
        })
        .refine((value) => value.title !== undefined || value.pinned !== undefined || value.archived !== undefined, {
          message: "At least one session field is required",
        })
        .parse(request.body);

      const updated = await updateChatSessionForUser(params.sessionId, user.id, body);
      if (!updated) {
        return reply.code(404).send({ message: "Chat session not found" });
      }

      return reply.send(updated);
    }
  );

  server.post(
    "/chatbot/session/:sessionId/clone",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.authUser!;
      const params = z.object({ sessionId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          titlePrefix: z.string().trim().min(1).max(40).optional(),
        })
        .parse(request.body || {});

      const cloned = await cloneChatSessionForUser(params.sessionId, user.id, body);
      if (!cloned) {
        return reply.code(404).send({ message: "Chat session not found" });
      }

      return reply.code(201).send(cloned);
    }
  );

  // POST /chatbot/message - Send message to chatbot
  server.post("/chatbot/message", { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.authUser!;
    const body = sendMessageSchema.parse(request.body);

    // Get or create session
    const session = await getOrCreateSession(user.id, body.sessionToken);

    // Save user message
    await saveMessage({
      sessionId: session.id,
      role: "user",
      content: body.message,
    });

    // Generate response
    const response = await generateResponse({
      sessionId: session.id,
      userMessage: body.message,
      userId: user.id,
      audienceRole: body.audienceRole,
      llmProvider: "groq",
      aiTier: "free",
      organizationId: null,
    });

    // Save assistant response
    const assistantMessage = await saveMessage({
      sessionId: session.id,
      role: "assistant",
      content: response.response,
      intent: response.intent,
      confidence: response.confidence,
      kbArticlesSuggested: response.kbArticles?.map((a) => a.id),
      autoResolved: response.autoResolved,
    });

    return reply.send({
      sessionId: session.id,
      message: assistantMessage,
      kbArticles: response.kbArticles,
      ticketReadiness: response.ticketReadiness ?? null,
      shouldCreateTicket: response.shouldCreateTicket,
      ticketCreated: null,
      sessionToken: session.sessionToken,
    });
  });

  // POST /chatbot/create-ticket - Create ticket from chat session
  server.post(
    "/chatbot/create-ticket",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const user = request.authUser!;
      const body = createTicketFromChatSchema.parse(request.body);
      const session = await getSessionForUser(body.sessionId, user.id);
      if (!session) {
        return reply.code(404).send({ message: "Chat session not found" });
      }

      const ticketId = await createTicketFromChat(
        body.sessionId,
        user.id,
        body.title || "Chat support request",
        body.description || "Created from chatbot conversation"
      );

      // Save system message
      await saveMessage({
        sessionId: body.sessionId,
        role: "system",
        content: `Ticket ${ticketId} created successfully.`,
        ticketCreatedId: ticketId,
      });

      return reply.send({ ticketId });
    }
  );
};
