import crypto from "crypto";
import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { pool } from "../../config/db.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { createTicket, TicketPriority } from "../../services/tickets/ticket.service.js";

const channelTypeSchema = z.enum(["SLACK", "TEAMS"]);

const createChannelIntegrationSchema = z.object({
  name: z.string().min(1).max(120),
  channel_type: channelTypeSchema,
  inbound_secret: z.string().min(10).max(200).optional(),
  enabled: z.boolean().default(true),
  default_requester_id: z.string().uuid().nullable().optional(),
  default_priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  default_category: z.string().max(120).nullable().optional(),
  auto_create_ticket: z.boolean().default(true),
});

const updateChannelIntegrationSchema = createChannelIntegrationSchema.partial();

type ChannelIntegrationRow = {
  id: string;
  name: string;
  channel_type: "SLACK" | "TEAMS";
  inbound_secret: string;
  enabled: boolean;
  default_requester_id: string | null;
  default_priority: TicketPriority;
  default_category: string | null;
  auto_create_ticket: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type NormalizedChannelMessage = {
  text: string;
  senderEmail: string | null;
  senderName: string | null;
  externalMessageId: string | null;
  channelRoomId: string | null;
  raw: Record<string, unknown>;
};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const stripHtml = (value: string): string =>
  value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();

const normalizePayload = (
  channelType: "SLACK" | "TEAMS",
  payload: Record<string, unknown>
): NormalizedChannelMessage => {
  if (channelType === "SLACK") {
    const event = (payload.event || {}) as Record<string, unknown>;
    const rawText = firstString(
      event.text,
      payload.text,
      (payload.message as Record<string, unknown> | undefined)?.text
    );
    const senderEmail = firstString(
      event.user_email,
      payload.user_email,
      (payload.sender as Record<string, unknown> | undefined)?.email,
      (payload.user as Record<string, unknown> | undefined)?.email
    );
    const senderName = firstString(
      event.user_name,
      payload.user_name,
      (payload.sender as Record<string, unknown> | undefined)?.name,
      (payload.user as Record<string, unknown> | undefined)?.name
    );
    const externalMessageId = firstString(event.client_msg_id, event.ts, payload.ts, payload.message_id);
    const channelRoomId = firstString(event.channel, payload.channel, payload.channel_id);

    return {
      text: rawText || "",
      senderEmail,
      senderName,
      externalMessageId,
      channelRoomId,
      raw: payload,
    };
  }

  const from = (payload.from as Record<string, unknown> | undefined) || {};
  const body = (payload.body as Record<string, unknown> | undefined) || {};
  const message = (payload.message as Record<string, unknown> | undefined) || {};
  const sender = (payload.sender as Record<string, unknown> | undefined) || {};

  const rawText = firstString(
    payload.text,
    message.text,
    body.content,
    (payload.value as Record<string, unknown> | undefined)?.text
  );

  return {
    text: rawText ? stripHtml(rawText) : "",
    senderEmail: firstString(from.email, sender.email, payload.user_email),
    senderName: firstString(from.name, sender.name, payload.user_name),
    externalMessageId: firstString(payload.id, message.id, payload.message_id),
    channelRoomId: firstString(payload.channel_id, payload.conversation_id, payload.tenant_id),
    raw: payload,
  };
};

const inferPriority = (text: string, fallback: TicketPriority): TicketPriority => {
  const lower = text.toLowerCase();
  if (/(critical|sev[\s-]?1|system down|outage|urgent)/.test(lower)) return "HIGH";
  if (/(soon|blocked|cannot work|major)/.test(lower)) return "MEDIUM";
  return fallback;
};

const inferCategory = (text: string, fallback: string | null): string | null => {
  const lower = text.toLowerCase();
  if (/(vpn|network|wifi|internet)/.test(lower)) return "NETWORK";
  if (/(password|account|login|mfa|access)/.test(lower)) return "ACCOUNT";
  if (/(printer|laptop|hardware|keyboard|mouse)/.test(lower)) return "HARDWARE";
  if (/(email|outlook|mail)/.test(lower)) return "EMAIL";
  if (/(sap|erp|crm|application|software)/.test(lower)) return "SOFTWARE";
  return fallback;
};

const resolveRequester = async (args: {
  senderEmail: string | null;
  fallbackUserId: string | null;
}): Promise<{ userId: string | null; reason: string | null }> => {
  if (args.senderEmail) {
    const res = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
      [args.senderEmail]
    );
    if (res.rows[0]?.id) {
      return { userId: res.rows[0].id, reason: null };
    }
  }

  if (args.fallbackUserId) {
    return {
      userId: args.fallbackUserId,
      reason: args.senderEmail
        ? "Sender email was not mapped to a user; default requester used"
        : "Sender email missing; default requester used",
    };
  }

  return {
    userId: null,
    reason: args.senderEmail
      ? "Sender email not mapped to any user and no default requester configured"
      : "Sender email missing and no default requester configured",
  };
};

