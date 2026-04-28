import { createHash } from "crypto";
import nodemailer from "nodemailer";
import { pool } from "../../config/db.js";
import { env } from "../../config/env.js";
import { getIO } from "../../websocket/socket-server.js";
import { generateGroqRoleBasedChat } from "../ai/groq.service.js";
import { generateGeminiContent, isGeminiConfigured } from "../ai/gemini.service.js";

export type NotificationType =
  | "TICKET_CREATED"
  | "TICKET_ASSIGNED"
  | "TICKET_STATUS_CHANGED"
  | "TICKET_COMMENTED"
  | "TICKET_SLA_RISK"
  | "TICKET_ESCALATED"
  | "SLA_FIRST_RESPONSE_BREACH"
  | "SLA_RESOLUTION_BREACH"
  | "APPROVAL_REQUESTED"
  | "TIME_OFF_REQUESTED"
  | "TIME_OFF_APPROVED"
  | "TIME_OFF_DENIED";

export type NotificationAudienceRole = "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";

export type NotificationRow = {
  id: string;
  user_id: string;
  ticket_id: string | null;
  actor_user_id: string | null;
  audience_role: NotificationAudienceRole | null;
  type: NotificationType;
  title: string;
  body: string;
  action_url: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

type InsertNotificationArgs = {
  userId: string;
  ticketId?: string | null;
  actorUserId?: string | null;
  audienceRole?: NotificationAudienceRole | null;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
};

type NotificationChannel = "IN_APP" | "EMAIL";
type NotificationAiProvider = "none" | "gemini" | "groq";

type GeneratedNotificationCopy = {
  title: string;
  body: string;
  emailSubject: string;
  emailBody: string;
};

type DispatchNotificationArgs = InsertNotificationArgs & {
  emailEnabled?: boolean;
  emailTo?: string | null;
  channelHint?: NotificationChannel;
};

type TicketContext = {
  ticketId: string;
  title: string;
  priority: string;
  status: string;
  requesterId: string;
  requesterName: string;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  assignedTeamId: string | null;
  assignedTeamName: string | null;
  teamManagerId: string | null;
  teamManagerName: string | null;
};

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

const buildActionUrl = (role: NotificationAudienceRole, ticketId: string) =>
  role === "EMPLOYEE" ? `/app/tickets/${ticketId}` : `/admin/tickets/${ticketId}`;

const emitNotification = (notification: NotificationRow) => {
  const io = getIO();
  if (!io) return;
  io.to(`user:${notification.user_id}`).emit("notification:new", notification);
};

const isAiNotificationEnabled = env.AI_NOTIFICATIONS_ENABLED !== "false";
const isEmailChannelEnabled = env.AI_NOTIFICATIONS_EMAIL_ENABLED !== "false";

const resolveNotificationAiProvider = (): NotificationAiProvider => {
  const configured = (env.AI_NOTIFICATION_PROVIDER || "auto").toLowerCase();

  if (configured === "none") return "none";
  if (configured === "gemini") return isGeminiConfigured() ? "gemini" : "none";
  if (configured === "groq") return env.GROQ_API_KEY ? "groq" : "none";

  if (isGeminiConfigured()) return "gemini";
  if (env.GROQ_API_KEY) return "groq";
  return "none";
};

const resolveWebUrl = (actionUrl: string | null | undefined): string | null => {
  if (!actionUrl) return null;
  if (/^https?:\/\//i.test(actionUrl)) return actionUrl;
  const base = (env.PUBLIC_WEB_URL || env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`}`;
};

const parseStructuredCopy = (value: string): Partial<GeneratedNotificationCopy> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const sanitizeCopy = (copy: Partial<GeneratedNotificationCopy>, fallbackTitle: string, fallbackBody: string, ticketId?: string | null) => {
  const title = typeof copy.title === "string" && copy.title.trim() ? copy.title.trim().slice(0, 120) : fallbackTitle;
  const body = typeof copy.body === "string" && copy.body.trim() ? copy.body.trim().slice(0, 360) : fallbackBody;
  const reference = ticketId ? `Ticket ${ticketId.slice(0, 8).toUpperCase()}` : "IT Support";
  const emailSubject =
    typeof copy.emailSubject === "string" && copy.emailSubject.trim()
      ? copy.emailSubject.trim().slice(0, 160)
      : `[${reference}] ${title}`;
  const emailBody =
    typeof copy.emailBody === "string" && copy.emailBody.trim()
      ? copy.emailBody.trim()
      : `${title}\n\n${body}`;

  return { title, body, emailSubject, emailBody };
};

const roleContext = (role: NotificationAudienceRole | null | undefined) => {
  if (role === "ADMIN") return "Admin recipient: concise governance and oversight tone.";
  if (role === "MANAGER") return "Manager recipient: operational workload and SLA tone.";
  if (role === "AGENT") return "Agent recipient: action-focused and technical tone.";
  return "Employee recipient: clear and friendly non-technical tone.";
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

const generateNotificationCopy = async (args: {
  type: NotificationType;
  title: string;
  body: string;
  ticketId?: string | null;
  audienceRole?: NotificationAudienceRole | null;
  channelHint?: NotificationChannel;
  metadata?: Record<string, unknown>;
}): Promise<GeneratedNotificationCopy> => {
  const fallback = sanitizeCopy({}, args.title, args.body, args.ticketId);
  if (!isAiNotificationEnabled) return fallback;
  const provider = resolveNotificationAiProvider();
  if (provider === "none") return fallback;

  try {
    const systemPrompt =
      "You write enterprise ITSM notification copy. Return STRICT JSON only with keys title, body, emailSubject, emailBody. " +
      "No markdown. Keep title under 70 chars, body under 220 chars, crisp and role-appropriate.";
    const userPrompt = [
      `EventType: ${args.type}`,
      `RoleContext: ${roleContext(args.audienceRole)}`,
      `TicketId: ${args.ticketId || "N/A"}`,
      `ChannelHint: ${args.channelHint || "IN_APP"}`,
      `FallbackTitle: ${args.title}`,
      `FallbackBody: ${args.body}`,
      `Metadata: ${JSON.stringify(args.metadata || {})}`,
    ].join("\n");
    const timeoutMs = Number(env.AI_NOTIFICATION_TIMEOUT_MS || 1400);

    const content =
      provider === "gemini"
        ? await withTimeout(
            generateGeminiContent({
              model: env.GEMINI_MODEL || "gemini-2.0-flash",
              systemPrompt,
              userPrompt,
              responseMimeType: "application/json",
              temperature: 0.2,
              maxOutputTokens: 360,
            }),
            timeoutMs
          )
        : await withTimeout(
            generateGroqRoleBasedChat({
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
            timeoutMs
          );

    const parsed = parseStructuredCopy(content);
    if (!parsed) return fallback;
    return sanitizeCopy(parsed, args.title, args.body, args.ticketId);
  } catch {
    return fallback;
  }
};

const getUserEmail = async (userId: string): Promise<string | null> => {
  const result = await pool.query<{ email: string | null }>("SELECT email FROM users WHERE id = $1", [userId]);
  return result.rows[0]?.email || null;
};

const sendNotificationEmail = async (args: {
  to: string;
  subject: string;
  body: string;
  actionUrl?: string | null;
}) => {
  const host = env.SMTP_HOST;
  const port = env.SMTP_PORT;
  const from = env.SMTP_FROM;
  if (!host || !port || !from) return;

  const actionLink = resolveWebUrl(args.actionUrl || null);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth:
      env.SMTP_USERNAME && env.SMTP_PASSWORD
        ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
        : undefined,
  });

  const finalBody = actionLink
    ? `${args.body}\n\nOpen in portal: ${actionLink}`
    : args.body;

  await transporter.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    text: finalBody,
  });
};

const dedupeFromArgs = (args: InsertNotificationArgs) =>
  sha256Hex(
    [
      "notification",
      args.userId,
      args.ticketId || "",
      args.type,
      args.title,
      args.body,
      args.audienceRole || "",
      args.actionUrl || "",
    ].join("|")
  );

export const insertNotification = async (args: InsertNotificationArgs): Promise<NotificationRow | null> => {
  const dedupeKey = args.dedupeKey || dedupeFromArgs(args);
  const result = await pool.query<NotificationRow>(
    `INSERT INTO notifications
      (user_id, ticket_id, actor_user_id, audience_role, type, title, body, action_url, metadata, dedupe_key)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id, user_id, ticket_id, actor_user_id, audience_role, type, title, body, action_url, metadata, read_at, created_at`,
    [
      args.userId,
      args.ticketId ?? null,
      args.actorUserId ?? null,
      args.audienceRole ?? null,
      args.type,
      args.title,
      args.body,
      args.actionUrl ?? null,
      JSON.stringify(args.metadata || {}),
      dedupeKey,
    ]
  );

  const row = result.rows[0] ?? null;
  if (row) emitNotification(row);
  return row;
};

export const dispatchNotification = async (args: DispatchNotificationArgs): Promise<NotificationRow | null> => {
  const generated = await generateNotificationCopy({
    type: args.type,
    title: args.title,
    body: args.body,
    ticketId: args.ticketId,
    audienceRole: args.audienceRole,
    metadata: args.metadata,
    channelHint: args.channelHint || "IN_APP",
  });

  const row = await insertNotification({
    ...args,
    title: generated.title,
    body: generated.body,
  });

  if (!row) return null;

  if (!isEmailChannelEnabled || !args.emailEnabled) {
    return row;
  }

  const emailTo = args.emailTo || (await getUserEmail(args.userId));
  if (!emailTo) return row;

  try {
    await sendNotificationEmail({
      to: emailTo,
      subject: generated.emailSubject,
      body: generated.emailBody,
      actionUrl: row.action_url,
    });
  } catch {
    // email fan-out should not fail in-app delivery
  }

  return row;
};

const getAdminIds = async (): Promise<string[]> => {
  const result = await pool.query<{ id: string }>("SELECT id FROM users WHERE role = 'ADMIN'");
  return result.rows.map((row) => row.id);
};

const getTicketContext = async (ticketId: string): Promise<TicketContext | null> => {
  const result = await pool.query<TicketContext>(
    `SELECT
       t.id AS "ticketId",
       t.title,
       t.priority,
       t.status,
       requester.id AS "requesterId",
       requester.name AS "requesterName",
       agent.id AS "assignedAgentId",
       agent.name AS "assignedAgentName",
       team.id AS "assignedTeamId",
       team.name AS "assignedTeamName",
       manager.id AS "teamManagerId",
       manager.name AS "teamManagerName"
     FROM tickets t
     JOIN users requester ON requester.id = t.created_by
     LEFT JOIN users agent ON agent.id = t.assigned_agent
     LEFT JOIN teams team ON team.id = t.assigned_team
     LEFT JOIN users manager ON manager.id = team.manager_id
     WHERE t.id = $1`,
    [ticketId]
  );
  return result.rows[0] ?? null;
};

export const notifyTicketCreated = async (ticketId: string) => {
  const context = await getTicketContext(ticketId);
  if (!context) return;

  await dispatchNotification({
    userId: context.requesterId,
    ticketId,
    audienceRole: "EMPLOYEE",
    type: "TICKET_CREATED",
    title: "Ticket submitted successfully",
    body: `${context.title} is now in the queue.`,
    actionUrl: buildActionUrl("EMPLOYEE", ticketId),
    metadata: { priority: context.priority, status: context.status },
    dedupeKey: sha256Hex(["ticket-created", context.requesterId, ticketId].join("|")),
    emailEnabled: true,
  });

  if (context.priority === "HIGH") {
    const adminIds = await getAdminIds();
    await Promise.all(
      adminIds.map((adminId) =>
        dispatchNotification({
          userId: adminId,
          ticketId,
          audienceRole: "ADMIN",
          type: "TICKET_CREATED",
          title: "High-priority ticket requires oversight",
          body: `${context.requesterName} opened ${context.title}.`,
          actionUrl: buildActionUrl("ADMIN", ticketId),
          metadata: { priority: context.priority, status: context.status, requesterId: context.requesterId },
          dedupeKey: sha256Hex(["ticket-created-admin", adminId, ticketId].join("|")),
          emailEnabled: true,
        })
      )
    );
  }
};

export const notifyTicketAssigned = async (ticketId: string, actorUserId?: string | null) => {
  const context = await getTicketContext(ticketId);
  if (!context) return;

  if (context.assignedAgentId) {
    await dispatchNotification({
      userId: context.assignedAgentId,
      ticketId,
      actorUserId,
      audienceRole: "AGENT",
      type: "TICKET_ASSIGNED",
      title: "Ticket assigned to you",
      body: `${context.title} is ready for action.`,
      actionUrl: buildActionUrl("AGENT", ticketId),
      metadata: { priority: context.priority, status: context.status, teamId: context.assignedTeamId },
      dedupeKey: sha256Hex(["ticket-assigned-agent", context.assignedAgentId, ticketId, context.status].join("|")),
      emailEnabled: true,
    });
  }

  if (context.teamManagerId) {
    await dispatchNotification({
      userId: context.teamManagerId,
      ticketId,
      actorUserId,
      audienceRole: "MANAGER",
      type: "TICKET_ASSIGNED",
      title: "Ticket routed to your team",
      body: `${context.title} has been routed to ${context.assignedTeamName || "your team"}.`,
      actionUrl: buildActionUrl("MANAGER", ticketId),
      metadata: {
        priority: context.priority,
        status: context.status,
        assignedAgentId: context.assignedAgentId,
        assignedTeamId: context.assignedTeamId,
      },
      dedupeKey: sha256Hex(["ticket-assigned-manager", context.teamManagerId, ticketId, context.assignedAgentId || ""].join("|")),
      emailEnabled: true,
    });
  }
};

export const notifyTicketStatusChanged = async (ticketId: string, actorUserId?: string | null) => {
  const context = await getTicketContext(ticketId);
  if (!context) return;

  await dispatchNotification({
    userId: context.requesterId,
    ticketId,
    actorUserId,
    audienceRole: "EMPLOYEE",
    type: "TICKET_STATUS_CHANGED",
    title: "Ticket status updated",
    body: `${context.title} is now ${context.status.replaceAll("_", " ").toLowerCase()}.`,
    actionUrl: buildActionUrl("EMPLOYEE", ticketId),
    metadata: { priority: context.priority, status: context.status },
    dedupeKey: sha256Hex(["ticket-status-requester", context.requesterId, ticketId, context.status].join("|")),
    emailEnabled: true,
  });

  if (context.assignedAgentId && context.assignedAgentId !== actorUserId) {
    await dispatchNotification({
      userId: context.assignedAgentId,
      ticketId,
      actorUserId,
      audienceRole: "AGENT",
      type: "TICKET_STATUS_CHANGED",
      title: "Ticket status changed",
      body: `${context.title} is now ${context.status.replaceAll("_", " ").toLowerCase()}.`,
      actionUrl: buildActionUrl("AGENT", ticketId),
      metadata: { priority: context.priority, status: context.status },
      dedupeKey: sha256Hex(["ticket-status-agent", context.assignedAgentId, ticketId, context.status].join("|")),
      emailEnabled: true,
    });
  }

  if (context.teamManagerId && context.teamManagerId !== actorUserId) {
    await dispatchNotification({
      userId: context.teamManagerId,
      ticketId,
      actorUserId,
      audienceRole: "MANAGER",
      type: "TICKET_STATUS_CHANGED",
      title: "Team ticket moved forward",
      body: `${context.title} is now ${context.status.replaceAll("_", " ").toLowerCase()}.`,
      actionUrl: buildActionUrl("MANAGER", ticketId),
      metadata: { priority: context.priority, status: context.status, assignedAgentId: context.assignedAgentId },
      dedupeKey: sha256Hex(["ticket-status-manager", context.teamManagerId, ticketId, context.status].join("|")),
      emailEnabled: true,
    });
  }
};

export const notifyTicketCommented = async (args: {
  ticketId: string;
  authorId: string;
  authorRole: NotificationAudienceRole | null;
}) => {
  const context = await getTicketContext(args.ticketId);
  if (!context) return;

  if (args.authorId === context.requesterId) {
    if (context.assignedAgentId) {
      await dispatchNotification({
        userId: context.assignedAgentId,
        ticketId: args.ticketId,
        actorUserId: args.authorId,
        audienceRole: "AGENT",
        type: "TICKET_COMMENTED",
        title: "Customer replied on an assigned ticket",
        body: `${context.requesterName} added an update to ${context.title}.`,
        actionUrl: buildActionUrl("AGENT", args.ticketId),
        metadata: { priority: context.priority, status: context.status },
        dedupeKey: sha256Hex(["ticket-comment-agent", context.assignedAgentId, args.ticketId, Date.now()].join("|")),
        emailEnabled: true,
      });
    }

    if (context.teamManagerId) {
      await dispatchNotification({
        userId: context.teamManagerId,
        ticketId: args.ticketId,
        actorUserId: args.authorId,
        audienceRole: "MANAGER",
        type: "TICKET_COMMENTED",
        title: "Customer replied to a team ticket",
        body: `${context.requesterName} added an update to ${context.title}.`,
        actionUrl: buildActionUrl("MANAGER", args.ticketId),
        metadata: { priority: context.priority, status: context.status, assignedAgentId: context.assignedAgentId },
        dedupeKey: sha256Hex(["ticket-comment-manager", context.teamManagerId, args.ticketId, Date.now()].join("|")),
        emailEnabled: true,
      });
    }
    return;
  }

  await dispatchNotification({
    userId: context.requesterId,
    ticketId: args.ticketId,
    actorUserId: args.authorId,
    audienceRole: "EMPLOYEE",
    type: "TICKET_COMMENTED",
    title: "New update from support",
    body: `Support added a new update to ${context.title}.`,
    actionUrl: buildActionUrl("EMPLOYEE", args.ticketId),
    metadata: { priority: context.priority, status: context.status, authorRole: args.authorRole },
    dedupeKey: sha256Hex(["ticket-comment-requester", context.requesterId, args.ticketId, Date.now()].join("|")),
    emailEnabled: true,
  });
};

export const notifyApprovalRequested = async (args: {
  targetUserId: string;
  ticketId: string;
  actionTitle: string;
  actorUserId?: string | null;
  audienceRole?: NotificationAudienceRole | null;
}) => {
  await dispatchNotification({
    userId: args.targetUserId,
    ticketId: args.ticketId,
    actorUserId: args.actorUserId ?? null,
    audienceRole: args.audienceRole ?? null,
    type: "APPROVAL_REQUESTED",
    title: "Approval required",
    body: args.actionTitle,
    actionUrl: buildActionUrl(args.audienceRole === "EMPLOYEE" ? "EMPLOYEE" : "MANAGER", args.ticketId),
    dedupeKey: sha256Hex(["approval-requested", args.targetUserId, args.ticketId, args.actionTitle].join("|")),
    emailEnabled: true,
  });
};

export const notifySlaRisk = async (args: {
  ticketId: string;
  risk: "MEDIUM" | "HIGH";
  title: string;
  body: string;
}) => {
  const context = await getTicketContext(args.ticketId);
  if (!context) return;

  if (context.assignedAgentId) {
    await dispatchNotification({
      userId: context.assignedAgentId,
      ticketId: args.ticketId,
      audienceRole: "AGENT",
      type: "TICKET_SLA_RISK",
      title: args.title,
      body: args.body,
      actionUrl: buildActionUrl("AGENT", args.ticketId),
      metadata: { risk: args.risk, priority: context.priority, status: context.status },
      dedupeKey: sha256Hex(["sla-risk-agent", context.assignedAgentId, args.ticketId, args.risk].join("|")),
      emailEnabled: true,
    });
  }

  if (context.teamManagerId) {
    await dispatchNotification({
      userId: context.teamManagerId,
      ticketId: args.ticketId,
      audienceRole: "MANAGER",
      type: "TICKET_SLA_RISK",
      title: args.title,
      body: args.body,
      actionUrl: buildActionUrl("MANAGER", args.ticketId),
      metadata: { risk: args.risk, priority: context.priority, status: context.status },
      dedupeKey: sha256Hex(["sla-risk-manager", context.teamManagerId, args.ticketId, args.risk].join("|")),
      emailEnabled: true,
    });
  }

  if (!context.assignedAgentId || args.risk === "HIGH") {
    const adminIds = await getAdminIds();
    await Promise.all(
      adminIds.map((adminId) =>
        dispatchNotification({
          userId: adminId,
          ticketId: args.ticketId,
          audienceRole: "ADMIN",
        type: "TICKET_SLA_RISK",
          title: args.title,
          body: args.body,
          actionUrl: buildActionUrl("ADMIN", args.ticketId),
          metadata: { risk: args.risk, priority: context.priority, status: context.status },
          dedupeKey: sha256Hex(["sla-risk-admin", adminId, args.ticketId, args.risk].join("|")),
          emailEnabled: true,
        })
      )
    );
  }
};
