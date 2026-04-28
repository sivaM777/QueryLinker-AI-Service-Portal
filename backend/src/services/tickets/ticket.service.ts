import { createHash } from "crypto";
import { pool } from "../../config/db.js";
import { env } from "../../config/env.js";
import nodemailer from "nodemailer";
import { findSimilarOpenTicket } from "./ticket-dedupe.service.js";
import { analyzeSentiment, routeTicketBySentiment } from "../ai/sentiment-routing.service.js";
import { getOrganizationIdForUser, resolveAiTier } from "../ai/tier-routing.service.js";
import { analyzeAndExecuteAction } from "../ai/action-taking-ai.service.js";
import { enrichTicketForRouting } from "../ai/groq.service.js";
import { broadcastMetrics } from "../../websocket/socket-server.js";
import {
  insertNotification,
  notifyTicketAssigned as pushTicketAssignedNotifications,
  notifyTicketCommented,
  notifyTicketCreated as pushTicketCreatedNotifications,
  notifyTicketStatusChanged as pushTicketStatusNotifications,
} from "../notifications/notification.service.js";
import { executeTriggeredWorkflows } from "../workflows/visual-workflow.service.js";
import {
  notifyTicketWatchersAssignmentChanged,
  notifyTicketWatchersCommented,
  notifyTicketWatchersStatusChanged,
} from "./ticket-watchers.service.js";
import { broadcastBoardsForTicket } from "../boards/board-realtime.service.js";

export type TicketPriority = "LOW" | "MEDIUM" | "HIGH";
export type TicketType = "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM";
export type TicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "WAITING_FOR_CUSTOMER"
  | "RESOLVED"
  | "CLOSED";
export type TicketEventAction = "CREATED" | "STATUS_CHANGED" | "ASSIGNED" | "CLOSED";