const insertChannelEvent = async (args: {
  integrationId: string;
  channelType: "SLACK" | "TEAMS";
  externalMessageId: string | null;
  senderEmail: string | null;
  senderName: string | null;
  channelRoomId: string | null;
  messagePreview: string | null;
  action: "CREATED" | "IGNORED" | "ERROR";
  reason: string | null;
  classifierLabel: string | null;
  classifierConfidence: number | null;
  createdTicketId: string | null;
}) => {
  await pool.query(
    `INSERT INTO channel_ingestion_events
      (integration_id, channel_type, external_message_id, sender_email, sender_name, channel_room_id, message_preview,
       action, reason, classifier_label, classifier_confidence, created_ticket_id)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12)`,
    [
      args.integrationId,
      args.channelType,
      args.externalMessageId,
      args.senderEmail,
      args.senderName,
      args.channelRoomId,
      args.messagePreview,
      args.action,
      args.reason,
      args.classifierLabel,
      args.classifierConfidence,
      args.createdTicketId,
    ]
  );
};

export const channelIntegrationRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    "/integrations/channels",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (_request, reply) => {
      const result = await pool.query(
        `SELECT
           id,
           name,
           channel_type,
           enabled,
           default_requester_id,
           default_priority,
           default_category,
           auto_create_ticket,
           created_by,
           created_at,
           updated_at,
           CASE
             WHEN length(inbound_secret) >= 8 THEN left(inbound_secret, 4) || '...' || right(inbound_secret, 4)
             ELSE 'configured'
           END AS secret_hint
         FROM channel_integrations
         ORDER BY channel_type ASC, created_at DESC`
      );

      return reply.send(result.rows);
    }
  );

  server.post(
    "/integrations/channels",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const user = request.authUser!;
      const body = createChannelIntegrationSchema.parse(request.body);
      const inboundSecret = body.inbound_secret || crypto.randomBytes(24).toString("hex");

      const result = await pool.query<ChannelIntegrationRow>(
        `INSERT INTO channel_integrations
          (name, channel_type, inbound_secret, enabled, default_requester_id, default_priority, default_category, auto_create_ticket, created_by)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          body.name,
          body.channel_type,
          inboundSecret,
          body.enabled,
          body.default_requester_id ?? null,
          body.default_priority,
          body.default_category ?? null,
          body.auto_create_ticket,
          user.id,
        ]
      );

      const row = result.rows[0];
      return reply.code(201).send({
        ...row,
        webhook_url: `/api/v1/integrations/channels/webhook/${row.channel_type.toLowerCase()}/${row.id}`,
      });
    }
  );

  server.patch(
    "/integrations/channels/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = updateChannelIntegrationSchema.parse(request.body);

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;

      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        updates.push(`${key} = $${idx}`);
        values.push(value);
        idx += 1;
      }

      if (updates.length === 0) {
        return reply.code(400).send({ message: "No fields to update" });
      }

      values.push(params.id);
      const result = await pool.query<ChannelIntegrationRow>(
        `UPDATE channel_integrations
         SET ${updates.join(", ")}, updated_at = now()
         WHERE id = $${idx}
         RETURNING *`,
        values
      );

      const row = result.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Integration not found" });
      return reply.send(row);
    }
  );

  server.post(
    "/integrations/channels/:id/rotate-secret",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const nextSecret = crypto.randomBytes(24).toString("hex");

      const result = await pool.query<ChannelIntegrationRow>(
        `UPDATE channel_integrations
         SET inbound_secret = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [params.id, nextSecret]
      );

      const row = result.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Integration not found" });
      return reply.send({ id: row.id, inbound_secret: row.inbound_secret });
    }
  );

  server.delete(
    "/integrations/channels/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const res = await pool.query("DELETE FROM channel_integrations WHERE id = $1", [params.id]);
      if (res.rowCount === 0) return reply.code(404).send({ message: "Integration not found" });
      return reply.code(204).send();
    }
  );

  server.get(
    "/integrations/channels/:id/events",
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
          `SELECT id, integration_id, channel_type, external_message_id, sender_email, sender_name,
                  channel_room_id, message_preview, action, reason, classifier_label, classifier_confidence,
                  created_ticket_id, created_at
           FROM channel_ingestion_events
           WHERE integration_id = $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [params.id, query.limit, query.offset]
        ),
        pool.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total FROM channel_ingestion_events WHERE integration_id = $1`,
          [params.id]
        ),
      ]);

      return reply.send({
        items: itemsRes.rows,
        total: parseInt(countRes.rows[0]?.total || "0", 10),
      });
    }
  );

  server.post(
    "/integrations/channels/webhook/:channelType/:integrationId",
    async (request, reply) => {
      const params = z
        .object({
          channelType: z.string().transform((v) => v.toUpperCase()),
          integrationId: z.string().uuid(),
        })
        .parse(request.params);
      const parsedType = channelTypeSchema.safeParse(params.channelType);
      if (!parsedType.success) {
        return reply.code(400).send({ message: "Unsupported channel type" });
      }

      const channelType = parsedType.data;
      const payload = (request.body as Record<string, unknown> | null) || {};

      // Slack URL verification handshake support
      if (
        channelType === "SLACK" &&
        payload.type === "url_verification" &&
        typeof payload.challenge === "string"
      ) {
        return reply.send({ challenge: payload.challenge });
      }

      const integrationRes = await pool.query<ChannelIntegrationRow>(
        `SELECT *
         FROM channel_integrations
         WHERE id = $1 AND channel_type = $2 AND enabled = true`,
        [params.integrationId, channelType]
      );

      const integration = integrationRes.rows[0] ?? null;
      if (!integration) {
        return reply.code(404).send({ message: "Integration not found" });
      }

      const secretFromHeader = String((request.headers["x-channel-secret"] as string | undefined) || "").trim();
      const secretFromPayload = firstString(payload.secret, payload.token, (payload.meta as any)?.secret) || "";
      const providedSecret = secretFromHeader || secretFromPayload;

      if (!providedSecret || providedSecret !== integration.inbound_secret) {
        await insertChannelEvent({
          integrationId: integration.id,
          channelType,
          externalMessageId: null,
          senderEmail: null,
          senderName: null,
          channelRoomId: null,
          messagePreview: null,
          action: "ERROR",
          reason: "Invalid channel secret",
          classifierLabel: null,
          classifierConfidence: null,
          createdTicketId: null,
        });
        return reply.code(401).send({ message: "Unauthorized" });
      }

      const normalized = normalizePayload(channelType, payload);
      const messageText = normalized.text.trim();

      if (!messageText) {
        await insertChannelEvent({
          integrationId: integration.id,
          channelType,
          externalMessageId: normalized.externalMessageId,
          senderEmail: normalized.senderEmail,
          senderName: normalized.senderName,
          channelRoomId: normalized.channelRoomId,
          messagePreview: null,
          action: "IGNORED",
          reason: "No text message in payload",
          classifierLabel: null,
          classifierConfidence: null,
          createdTicketId: null,
        });
        return reply.send({ ok: true, created: false, reason: "No message text" });
      }

      const predictedPriority = inferPriority(messageText, integration.default_priority);
      const predictedCategory = inferCategory(messageText, integration.default_category);
      const classifierLabel = predictedCategory || "GENERAL";
      const classifierConfidence = predictedCategory ? 0.75 : 0.55;

      if (!integration.auto_create_ticket) {
        await insertChannelEvent({
          integrationId: integration.id,
          channelType,
          externalMessageId: normalized.externalMessageId,
          senderEmail: normalized.senderEmail,
          senderName: normalized.senderName,
          channelRoomId: normalized.channelRoomId,
          messagePreview: messageText.slice(0, 280),
          action: "IGNORED",
          reason: "Auto-create ticket disabled for integration",
          classifierLabel,
          classifierConfidence,
          createdTicketId: null,
        });
        return reply.send({ ok: true, created: false, reason: "Auto-create disabled" });
      }

      const requester = await resolveRequester({
        senderEmail: normalized.senderEmail,
        fallbackUserId: integration.default_requester_id,
      });

      if (!requester.userId) {
        await insertChannelEvent({
          integrationId: integration.id,
          channelType,
          externalMessageId: normalized.externalMessageId,
          senderEmail: normalized.senderEmail,
          senderName: normalized.senderName,
          channelRoomId: normalized.channelRoomId,
          messagePreview: messageText.slice(0, 280),
          action: "ERROR",
          reason: requester.reason,
          classifierLabel,
          classifierConfidence,
          createdTicketId: null,
        });
        return reply.code(422).send({ message: requester.reason || "Unable to resolve requester" });
      }

      const titleSeed = messageText.split(/\r?\n/)[0] || messageText;
      const title = `[${channelType}] ${titleSeed.replace(/\s+/g, " ").slice(0, 160)}`;

      const description = [
        `Channel: ${channelType}`,
        normalized.senderName ? `Sender: ${normalized.senderName}` : null,
        normalized.senderEmail ? `Sender Email: ${normalized.senderEmail}` : null,
        normalized.channelRoomId ? `Channel/Room: ${normalized.channelRoomId}` : null,
        normalized.externalMessageId ? `Message Id: ${normalized.externalMessageId}` : null,
        "",
        messageText,
      ]
        .filter(Boolean)
        .join("\n");

      const ticket = await createTicket({
        title,
        description,
        createdBy: requester.userId,
        performedBy: requester.userId,
        type: "INCIDENT",
        priority: predictedPriority,
        category: predictedCategory,
        sourceType: channelType,
        sourceReference: {
          integration_id: integration.id,
          channel_room_id: normalized.channelRoomId,
          message_id: normalized.externalMessageId,
          sender_email: normalized.senderEmail,
          sender_name: normalized.senderName,
        },
        integrationMetadata: {
          channel_ingestion: {
            integration_id: integration.id,
            channel_type: channelType,
            requester_resolution_reason: requester.reason,
          },
        },
      });

      await insertChannelEvent({
        integrationId: integration.id,
        channelType,
        externalMessageId: normalized.externalMessageId,
        senderEmail: normalized.senderEmail,
        senderName: normalized.senderName,
        channelRoomId: normalized.channelRoomId,
        messagePreview: messageText.slice(0, 280),
        action: "CREATED",
        reason: requester.reason,
        classifierLabel,
        classifierConfidence,
        createdTicketId: ticket.id,
      });

      return reply.code(201).send({
        ok: true,
        created: true,
        ticket_id: ticket.id,
        display_number: ticket.display_number,
      });
    }
  );
};