function normalizeSubject(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/^\s*(re:|fw:|fwd:)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizePlainTextDescription(value: string): string {
  return decodeBasicHtmlEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/div>/gi, "\n")
      .replace(/<div[^>]*>/gi, "")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const DEDUPE_WINDOW_MS = 2 * 60 * 1000;

const findRecentTicketByRequesterAndSubject = async (args: {
  requesterId: string;
  normalizedSubject: string;
}): Promise<TicketRow | null> => {
  const res = await pool.query<TicketRow>(
    `SELECT *
     FROM tickets
     WHERE created_by = $1
       AND regexp_replace(LOWER(title), '^\s*(re:|fw:|fwd:)\s*', '', 'g') = $2
       AND status = ANY($3)
       AND created_at > now() - interval '2 minutes'
     ORDER BY created_at DESC
     LIMIT 1`,
    [args.requesterId, args.normalizedSubject, ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER"]]
  );
  return res.rows[0] ?? null;
};

const sendDuplicateTicketReply = async (args: {
  to: string;
  displayNumber: string | null;
  title: string;
  status: TicketStatus;
}): Promise<void> => {
  const dn = args.displayNumber || "";
  const statusLine =
    args.status === "WAITING_FOR_CUSTOMER"
      ? "We’re waiting for additional information from you to proceed."
      : args.status === "IN_PROGRESS"
        ? "Our team is already working on this."
        : "We’ve already received this and it is in our queue.";

  await sendMail({
    to: args.to,
    subject: dn ? `Re: [${dn}] ${args.title}` : `Re: ${args.title}`,
    text: `Thanks for reaching out.

We noticed you’ve submitted a similar request recently, and a ticket has already been created for it.

Ticket Number: ${dn || "(pending)"}
Current Status: ${args.status}

${statusLine}

If you have any additional details, please reply to this email and we’ll add it to the existing ticket.

Best regards,
IT Support Team`,
  });
};

export interface TicketRow {
  id: string;
  title: string;
  description: string;
  created_by: string;
  organization_id?: string | null;
  category: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_team: string | null;
  assigned_agent: string | null;
  ai_confidence: number | null;
  sla_first_response_due_at: string | null;
  sla_resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  type: TicketType;
  display_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketListRow extends TicketRow {
  requester_name: string;
  requester_email: string;
  requester_department?: string | null;
  requester_manager_name?: string | null;
  requester_location?: string | null;
  assigned_team_name: string | null;
  assigned_agent_name: string | null;
  assigned_agent_email: string | null;
  creator_name?: string | null;
  tag_names?: string[];
  source_type?: string | null;
  dedup_master_id?: string | null;
  sentiment_label?: string | null;
  root_cause_cluster_id?: string | null;
}

export interface TicketCommentRow {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string;
  author_email: string;
  body: string;
  is_internal: boolean;
  visibility: "INTERNAL_NOTE" | "REQUESTER_COMMENT";
  created_at: string;
}

type TicketNotificationTargets = {
  ticket_id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  requester_id: string;
  requester_email: string;
  requester_name: string;
  assigned_agent_id: string | null;
  assigned_agent_email: string | null;
  assigned_agent_name: string | null;
};

const allowedTransitions: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["WAITING_FOR_CUSTOMER", "RESOLVED"],
  WAITING_FOR_CUSTOMER: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export const assertTransitionAllowed = (from: TicketStatus, to: TicketStatus) => {
  const allowed = allowedTransitions[from] || [];
  if (!allowed.includes(to)) {
    const msg = `Illegal transition: ${from} -> ${to}`;
    const err = new Error(msg);
    (err as any).statusCode = 400;
    throw err;
  }
};

const getNotificationTargets = async (ticketId: string): Promise<TicketNotificationTargets | null> => {
  const res = await pool.query<TicketNotificationTargets>(
    `SELECT
      t.id AS ticket_id,
      t.title,
      t.status,
      t.priority,
      u.id AS requester_id,
      u.email AS requester_email,
      u.name AS requester_name,
      au.id AS assigned_agent_id,
      au.email AS assigned_agent_email,
      au.name AS assigned_agent_name
    FROM tickets t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN users au ON au.id = t.assigned_agent
    WHERE t.id = $1`,
    [ticketId]
  );
  return res.rows[0] ?? null;
};

 function sha256Hex(value: string): string {
   return createHash("sha256").update(value).digest("hex");
 }

 function getBucketedTimeKey(bucketMs: number): string {
  const ms = Date.now();
  return String(Math.floor(ms / bucketMs) * bucketMs);
 }

const getDuplicatesForMaster = async (masterTicketId: string) => {
  const res = await pool.query<{ id: string; created_by: string }>(
    `SELECT id, created_by
     FROM tickets
     WHERE (integration_metadata -> 'ai' ->> 'dedup_master_id')::text = $1`,
    [masterTicketId]
  );
  return res.rows;
};

const insertPublicAutoComment = async (args: { ticketId: string; authorId: string; body: string }) => {
  await pool.query(
    `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
     SELECT $1, $2, $3, false
     WHERE NOT EXISTS (
       SELECT 1
       FROM ticket_comments c
       WHERE c.ticket_id = $1
         AND c.is_internal = false
         AND c.body = $3
         AND c.created_at > now() - interval '2 minutes'
     )`,
    [args.ticketId, args.authorId, args.body]
  );
};

const getStatusAutoMessage = (from: TicketStatus, to: TicketStatus) => {
  if (from === to) return null;
  switch (to) {
    case "IN_PROGRESS":
      return "Status update: We’ve started working on your ticket. We’ll keep you posted.";
    case "WAITING_FOR_CUSTOMER":
      return "Status update: We need additional information from you to continue. Please reply with any relevant details/screenshots.";
    case "RESOLVED":
      return "Status update: We believe this issue is resolved. Please confirm if everything is working now.";
    case "CLOSED":
      return "Status update: This ticket has been closed. Reply to reopen if the issue happens again.";
    default:
      return null;
  }
};

const insertTicketProcessingEvent = async (args: {
  ticketId: string;
  action: string;
  performedBy: string;
  oldValue?: unknown;
  newValue?: unknown;
}) => {
  try {
    const mappedAction =
      args.action === "AI_CLASSIFIED"
        ? "COMPLEXITY_SCORED"
        : args.action === "AI_ROUTING_EVALUATED" ||
            args.action === "AI_ROUTING_APPLIED" ||
            args.action === "NOTIFICATION_SENT"
          ? "STATUS_CHANGED"
          : args.action;

    const withStage = (value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { stage: args.action, value };
      }
      return { stage: args.action, ...(value as Record<string, unknown>) };
    };

    await pool.query(
      `INSERT INTO ticket_events (ticket_id, action, old_value, new_value, performed_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [
        args.ticketId,
        mappedAction,
        args.oldValue == null ? null : JSON.stringify(withStage(args.oldValue)),
        args.newValue == null ? null : JSON.stringify(withStage(args.newValue)),
        args.performedBy,
      ]
    );
  } catch (err) {
    console.error(`Failed to insert ticket processing event ${args.action} for ticket ${args.ticketId}:`, err);
  }
};

export const sendMail = async (args: { to: string; subject: string; text: string }) => {
  const host = env.SMTP_HOST;
  const port = env.SMTP_PORT;
  const from = env.SMTP_FROM;
  if (!host || !port || !from) return;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth:
      env.SMTP_USERNAME && env.SMTP_PASSWORD
        ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
        : undefined,
  });

  await transporter.sendMail({
    from,
    to: args.to,
    subject: args.subject,
    text: args.text,
  });
};

const notifyTicketCreated = async (ticketId: string) => {
  try {
    const t = await getNotificationTargets(ticketId);
    if (!t) return;

    await pushTicketCreatedNotifications(ticketId);
    await insertTicketProcessingEvent({
      ticketId,
      action: "NOTIFICATION_SENT",
      performedBy: t.requester_id,
      newValue: {
        reason: "ticket_created",
        channels: ["in_app", "email"],
      },
    });

    try {
      const { processAlerts } = await import("../alerts/alert-rules.service.js");
      await processAlerts({
        ticketId: t.ticket_id,
        title: t.title,
        description: "", // Will be fetched if needed
        category: null,
        priority: t.priority,
        status: t.status,
        assignedTeam: null,
        assignedAgent: null,
        requesterEmail: t.requester_email,
        requesterName: t.requester_name,
        eventType: "TICKET_CREATED",
      });
    } catch {
      await sendMail({
        to: t.requester_email,
        subject: `[TICKET-${t.ticket_id}] Ticket created: ${t.title}`,
        text: `Your ticket has been created.\n\nID: ${t.ticket_id}\nStatus: ${t.status}\nPriority: ${t.priority}\n`,
      });
    }
  } catch {
    return;
  }
};

const notifyTicketAssigned = async (ticketId: string, actorUserId?: string | null) => {
  try {
    const t = await getNotificationTargets(ticketId);
    if (!t) return;

    await pushTicketAssignedNotifications(ticketId, actorUserId);

    try {
      const { processAlerts } = await import("../alerts/alert-rules.service.js");
      await processAlerts({
        ticketId: t.ticket_id,
        title: t.title,
        description: "",
        category: null,
        priority: t.priority,
        status: t.status,
        assignedTeam: null,
        assignedAgent: t.assigned_agent_id || null,
        requesterEmail: t.requester_email,
        requesterName: t.requester_name,
        eventType: "TICKET_ASSIGNED",
      });
    } catch {
      if (t.assigned_agent_email && t.assigned_agent_id) {
        await sendMail({
          to: t.assigned_agent_email,
          subject: `[TICKET-${t.ticket_id}] Ticket assigned: ${t.title}`,
          text: `A ticket has been assigned to you.\n\nID: ${t.ticket_id}\nStatus: ${t.status}\nPriority: ${t.priority}\nRequester: ${t.requester_name} <${t.requester_email}>\n`,
        });
      }
    }
  } catch {
    return;
  }
};

const notifyTicketStatusChanged = async (ticketId: string, actorUserId?: string | null) => {
  try {
    const t = await getNotificationTargets(ticketId);
    if (!t) return;

    await pushTicketStatusNotifications(ticketId, actorUserId);

    try {
      const { processAlerts } = await import("../alerts/alert-rules.service.js");
      const eventType = t.status === "RESOLVED" ? "TICKET_RESOLVED" : t.status === "CLOSED" ? "TICKET_CLOSED" : "TICKET_STATUS_CHANGED";

      await processAlerts({
        ticketId: t.ticket_id,
        title: t.title,
        description: "",
        category: null,
        priority: t.priority,
        status: t.status,
        assignedTeam: null,
        assignedAgent: t.assigned_agent_id || null,
        requesterEmail: t.requester_email,
        requesterName: t.requester_name,
        eventType,
      });
    } catch {
      // Fallback
      await insertNotification({
        userId: t.requester_id,
        ticketId: t.ticket_id,
        type: "TICKET_STATUS_CHANGED",
        title: "Ticket status updated",
        body: `${t.title} → ${t.status}`,
      });

      if (t.assigned_agent_id) {
        await insertNotification({
          userId: t.assigned_agent_id,
          ticketId: t.ticket_id,
          type: "TICKET_STATUS_CHANGED",
          title: "Ticket status updated",
          body: `${t.title} → ${t.status}`,
        });
      }

      await sendMail({
        to: t.requester_email,
        subject: `[TICKET-${t.ticket_id}] Ticket update: ${t.title} (${t.status})`,
        text: `Your ticket status has been updated.\n\nID: ${t.ticket_id}\nStatus: ${t.status}\nPriority: ${t.priority}\n`,
      });
    }
    
    // Broadcast metrics update
    broadcastMetrics("dashboard", { type: "ticket_updated", ticketId: t.ticket_id, status: t.status });
  } catch {
    return;
  }
};

const triggerVisualWorkflow = async (args: {
  triggerType: "ticket_created" | "ticket_updated";
  ticketId: string;
  category?: string | null;
  performedBy?: string;
  triggerData?: Record<string, any>;
}) => {
  try {
    await executeTriggeredWorkflows({
      triggerType: args.triggerType,
      ticketId: args.ticketId,
      category: args.category,
      userId: args.performedBy,
      triggerData: args.triggerData,
    });
  } catch (error) {
    console.error(`Visual workflow trigger ${args.triggerType} failed for ticket ${args.ticketId}:`, error);
  }
};

const computeSlaDueDates = (priority: TicketPriority, createdAt: Date) => {
  const firstResponseMs =
    priority === "HIGH"
      ? 4 * 60 * 60 * 1000
      : priority === "MEDIUM"
        ? 8 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  const resolutionMs =
    priority === "HIGH"
      ? 24 * 60 * 60 * 1000
      : priority === "MEDIUM"
        ? 72 * 60 * 60 * 1000
        : 5 * 24 * 60 * 60 * 1000;

  return {
    firstResponseDueAt: new Date(createdAt.getTime() + firstResponseMs),
    resolutionDueAt: new Date(createdAt.getTime() + resolutionMs),
  };
};

export const createTicket = async (args: {
  title: string;
  description: string;
  createdBy: string;
  performedBy: string;
  type?: TicketType;
  priority?: TicketPriority;
  category?: string | null;
  sourceType?: "WEB" | "MOBILE" | "EMAIL" | "GLPI" | "SOLMAN" | "CHATBOT" | "SLACK" | "TEAMS";
  sourceReference?: Record<string, any>;
  integrationMetadata?: Record<string, any>;
}): Promise<TicketRow> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const organizationId = await getOrganizationIdForUser(args.createdBy);
    const tierInfo = await resolveAiTier({ userId: args.createdBy });
    const normalizedDescription = normalizePlainTextDescription(args.description);

    const sourceType = args.sourceType || "WEB";
    const sourceRef = args.sourceReference ? JSON.stringify(args.sourceReference) : null;
    const integrationMeta = args.integrationMetadata ? JSON.stringify(args.integrationMetadata) : null;
    const ticketType = args.type || "INCIDENT";
    const initialPriority: TicketPriority = args.priority || "LOW";
    const initialCategory: string | null = typeof args.category === "string" ? args.category : null;

    // Hard dedupe: same requester + normalized subject within 2 minutes, while ticket is active.
    // This prevents same-second double submits and rapid repeated emails.
    const normalizedSubject = normalizeSubject(args.title);
    const existing = await findRecentTicketByRequesterAndSubject({
      requesterId: args.createdBy,
      normalizedSubject,
    });
    if (existing) {
      await client.query("ROLLBACK");
      const nt = await getNotificationTargets(existing.id);
      if (nt) {
        await insertNotification({
          userId: nt.requester_id,
          ticketId: existing.id,
          type: "TICKET_CREATED",
          title: "Ticket already exists",
          body: `${existing.display_number || existing.id}: ${existing.title}`,
          dedupeKey: sha256Hex(["ticket-duplicate", nt.requester_id, normalizedSubject, String(Math.floor(Date.now() / DEDUPE_WINDOW_MS))].join("|")),
        });
        await sendDuplicateTicketReply({
          to: nt.requester_email,
          displayNumber: existing.display_number,
          title: existing.title,
          status: existing.status,
        });
      }
      return existing;
    }

    const inserted = await client.query<TicketRow>(
      `INSERT INTO tickets (title, description, created_by, type, display_number, source_type, source_reference, integration_metadata, priority, category, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        args.title,
        normalizedDescription,
        args.createdBy,
        ticketType,
        null,
        sourceType,
        sourceRef,
        integrationMeta,
        initialPriority,
        initialCategory,
        organizationId,
      ]
    );

    const baseTicket = inserted.rows[0]!;

    const { firstResponseDueAt, resolutionDueAt } = computeSlaDueDates(
      baseTicket.priority,
      new Date(baseTicket.created_at)
    );

    const slaUpdatedRes = await client.query<TicketRow>(
      `UPDATE tickets
       SET sla_first_response_due_at = $2,
           sla_resolution_due_at = $3
       WHERE id = $1
       RETURNING *`,
      [baseTicket.id, firstResponseDueAt.toISOString(), resolutionDueAt.toISOString()]
    );

    const ticket = slaUpdatedRes.rows[0] ?? baseTicket;

    // Generate display number
    const displayNumberRes = await client.query<{ display_number: string }>(`SELECT generate_display_number($1) as display_number`, [ticketType]);
    const displayNumber = displayNumberRes.rows[0].display_number;

    const finalUpdate = await client.query<TicketRow>(`UPDATE tickets SET display_number = $2 WHERE id = $1 RETURNING *`, [ticket.id, displayNumber]);
    const ticketWithNumber = finalUpdate.rows[0] ?? ticket;

    await client.query(
      `INSERT INTO ticket_events (ticket_id, action, old_value, new_value, performed_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [
        ticket.id,
        "CREATED",
        null,
        JSON.stringify({ title: ticket.title, status: ticket.status }),
        args.performedBy,
      ]
    );

    await client.query("COMMIT");

    // Broadcast metrics update
    broadcastMetrics("dashboard", { type: "ticket_created", ticket: ticketWithNumber });
    void broadcastBoardsForTicket(ticketWithNumber.id, "ticket-created").catch(() => undefined);

    void notifyTicketCreated(ticket.id);

    // Step 1: AI Classification (must happen before routing)
    let classifiedTicket = ticketWithNumber;
    let aiIntent: string | undefined;
    let aiKeywords: string[] | undefined;
    let classificationProvider: "groq" | "classifier" | null = null;
    let classificationModel: string | null = null;
    try {
      const text = `${args.title} ${normalizedDescription}`;
      let usedGroqEnrichment = false;

      if (env.GROQ_API_KEY) {
        const groqEnrichment = await enrichTicketForRouting(text);
        if (groqEnrichment) {
          const category = groqEnrichment.category || null;
          const confidence =
            typeof groqEnrichment.confidence === "number" ? groqEnrichment.confidence : null;

          aiIntent = typeof groqEnrichment.intent === "string" ? groqEnrichment.intent : undefined;
          aiKeywords = Array.isArray(groqEnrichment.keywords) ? groqEnrichment.keywords : undefined;

          const suggestedPriority: TicketPriority | null =
            groqEnrichment.priority === "LOW" ||
            groqEnrichment.priority === "MEDIUM" ||
            groqEnrichment.priority === "HIGH"
              ? groqEnrichment.priority
              : null;

          const sentimentLabel = groqEnrichment.sentiment_label || undefined;
          const sentimentScore = groqEnrichment.sentiment_score ?? undefined;

          let nextPriority = suggestedPriority ?? classifiedTicket.priority;
          if (sentimentLabel === "NEGATIVE" && nextPriority !== "HIGH") {
            nextPriority = "HIGH";
          }

          const { firstResponseDueAt, resolutionDueAt } = computeSlaDueDates(
            nextPriority,
            new Date(classifiedTicket.created_at)
          );

          const aiMeta = {
            summary: groqEnrichment.summary || undefined,
            intent: aiIntent,
            keywords: aiKeywords,
            entities: groqEnrichment.entities || undefined,
            priority_suggestion: suggestedPriority,
            auto_resolvable: undefined,
            suggested_workflow: undefined,
            approval_title: undefined,
            approval_body: undefined,
            model_confidence: confidence,
            provider: "groq",
            model: env.GROQ_EXTRACTION_MODEL || "llama-3.3-70b-versatile",
            sentiment: {
              score: sentimentScore,
              label: sentimentLabel,
            },
          };

          const updatedRes = await pool.query<TicketRow>(
            `UPDATE tickets
             SET category = COALESCE($2, category),
                 ai_confidence = COALESCE($3, ai_confidence),
                 priority = $4,
                 sla_first_response_due_at = $5,
                 sla_resolution_due_at = $6,
                 integration_metadata = jsonb_set(COALESCE(integration_metadata, '{}'::jsonb), '{ai}', $7::jsonb, true)
             WHERE id = $1
             RETURNING *`,
            [
              ticket.id,
              category,
              confidence,
              nextPriority,
              firstResponseDueAt.toISOString(),
              resolutionDueAt.toISOString(),
              JSON.stringify(aiMeta),
            ]
          );

          if (updatedRes.rows.length > 0) {
            classifiedTicket = updatedRes.rows[0];
            usedGroqEnrichment = true;
            classificationProvider = "groq";
            classificationModel = env.GROQ_EXTRACTION_MODEL || "llama-3.3-70b-versatile";
            await insertTicketProcessingEvent({
              ticketId: classifiedTicket.id,
              action: "AI_CLASSIFIED",
              performedBy: args.performedBy,
              newValue: {
                provider: classificationProvider,
                model: classificationModel,
                category: classifiedTicket.category,
                confidence,
                priority: classifiedTicket.priority,
                intent: aiIntent,
                keywords: aiKeywords,
              },
            });
          }
        }
      }

      if (!usedGroqEnrichment && env.AI_CLASSIFIER_URL) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const base = env.AI_CLASSIFIER_URL.replace(/\/$/, "");
        const enrichUrl = base.endsWith("/predict")
          ? `${base.slice(0, -"/predict".length)}/enrich`
          : `${base}/enrich`;

        const res = await fetch(enrichUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-ai-tier": tierInfo.tier },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (res.ok) {
          const data: any = await res.json().catch(() => null);
          const category = typeof data?.category === "string" ? data.category : null;
          const confidence = typeof data?.confidence === "number" ? data.confidence : null;

          aiIntent = typeof data?.intent === "string" ? data.intent : undefined;
          aiKeywords = Array.isArray(data?.keywords)
            ? data.keywords.filter((k: any) => typeof k === "string")
            : undefined;

          const suggestedPriority: TicketPriority | null =
            data?.priority === "LOW" || data?.priority === "MEDIUM" || data?.priority === "HIGH"
              ? data.priority
              : null;

          // Sentiment-driven priority bump (Phase 5): negative sentiment can increase priority
          const sentimentLabel =
            typeof data?.sentiment_label === "string" ? data.sentiment_label : undefined;
          const sentimentScore =
            typeof data?.sentiment_score === "number" ? data.sentiment_score : undefined;

          let nextPriority = suggestedPriority ?? classifiedTicket.priority;
          if (sentimentLabel === "NEGATIVE" && nextPriority !== "HIGH") {
            nextPriority = "HIGH";
          }
          const { firstResponseDueAt, resolutionDueAt } = computeSlaDueDates(
            nextPriority,
            new Date(classifiedTicket.created_at)
          );

          const aiMeta = {
            summary: typeof data?.summary === "string" ? data.summary : undefined,
            intent: aiIntent,
            keywords: aiKeywords,
            entities: typeof data?.entities === "object" && data?.entities ? data.entities : undefined,
            priority_suggestion: suggestedPriority,
            auto_resolvable: typeof data?.auto_resolvable === "boolean" ? data.auto_resolvable : undefined,
            suggested_workflow:
              typeof data?.suggested_workflow === "string" ? data.suggested_workflow : undefined,
            approval_title: typeof data?.approval_title === "string" ? data.approval_title : undefined,
            approval_body: typeof data?.approval_body === "string" ? data.approval_body : undefined,
            model_confidence: confidence,
            sentiment: {
              score: sentimentScore,
              label: sentimentLabel,
            },
          };

          const updatedRes = await pool.query<TicketRow>(
            `UPDATE tickets
             SET category = COALESCE($2, category),
                 ai_confidence = COALESCE($3, ai_confidence),
                 priority = $4,
                 sla_first_response_due_at = $5,
                 sla_resolution_due_at = $6,
                 integration_metadata = jsonb_set(COALESCE(integration_metadata, '{}'::jsonb), '{ai}', $7::jsonb, true)
             WHERE id = $1
             RETURNING *`,
            [
              ticket.id,
              category,
              confidence,
              nextPriority,
              firstResponseDueAt.toISOString(),
              resolutionDueAt.toISOString(),
              JSON.stringify(aiMeta),
            ]
          );
          if (updatedRes.rows.length > 0) {
            classifiedTicket = updatedRes.rows[0];
            classificationProvider = "classifier";
            classificationModel = "ai_classifier_enrich";
            await insertTicketProcessingEvent({
              ticketId: classifiedTicket.id,
              action: "AI_CLASSIFIED",
              performedBy: args.performedBy,
              newValue: {
                provider: classificationProvider,
                model: classificationModel,
                category: classifiedTicket.category,
                confidence,
                priority: classifiedTicket.priority,
                intent: aiIntent,
                keywords: aiKeywords,
              },
            });
          }
        }
      }
    } catch (aiErr) {
      // Log but don't fail ticket creation
      console.error("AI classification error:", aiErr);
    }

    // Step 1.3: Phase 4 - Sentiment Analysis & Agentic AI
    try {
      // Analyze sentiment and route accordingly
      const sentiment = await analyzeSentiment(`${args.title} ${normalizedDescription}`, tierInfo.tier);
      await routeTicketBySentiment(ticket.id, sentiment);

      // Check for auto-actionable requests (password reset, account unlock)
      const userRes = await pool.query(`SELECT id, email FROM users WHERE id = $1`, [args.createdBy]);
      if (userRes.rows.length > 0) {
        const actionResult = await analyzeAndExecuteAction({
          ticketId: ticket.id,
          requesterId: args.createdBy,
          requesterEmail: userRes.rows[0].email,
          title: args.title,
          description: normalizedDescription,
          category: classifiedTicket.category || "OTHER",
        });

        if (actionResult?.success) {
          console.log(`AI Action executed for ticket ${ticket.id}:`, actionResult.actionType);
        }
      }
    } catch (agenticErr) {
      // Log but don't fail ticket creation
      console.error("Agentic AI error:", agenticErr);
    }

    // Step 1.25: Smart deduplication - link very similar tickets together
    try {
      const similar = await findSimilarOpenTicket({
        category: classifiedTicket.category,
        text: `${classifiedTicket.title} ${classifiedTicket.description}`,
      });

      if (similar && similar.id !== classifiedTicket.id) {
        // Mark this ticket as a duplicate of the master ticket
        await pool.query(
          `UPDATE tickets
           SET integration_metadata = jsonb_set(
             COALESCE(integration_metadata, '{}'::jsonb),
             '{ai,dedup_master_id}',
             to_jsonb($2::text),
             true
           )
           WHERE id = $1`,
          [classifiedTicket.id, similar.id]
        );

        // Add comments on both tickets so humans understand the linkage
        await pool.query(
          `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
           VALUES ($1, $2, $3, true)`,
          [
            classifiedTicket.id,
            args.performedBy,
            `Linked as duplicate of ticket ${similar.id}. Updates will follow the master ticket.`,
          ]
        );
        await pool.query(
          `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
           VALUES ($1, $2, $3, true)`,
          [
            similar.id,
            args.performedBy,
            `Another employee reported a similar issue (ticket ${classifiedTicket.id}). Treating this as the same incident.`,
          ]
        );

        // Reload ticket row to include updated metadata
        const dedupRes = await pool.query<TicketRow>(
          "SELECT * FROM tickets WHERE id = $1",
          [classifiedTicket.id]
        );
        if (dedupRes.rows[0]) {
          classifiedTicket = dedupRes.rows[0];
        }
      }
    } catch (dedupeErr) {
      console.error("Ticket deduplication error:", dedupeErr);
    }

    // Step 1.4: AutoFix Catalog (DB-backed, Level 2)
    try {
      const { findBestAutofixPlaybook, ensureWorkflowForAutofix, isGuidedEligibleRule2 } = await import(
        "../workflows/autofix-catalog.service.js"
      );
      const { executeWorkflow } = await import("../workflows/auto-resolution.service.js");

      const aiMeta: any = (classifiedTicket as any).integration_metadata?.ai;
      const confidence: number | null = typeof (classifiedTicket as any).ai_confidence === "number" ? (classifiedTicket as any).ai_confidence : (typeof aiMeta?.model_confidence === "number" ? aiMeta.model_confidence : null);

      const textToMatch = `${classifiedTicket.title} ${classifiedTicket.description}`.trim();
      const playbook = await findBestAutofixPlaybook({
        intent: aiIntent,
        category: classifiedTicket.category,
        keywords: aiKeywords,
        confidence,
        priority: classifiedTicket.priority,
        text: textToMatch,
      });

      if (playbook) {
        const guidedEligible = isGuidedEligibleRule2({
          ticketPriority: classifiedTicket.priority,
          playbookRisk: playbook.risk,
        });

        if (playbook.mode !== "GUIDED" || guidedEligible) {
          // Stamp ticket metadata with autofix selection
          await pool.query(
            `UPDATE tickets
             SET integration_metadata = jsonb_set(
               COALESCE(integration_metadata, '{}'::jsonb),
               '{autofix}',
               $2::jsonb,
               true
             )
             WHERE id = $1`,
            [
              classifiedTicket.id,
              JSON.stringify({
                code: playbook.code,
                mode: playbook.mode,
                risk: playbook.risk,
                min_confidence: playbook.min_confidence,
              }),
            ]
          );

          // Ensure workflow exists and execute it
          const workflow = await ensureWorkflowForAutofix({
            code: playbook.code,
            title: playbook.user_title,
            steps: playbook.workflow_steps,
            autoResolve: playbook.mode === "AUTOMATION",
          });

          const execution = await executeWorkflow(
            workflow,
            {
              ticketId: classifiedTicket.id,
              title: classifiedTicket.title,
              description: classifiedTicket.description,
              intent: aiIntent,
              keywords: aiKeywords,
              category: classifiedTicket.category,
              priority: classifiedTicket.priority,
            },
            classifiedTicket.id
          );

          const afterWorkflow = await pool.query<TicketRow>(
            "SELECT * FROM tickets WHERE id = $1",
            [classifiedTicket.id]
          );
          if (afterWorkflow.rows[0]) {
            classifiedTicket = afterWorkflow.rows[0];
            if (classifiedTicket.status === "RESOLVED" || classifiedTicket.status === "CLOSED") {
              void triggerVisualWorkflow({
                triggerType: "ticket_created",
                ticketId: classifiedTicket.id,
                category: classifiedTicket.category,
                performedBy: args.performedBy,
                triggerData: {
                  event: "ticket_created",
                  title: classifiedTicket.title,
                  priority: classifiedTicket.priority,
                  status: classifiedTicket.status,
                },
              });
              return classifiedTicket;
            }
          }

          if (execution.status === "pending") {
            void triggerVisualWorkflow({
              triggerType: "ticket_created",
              ticketId: classifiedTicket.id,
              category: classifiedTicket.category,
              performedBy: args.performedBy,
              triggerData: {
                event: "ticket_created",
                title: classifiedTicket.title,
                priority: classifiedTicket.priority,
                status: classifiedTicket.status,
              },
            });
            return classifiedTicket;
          }
        }
      }
    } catch (autofixErr) {
      console.error("[DEBUG] AutoFix catalog error:", autofixErr);
    }

    // Step 1.5: Auto-resolution workflows (optional). If it resolves the ticket, skip routing.
    try {
      console.log("[DEBUG] Starting workflow check for ticket:", classifiedTicket.id);
      console.log("[DEBUG] Category:", classifiedTicket.category);
      console.log("[DEBUG] Title:", classifiedTicket.title);
      console.log("[DEBUG] Description:", classifiedTicket.description);
      
      const { executeWorkflow } = await import(
        "../workflows/auto-resolution.service.js"
      );
      const { getWorkflowForCategory, workflowToObject } = await import(
        "../workflows/workflow-definitions.service.js"
      );

      // Try to get a workflow from the hardcoded definitions first
      const textToMatch = `${classifiedTicket.title} ${classifiedTicket.description}`.trim();
      console.log("[DEBUG] textToMatch:", textToMatch);
      
      const workflowSteps = getWorkflowForCategory(classifiedTicket.category || "", textToMatch);
      console.log("[DEBUG] workflowSteps:", workflowSteps ? "FOUND" : "NOT FOUND");
      
      if (workflowSteps) {
        console.log("[DEBUG] Executing workflow...");
        const workflow = await workflowToObject(workflowSteps, classifiedTicket.category || "general");
        
        const execution = await executeWorkflow(
          workflow,
          {
            ticketId: classifiedTicket.id,
            title: classifiedTicket.title,
            description: classifiedTicket.description,
            intent: aiIntent,
            keywords: aiKeywords,
            category: classifiedTicket.category,
            priority: classifiedTicket.priority,
          },
          classifiedTicket.id
        );
        
        console.log("[DEBUG] Workflow execution status:", execution.status);

        const afterWorkflow = await pool.query<TicketRow>(
          "SELECT * FROM tickets WHERE id = $1",
          [classifiedTicket.id]
        );
        if (afterWorkflow.rows[0]) {
          classifiedTicket = afterWorkflow.rows[0];
          if (classifiedTicket.status === "RESOLVED" || classifiedTicket.status === "CLOSED") {
            void triggerVisualWorkflow({
              triggerType: "ticket_created",
              ticketId: classifiedTicket.id,
              category: classifiedTicket.category,
              performedBy: args.performedBy,
              triggerData: {
                event: "ticket_created",
                title: classifiedTicket.title,
                priority: classifiedTicket.priority,
                status: classifiedTicket.status,
              },
            });
            return classifiedTicket;
          }
        }

        if (execution.status === "pending") {
          void triggerVisualWorkflow({
            triggerType: "ticket_created",
            ticketId: classifiedTicket.id,
            category: classifiedTicket.category,
            performedBy: args.performedBy,
            triggerData: {
              event: "ticket_created",
              title: classifiedTicket.title,
              priority: classifiedTicket.priority,
              status: classifiedTicket.status,
            },
          });
          return classifiedTicket;
        }
      } else {
        console.log("[DEBUG] No workflow matched for this ticket");
      }
    } catch (workflowErr) {
      console.error("[DEBUG] Workflow auto-resolution error:", workflowErr);
    }

    // Step 2: Apply intelligent routing after AI classification
    try {
      const { routeTicket, applyRouting } = await import("../routing/intelligent-routing.service.js");
      const routingResult = await routeTicket({
        ticketId: classifiedTicket.id,
        category: classifiedTicket.category,
        priority: classifiedTicket.priority,
        title: classifiedTicket.title,
        description: classifiedTicket.description,
        performedBy: args.performedBy,
      });

      await insertTicketProcessingEvent({
        ticketId: classifiedTicket.id,
        action: "AI_ROUTING_EVALUATED",
        performedBy: args.performedBy,
        newValue: {
          confidence: routingResult.confidence,
          method: routingResult.method,
          priority: routingResult.priority,
          recommended_team_id: routingResult.teamId,
          recommended_agent_id: routingResult.agentId,
          applied_rules: routingResult.appliedRules,
          classification_provider: classificationProvider,
          classification_model: classificationModel,
        },
      });

      if (routingResult.priority !== classifiedTicket.priority) {
        const { firstResponseDueAt, resolutionDueAt } = computeSlaDueDates(
          routingResult.priority,
          new Date(classifiedTicket.created_at)
        );
        const priUpdated = await pool.query<TicketRow>(
          `UPDATE tickets
           SET priority = $2,
               sla_first_response_due_at = $3,
               sla_resolution_due_at = $4
           WHERE id = $1
           RETURNING *`,
          [
            classifiedTicket.id,
            routingResult.priority,
            firstResponseDueAt.toISOString(),
            resolutionDueAt.toISOString(),
          ]
        );
        if (priUpdated.rows[0]) {
          classifiedTicket = priUpdated.rows[0];
        }
      }

      // Apply routing if confidence is sufficient
      if (routingResult.confidence >= 0.6) {
        await applyRouting(classifiedTicket.id, routingResult, args.performedBy);
        
        // Reload ticket to get updated assignment
        const updatedRes = await pool.query<TicketRow>("SELECT * FROM tickets WHERE id = $1", [classifiedTicket.id]);
        if (updatedRes.rows.length > 0) {
          const finalTicket = updatedRes.rows[0];
          void triggerVisualWorkflow({
            triggerType: "ticket_created",
            ticketId: finalTicket.id,
            category: finalTicket.category,
            performedBy: args.performedBy,
            triggerData: {
              event: "ticket_created",
              title: finalTicket.title,
              priority: finalTicket.priority,
              status: finalTicket.status,
            },
          });
          return finalTicket;
        }
      }
    } catch (routingErr) {
      // Log but don't fail ticket creation
      console.error("Routing error:", routingErr);
    }

    void triggerVisualWorkflow({
      triggerType: "ticket_created",
      ticketId: classifiedTicket.id,
      category: classifiedTicket.category,
      performedBy: args.performedBy,
      triggerData: {
        event: "ticket_created",
        title: classifiedTicket.title,
        priority: classifiedTicket.priority,
        status: classifiedTicket.status,
      },
    });

    return classifiedTicket;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

export const getTicketById = async (id: string): Promise<TicketRow | null> => {
  const res = await pool.query<TicketRow>("SELECT * FROM tickets WHERE id = $1", [id]);
  return res.rows[0] ?? null;
};

export const getTicketDetailById = async (id: string): Promise<TicketListRow | null> => {
  const res = await pool.query<TicketListRow>(
    `SELECT
      t.*,
      (t.integration_metadata -> 'ai' ->> 'dedup_master_id')::text AS dedup_master_id,
      (t.integration_metadata -> 'ai' -> 'sentiment' ->> 'label')::text AS sentiment_label,
      (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_id')::text AS root_cause_cluster_id,
      u.name AS requester_name,
      u.email AS requester_email,
      u.department AS requester_department,
      requester_manager.name AS requester_manager_name,
      u.location AS requester_location,
      tm.name AS assigned_team_name,
      au.name AS assigned_agent_name,
      au.email AS assigned_agent_email,
      u.name AS creator_name,
      COALESCE(tags.tag_names, ARRAY[]::text[]) AS tag_names
    FROM tickets t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN users requester_manager ON requester_manager.id = u.manager_id
    LEFT JOIN teams tm ON tm.id = t.assigned_team
    LEFT JOIN users au ON au.id = t.assigned_agent
    LEFT JOIN LATERAL (
      SELECT array_remove(array_agg(tt.name ORDER BY tt.name), NULL) AS tag_names
      FROM ticket_tag_links ttl
      JOIN ticket_tags tt ON tt.id = ttl.tag_id
      WHERE ttl.ticket_id = t.id
    ) tags ON true
    WHERE t.id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
};

export const getTicketsForEmployee = async (userId: string): Promise<TicketListRow[]> => {
  const res = await pool.query<TicketListRow>(
    `SELECT
      t.*,
      (t.integration_metadata -> 'ai' ->> 'dedup_master_id')::text AS dedup_master_id,
      (t.integration_metadata -> 'ai' -> 'sentiment' ->> 'label')::text AS sentiment_label,
      (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_id')::text AS root_cause_cluster_id,
      u.name AS requester_name,
      u.email AS requester_email,
      tm.name AS assigned_team_name,
      au.name AS assigned_agent_name,
      au.email AS assigned_agent_email
    FROM tickets t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN teams tm ON tm.id = t.assigned_team
    LEFT JOIN users au ON au.id = t.assigned_agent
    WHERE t.created_by = $1
    ORDER BY t.updated_at DESC`,
    [userId]
  );
  return res.rows;
};

export const getTicketsForEmployeePaginated = async (args: {
  userId: string;
  q?: string;
  type?: TicketType[];
  status?: TicketStatus[];
  priority?: TicketPriority[];
  category?: string[];
  sort?: 'updated_at' | 'created_at' | 'priority' | 'status';
  order?: 'asc' | 'desc';
  limit: number;
  offset: number;
}): Promise<{ items: TicketListRow[]; total: number }> => {
  const conditions = [`t.created_by = $1`];
  const params: any[] = [args.userId];
  let paramIndex = 2;

  if (args.q) {
    conditions.push(`(t.display_number ILIKE $${paramIndex} OR t.id ILIKE $${paramIndex} OR t.title ILIKE $${paramIndex})`);
    params.push(`%${args.q}%`);
    paramIndex++;
  }

  if (args.type && args.type.length > 0) {
    conditions.push(`t.type = ANY($${paramIndex})`);
    params.push(args.type);
    paramIndex++;
  }

  if (args.status && args.status.length > 0) {
    conditions.push(`t.status = ANY($${paramIndex})`);
    params.push(args.status);
    paramIndex++;
  }

  if (args.priority && args.priority.length > 0) {
    conditions.push(`t.priority = ANY($${paramIndex})`);
    params.push(args.priority);
    paramIndex++;
  }

  if (args.category && args.category.length > 0) {
    conditions.push(`t.category = ANY($${paramIndex})`);
    params.push(args.category);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const sortField = args.sort || 'updated_at';
  const sortOrder = args.order || 'desc';
  const limit = Math.min(args.limit || 50, 200);
  const offset = args.offset || 0;

  const query = `
    SELECT
      t.*,
      t.source_type,
      (t.integration_metadata -> 'ai' ->> 'dedup_master_id')::text AS dedup_master_id,
      (t.integration_metadata -> 'ai' -> 'sentiment' ->> 'label')::text AS sentiment_label,
      (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_id')::text AS root_cause_cluster_id,
      u.name AS requester_name,
      u.email AS requester_email,
      tm.name AS assigned_team_name,
      au.name AS assigned_agent_name,
      au.email AS assigned_agent_email
    FROM tickets t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN teams tm ON tm.id = t.assigned_team
    LEFT JOIN users au ON au.id = t.assigned_agent
    ${whereClause}
    ORDER BY t.${sortField} ${sortOrder}, t.created_at DESC, t.id DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  params.push(limit, offset);

  const countQuery = `
    SELECT COUNT(*) as total
    FROM tickets t
    ${whereClause}
  `;

  const [itemsRes, countRes] = await Promise.all([
    pool.query<TicketListRow>(query, params),
    pool.query<{ total: string }>(countQuery, params.slice(0, -2))
  ]);

  return {
    items: itemsRes.rows,
    total: parseInt(countRes.rows[0].total, 10)
  };
};

export const getAllTickets = async (): Promise<TicketListRow[]> => {
  const res = await pool.query<TicketListRow>(
    `SELECT
      t.*,
      (t.integration_metadata -> 'ai' ->> 'dedup_master_id')::text AS dedup_master_id,
      (t.integration_metadata -> 'ai' -> 'sentiment' ->> 'label')::text AS sentiment_label,
      (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_id')::text AS root_cause_cluster_id,
      u.name AS requester_name,
      u.email AS requester_email,
      tm.name AS assigned_team_name,
      au.name AS assigned_agent_name,
      au.email AS assigned_agent_email
    FROM tickets t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN teams tm ON tm.id = t.assigned_team
    LEFT JOIN users au ON au.id = t.assigned_agent
    ORDER BY t.updated_at DESC`
  );
  return res.rows;
};

export const getTicketsPaginated = async (args: {
  organizationId?: string | null;
  q?: string;
  type?: TicketType[];
  status?: TicketStatus[];
  priority?: TicketPriority[];
  category?: string[];
  assigned_agent?: string[];
  assigned_team?: string[];
  created_from?: string;
  created_to?: string;
  sort?: 'updated_at' | 'created_at' | 'priority' | 'status';
  order?: 'asc' | 'desc';
  limit: number;
  offset: number;
}): Promise<{ items: TicketListRow[]; total: number }> => {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (args.organizationId) {
    conditions.push(`t.organization_id = $${paramIndex}`);
    params.push(args.organizationId);
    paramIndex++;
  }

  if (args.q) {
    conditions.push(`(t.id ILIKE $${paramIndex} OR t.title ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`);
    params.push(`%${args.q}%`);
    paramIndex++;
  }

  if (args.type && args.type.length > 0) {
    conditions.push(`t.type = ANY($${paramIndex})`);
    params.push(args.type);
    paramIndex++;
  }

  if (args.status && args.status.length > 0) {
    conditions.push(`t.status = ANY($${paramIndex})`);
    params.push(args.status);
    paramIndex++;
  }

  if (args.priority && args.priority.length > 0) {
    conditions.push(`t.priority = ANY($${paramIndex})`);
    params.push(args.priority);
    paramIndex++;
  }

  if (args.category && args.category.length > 0) {
    conditions.push(`t.category = ANY($${paramIndex})`);
    params.push(args.category);
    paramIndex++;
  }

  if (args.assigned_agent && args.assigned_agent.length > 0) {
    conditions.push(`t.assigned_agent = ANY($${paramIndex})`);
    params.push(args.assigned_agent);
    paramIndex++;
  }

  if (args.assigned_team && args.assigned_team.length > 0) {
    conditions.push(`t.assigned_team = ANY($${paramIndex})`);
    params.push(args.assigned_team);
    paramIndex++;
  }

  if (args.created_from) {
    conditions.push(`t.created_at >= $${paramIndex}`);
    params.push(args.created_from);
    paramIndex++;
  }

  if (args.created_to) {
    conditions.push(`t.created_at <= $${paramIndex}`);
    params.push(args.created_to);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortField = args.sort || 'updated_at';
  const sortOrder = args.order || 'desc';
  const limit = Math.min(args.limit || 50, 200);
  const offset = args.offset || 0;

  const query = `
    SELECT
      t.*,
      t.source_type,
      (t.integration_metadata -> 'ai' ->> 'dedup_master_id')::text AS dedup_master_id,
      (t.integration_metadata -> 'ai' -> 'sentiment' ->> 'label')::text AS sentiment_label,
      (t.integration_metadata -> 'ai' ->> 'root_cause_cluster_id')::text AS root_cause_cluster_id,
      u.name AS requester_name,
      u.email AS requester_email,
      tm.name AS assigned_team_name,
      au.name AS assigned_agent_name,
      au.email AS assigned_agent_email
    FROM tickets t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN teams tm ON tm.id = t.assigned_team
    LEFT JOIN users au ON au.id = t.assigned_agent
    ${whereClause}
    ORDER BY t.${sortField} ${sortOrder}, t.created_at DESC, t.id DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;

  params.push(limit, offset);

  const countQuery = `
    SELECT COUNT(*) as total
    FROM tickets t
    JOIN users u ON u.id = t.created_by
    LEFT JOIN teams tm ON tm.id = t.assigned_team
    LEFT JOIN users au ON au.id = t.assigned_agent
    ${whereClause}
  `;

  const [itemsRes, countRes] = await Promise.all([
    pool.query<TicketListRow>(query, params),
    pool.query<{ total: string }>(countQuery, params.slice(0, -2))
  ]);

  return {
    items: itemsRes.rows,
    total: parseInt(countRes.rows[0].total, 10)
  };
};

export const getTicketEvents = async (ticketId: string) => {
  const res = await pool.query(
    `SELECT
      e.id,
      e.ticket_id,
      e.action,
      e.old_value,
      e.new_value,
      e.performed_by,
      e.timestamp,
      COALESCE(u.name, 'System') AS performed_by_name
     FROM ticket_events e
     LEFT JOIN users u ON u.id = e.performed_by
     WHERE e.ticket_id = $1
     ORDER BY e.timestamp ASC`,
    [ticketId]
  );
  return res.rows;
};

export const getTicketComments = async (args: { ticketId: string; includeInternal: boolean }) => {
  const res = await pool.query<TicketCommentRow>(
    `SELECT
      c.id,
      c.ticket_id,
      c.author_id,
      u.name AS author_name,
      u.email AS author_email,
      c.body,
      c.is_internal,
      c.visibility::text AS visibility,
      c.created_at
    FROM ticket_comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.ticket_id = $1
      AND ($2::boolean = true OR c.is_internal = false)
    ORDER BY c.created_at ASC`,
    [args.ticketId, args.includeInternal]
  );
  return res.rows;
};

export const createTicketComment = async (args: {
  ticketId: string;
  authorId: string;
  body: string;
  isInternal: boolean;
  visibility?: "INTERNAL_NOTE" | "REQUESTER_COMMENT";
}): Promise<TicketCommentRow> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const visibility = args.visibility ?? (args.isInternal ? "INTERNAL_NOTE" : "REQUESTER_COMMENT");

    const inserted = await client.query<TicketCommentRow>(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal, visibility)
       VALUES ($1, $2, $3, $4, $5::ticket_comment_visibility)
       RETURNING id, ticket_id, author_id, body, is_internal, visibility::text AS visibility, created_at`,
      [args.ticketId, args.authorId, args.body, args.isInternal, visibility]
    );

    // Update ticket updated_at so lists reorder and detail shows fresh timestamp
    await client.query("UPDATE tickets SET updated_at = now() WHERE id = $1", [args.ticketId]);

    const withAuthor = await client.query<TicketCommentRow>(
      `SELECT
        c.id,
        c.ticket_id,
        c.author_id,
        u.name AS author_name,
        u.email AS author_email,
        c.body,
        c.is_internal,
        c.visibility::text AS visibility,
        c.created_at
      FROM ticket_comments c
      JOIN users u ON u.id = c.author_id
      WHERE c.id = $1`,
      [inserted.rows[0]!.id]
    );

    await client.query("COMMIT");

    // Fan-out public updates from master ticket to duplicate tickets (best-effort)
    if (!args.isInternal) {
      try {
        const duplicates = await getDuplicatesForMaster(args.ticketId);
        for (const d of duplicates) {
          await insertPublicAutoComment({
            ticketId: d.id,
            authorId: args.authorId,
            body: `Update from master ticket ${args.ticketId}: ${args.body}`,
          });
          await insertNotification({
            userId: d.created_by,
            ticketId: d.id,
            type: "TICKET_STATUS_CHANGED",
            title: "Update from master ticket",
            body: `Master ticket ${args.ticketId} posted an update.`,
          });
        }
      } catch {
        // ignore fan-out failures
      }
    }

    if (!args.isInternal) {
      try {
        const ticketRes = await pool.query<{
          id: string;
          title: string;
          description: string;
          category: string | null;
          priority: TicketPriority;
          status: TicketStatus;
          assigned_team: string | null;
          assigned_agent: string | null;
          requester_email: string;
          requester_name: string;
        }>(
          `SELECT
             t.id,
             t.title,
             t.description,
             t.category,
             t.priority,
             t.status,
             t.assigned_team,
             t.assigned_agent,
             u.email AS requester_email,
             u.name AS requester_name
           FROM tickets t
           JOIN users u ON u.id = t.created_by
           WHERE t.id = $1`,
          [args.ticketId]
        );

        const t = ticketRes.rows[0];
        if (t) {
          const { processAlerts } = await import("../alerts/alert-rules.service.js");
          await processAlerts({
            ticketId: t.id,
            title: t.title,
            description: t.description,
            category: t.category,
            priority: t.priority,
            status: t.status,
            assignedTeam: t.assigned_team,
            assignedAgent: t.assigned_agent,
            requesterEmail: t.requester_email,
            requesterName: t.requester_name,
            eventType: "TICKET_COMMENTED",
          });
        }
      } catch (err) {
        console.error(`Failed to process alert rules for ticket comment ${args.ticketId}:`, err);
      }

      try {
        await notifyTicketCommented({
          ticketId: args.ticketId,
          authorId: args.authorId,
          authorRole: null,
        });
      } catch (err) {
        console.error(`Failed to create in-app notification for ticket comment ${args.ticketId}:`, err);
      }

      try {
        await notifyTicketWatchersCommented({
          ticketId: args.ticketId,
          actorUserId: args.authorId,
          body: args.body,
          visibility,
        });
      } catch (err) {
        console.error(`Failed to notify ticket watchers for comment ${args.ticketId}:`, err);
      }
    }

    void broadcastBoardsForTicket(args.ticketId, "ticket-commented").catch(() => undefined);
    return withAuthor.rows[0]!;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

export const updateTicketStatus = async (args: {
  ticketId: string;
  newStatus: TicketStatus;
  performedBy: string;
  resolution?: {
    resolution_summary: string;
    symptoms?: string | null;
    root_cause?: string | null;
    steps_performed: string;
  };
  skipResolutionValidation?: boolean;
}): Promise<TicketRow> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentRes = await client.query<TicketRow>("SELECT * FROM tickets WHERE id = $1", [args.ticketId]);
    const current = currentRes.rows[0];
    if (!current) {
      const err = new Error("Ticket not found");
      (err as any).statusCode = 404;
      throw err;
    }

    // Enforce structured resolution data when transitioning to RESOLVED
    if (args.newStatus === "RESOLVED") {
      if (!args.skipResolutionValidation) {
        const summary = args.resolution?.resolution_summary?.trim();
        const steps = args.resolution?.steps_performed?.trim();
        if (!summary || !steps) {
          const err = new Error("Resolution summary and steps performed are required to resolve a ticket");
          (err as any).statusCode = 400;
          throw err;
        }
      }
    }

    assertTransitionAllowed(current.status, args.newStatus);

    const updatedRes = await client.query<TicketRow>(
      `UPDATE tickets
       SET status = $2::ticket_status,
           first_response_at = CASE
             WHEN $2::ticket_status = 'IN_PROGRESS' THEN COALESCE(first_response_at, now())
             ELSE first_response_at
           END,
           resolved_at = CASE
             WHEN $2::ticket_status = 'RESOLVED' THEN COALESCE(resolved_at, now())
             ELSE resolved_at
           END,
           closed_at = CASE
             WHEN $2::ticket_status = 'CLOSED' THEN COALESCE(closed_at, now())
             ELSE closed_at
           END
       WHERE id = $1
       RETURNING *`,
      [args.ticketId, args.newStatus]
    );
    const updated = updatedRes.rows[0]!;

    if (args.newStatus === "RESOLVED") {
      if (args.skipResolutionValidation) {
        // Insert a generic resolution entry for auto-resolved tickets
        await client.query(
          `INSERT INTO ticket_resolutions
            (ticket_id, created_by, resolution_summary, symptoms, root_cause, steps_performed)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            updated.id,
            args.performedBy,
            "Auto-resolved by AI workflow",
            null,
            null,
            "Issue resolved automatically by AI automation."
          ]
        );
      } else if (args.resolution) {
        await client.query(
          `INSERT INTO ticket_resolutions
            (ticket_id, created_by, resolution_summary, symptoms, root_cause, steps_performed)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            updated.id,
            args.performedBy,
            args.resolution.resolution_summary.trim(),
            args.resolution?.symptoms ? args.resolution.symptoms : null,
            args.resolution?.root_cause ? args.resolution.root_cause : null,
            args.resolution.steps_performed.trim(),
          ]
        );
      }
    }

    const action: TicketEventAction = args.newStatus === "CLOSED" ? "CLOSED" : "STATUS_CHANGED";

    await client.query(
      `INSERT INTO ticket_events (ticket_id, action, old_value, new_value, performed_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [
        updated.id,
        action,
        JSON.stringify({ status: current.status }),
        JSON.stringify({ status: updated.status }),
        args.performedBy,
      ]
    );

    await client.query("COMMIT");

    // Auto public comment templates on status changes
    try {
      const msg = getStatusAutoMessage(current.status, updated.status);
      if (msg) {
        await insertPublicAutoComment({ ticketId: updated.id, authorId: args.performedBy, body: msg });
      }

      // Fan-out master status updates to duplicates
      const duplicates = await getDuplicatesForMaster(updated.id);
      for (const d of duplicates) {
        await insertPublicAutoComment({
          ticketId: d.id,
          authorId: args.performedBy,
          body: `Master ticket ${updated.id} status changed to ${updated.status}. You will receive updates from that incident.`,
        });
        await insertNotification({
          userId: d.created_by,
          ticketId: d.id,
          type: "TICKET_STATUS_CHANGED",
          title: "Master ticket updated",
          body: `Master ticket ${updated.id} is now ${updated.status}.`,
        });
      }
    } catch {
      // best-effort; do not fail status update
    }

    void notifyTicketStatusChanged(updated.id, args.performedBy);
    void notifyTicketWatchersStatusChanged({
      ticketId: updated.id,
      actorUserId: args.performedBy,
      previousStatus: current.status,
      nextStatus: updated.status,
    }).catch((err) => {
      console.error(`Failed to notify ticket watchers for status change ${updated.id}:`, err);
    });
    void triggerVisualWorkflow({
      triggerType: "ticket_updated",
      ticketId: updated.id,
      category: updated.category,
      performedBy: args.performedBy,
      triggerData: {
        event: "status_changed",
        fromStatus: current.status,
        toStatus: updated.status,
        priority: updated.priority,
      },
    });
    broadcastMetrics("dashboard", { type: "TICKET_UPDATED", ticketId: updated.id });
    void broadcastBoardsForTicket(updated.id, "ticket-status-updated").catch(() => undefined);
    return updated;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};

export const assignTicket = async (args: {
  ticketId: string;
  assignedTeam: string | null;
  assignedAgent: string | null;
  performedBy: string;
}): Promise<TicketRow> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentRes = await client.query<TicketRow>("SELECT * FROM tickets WHERE id = $1", [args.ticketId]);
    const current = currentRes.rows[0];
    if (!current) {
      const err = new Error("Ticket not found");
      (err as any).statusCode = 404;
      throw err;
    }

    if (args.assignedAgent) {
      const agentRes = await client.query<{ role: string }>(
        "SELECT role FROM users WHERE id = $1",
        [args.assignedAgent]
      );
      const agentRole = agentRes.rows[0]?.role;
      if (!agentRole || (agentRole !== "AGENT" && agentRole !== "ADMIN")) {
        const err = new Error("Assigned agent must be an agent or admin");
        (err as any).statusCode = 400;
        throw err;
      }
    }

    const updatedRes = await client.query<TicketRow>(
      "UPDATE tickets SET assigned_team = $2, assigned_agent = $3 WHERE id = $1 RETURNING *",
      [args.ticketId, args.assignedTeam, args.assignedAgent]
    );
    const updated = updatedRes.rows[0]!;

    await client.query(
      `INSERT INTO ticket_events (ticket_id, action, old_value, new_value, performed_by)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
      [
        updated.id,
        "ASSIGNED",
        JSON.stringify({ assigned_team: current.assigned_team, assigned_agent: current.assigned_agent }),
        JSON.stringify({ assigned_team: updated.assigned_team, assigned_agent: updated.assigned_agent }),
        args.performedBy,
      ]
    );

    await client.query("COMMIT");
    if (updated.assigned_agent) {
      void notifyTicketAssigned(updated.id, args.performedBy);
    }
    void notifyTicketWatchersAssignmentChanged({
      ticketId: updated.id,
      actorUserId: args.performedBy,
      assignedTeamId: updated.assigned_team,
      assignedAgentId: updated.assigned_agent,
    }).catch((err) => {
      console.error(`Failed to notify ticket watchers for assignment change ${updated.id}:`, err);
    });
    void triggerVisualWorkflow({
      triggerType: "ticket_updated",
      ticketId: updated.id,
      category: updated.category,
      performedBy: args.performedBy,
      triggerData: {
        event: "assignment_changed",
        assignedTeam: updated.assigned_team,
        assignedAgent: updated.assigned_agent,
      },
    });
    broadcastMetrics("dashboard", { type: "TICKET_ASSIGNED", ticketId: updated.id });
    void broadcastBoardsForTicket(updated.id, "ticket-assignment-updated").catch(() => undefined);
    return updated;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
};
