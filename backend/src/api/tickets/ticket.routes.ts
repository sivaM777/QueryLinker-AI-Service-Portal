import { FastifyPluginAsync } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import {
  createTicket,
  getAllTickets,
  getTicketDetailById,
  getTicketById,
  getTicketEvents,
  getTicketComments,
  createTicketComment,
  getTicketsForEmployee,
  getTicketsForEmployeePaginated,
  updateTicketStatus,
  assignTicket,
  TicketStatus,
  TicketType,
  TicketPriority,
  getTicketsPaginated,
} from "../../services/tickets/ticket.service.js";
import {
  querySmartTickets,
  parseTicketListFilters,
} from "../../services/tickets/ticket-productivity.service.js";
import { setTicketTags } from "../../services/tickets/ticket-tags.service.js";
import { suggestForText } from "../../services/tickets/ticket-suggest.service.js";
import { autoCloseIdleTickets } from "../../services/tickets/auto-close.service.js";
import { logAudit, logEntityCreated, logEntityUpdate, logEntityViewed } from "../../services/audit/audit.service.js";

const createTicketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  type: z.enum(["INCIDENT", "SERVICE_REQUEST", "CHANGE", "PROBLEM"]).default("INCIDENT") as z.ZodType<TicketType>,
  priority: z
    .enum(["LOW", "MEDIUM", "HIGH"])
    .optional() as z.ZodType<TicketPriority | undefined>,
  category: z.string().max(200).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).optional().nullable(),
});

const statusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]) as z.ZodType<TicketStatus>,
  resolution: z
    .object({
      resolution_summary: z.string().min(1).max(2000),
      symptoms: z.string().max(2000).optional().nullable(),
      root_cause: z.string().max(2000).optional().nullable(),
      steps_performed: z.string().min(1).max(8000),
    })
    .optional(),
});

const assignSchema = z.object({
  assigned_team: z.string().uuid().nullable().optional(),
  assigned_agent: z.string().uuid().nullable().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  is_internal: z.boolean().optional(),
  visibility: z.enum(["INTERNAL_NOTE", "REQUESTER_COMMENT"]).optional(),
});

const relationshipTypeSchema = z.enum([
  "CAUSE_OF",
  "RESOLVED_BY_CHANGE",
  "DUPLICATE_OF",
  "RELATED_TO",
  "BLOCKED_BY",
]);

const createRelationshipSchema = z.object({
  target_ticket_id: z.string().uuid(),
  relationship_type: relationshipTypeSchema,
  notes: z.string().max(1000).optional().nullable(),
});

const incidentDetailsSchema = z.object({
  impact: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().nullable(),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().nullable(),
  screenshot_urls: z.array(z.string().url()).max(20).optional().nullable(),
});

const serviceRequestDetailsSchema = z.object({
  request_category: z.string().min(1).max(120).optional(),
  due_date: z.string().datetime().optional().nullable(),
  approval_required: z.boolean().optional(),
});

const changeDetailsSchema = z.object({
  risk_level: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().nullable(),
  rollback_plan: z.string().max(5000).optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
});

const problemDetailsSchema = z.object({
  rca_notes: z.string().max(8000).optional().nullable(),
  permanent_fix: z.string().max(8000).optional().nullable(),
});

const listTicketsQuerySchema = z.object({
  q: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  assigned_agent: z.string().optional(),
  assigned_team: z.string().optional(),
  created_from: z.string().optional(),
  created_to: z.string().optional(),
  sort: z.string().default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  filters: z.union([z.string(), z.array(z.string())]).optional(),
  fields: z.union([z.string(), z.array(z.string())]).optional(),
  view_id: z.string().uuid().optional(),
  group_by: z.string().optional(),
  chart_by: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const maxAttachmentBytes = 2 * 1024 * 1024;
const maxAttachmentCount = 5;

type ParsedCreateTicketMultipart = {
  fields: {
    title: string;
    description: string;
      type?: TicketType;
      priority?: TicketPriority;
      category?: string | null;
      tags?: string[];
    };
  attachments: Array<{
    filename: string;
    contentType: string;
    sizeBytes: number;
    buffer: Buffer;
  }>;
};

const parseCreateTicketMultipart = async (request: any): Promise<ParsedCreateTicketMultipart> => {
  const fields: Record<string, string> = {};
  const attachments: ParsedCreateTicketMultipart["attachments"] = [];

  for await (const part of request.parts()) {
    if (part.type === "file") {
      const filePart = part as MultipartFile;
      if (!filePart.filename) {
        continue;
      }
      const buffer = await filePart.toBuffer();
      if (buffer.length > maxAttachmentBytes) {
        const err = new Error(`Attachment "${filePart.filename}" exceeds the 2 MB limit`);
        (err as any).statusCode = 400;
        throw err;
      }
      attachments.push({
        filename: filePart.filename,
        contentType: filePart.mimetype || "application/octet-stream",
        sizeBytes: buffer.length,
        buffer,
      });
      if (attachments.length > maxAttachmentCount) {
        const err = new Error(`You can attach up to ${maxAttachmentCount} files per ticket`);
        (err as any).statusCode = 400;
        throw err;
      }
      continue;
    }

    fields[part.fieldname] = typeof part.value === "string" ? part.value : String(part.value ?? "");
  }

  const parsedTags = (() => {
    const raw = fields.tags;
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch {
      // fall back to comma-separated parsing
    }
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  })();

  return {
    fields: {
      title: fields.title ?? "",
      description: fields.description ?? "",
      type: fields.type as TicketType | undefined,
      priority: fields.priority as TicketPriority | undefined,
      category: fields.category?.trim() ? fields.category.trim() : null,
      tags: parsedTags,
    },
    attachments,
  };
};

const insertTicketAttachments = async (args: {
  ticketId: string;
  userId: string;
  attachments: ParsedCreateTicketMultipart["attachments"];
}) => {
  for (const attachment of args.attachments) {
    await pool.query(
      `INSERT INTO ticket_attachments (ticket_id, filename, content_type, size_bytes, content, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        args.ticketId,
        attachment.filename,
        attachment.contentType,
        attachment.sizeBytes,
        attachment.buffer,
        args.userId,
      ]
    );
  }
};

const isOutsideOrganization = (
  user: { organization_id?: string | null },
  row: { organization_id?: string | null }
) => Boolean(user.organization_id && row.organization_id !== user.organization_id);

const validateAssignmentTargets = async (args: {
  organizationId?: string | null;
  assignedTeam?: string | null;
  assignedAgent?: string | null;
}) => {
  if (!args.organizationId) return;

  if (args.assignedTeam) {
    const team = await pool.query(
      `SELECT id FROM teams WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [args.assignedTeam, args.organizationId]
    );
    if (!team.rows[0]) {
      const err = new Error("Assigned team does not belong to this organization");
      (err as any).statusCode = 400;
      throw err;
    }
  }

  if (args.assignedAgent) {
    const agent = await pool.query(
      `SELECT id
       FROM users
       WHERE id = $1
         AND organization_id = $2
         AND role IN ('ADMIN', 'MANAGER', 'AGENT')
       LIMIT 1`,
      [args.assignedAgent, args.organizationId]
    );
    if (!agent.rows[0]) {
      const err = new Error("Assigned agent does not belong to this organization");
      (err as any).statusCode = 400;
      throw err;
    }
  }
};

export const ticketRoutes: FastifyPluginAsync = async (server) => {
  // POST /tickets (Employee)
  server.post("/", { preHandler: [requireAuth, requireRole(["EMPLOYEE"])] }, async (request, reply) => {
    const u = request.authUser!;
    const parsed = request.isMultipart()
      ? await parseCreateTicketMultipart(request)
      : { fields: request.body, attachments: [] };
    const body = createTicketSchema.parse(parsed.fields);

    const ticket = await createTicket({
      title: body.title,
      description: body.description,
      type: body.type,
      priority: body.priority,
      category: body.category ?? null,
      createdBy: u.id,
      performedBy: u.id,
    });

    if (parsed.attachments.length > 0) {
      await insertTicketAttachments({
        ticketId: ticket.id,
        userId: u.id,
        attachments: parsed.attachments,
      });
    }

    if (body.tags?.length) {
      await setTicketTags({
        ticketId: ticket.id,
        organizationId: u.organization_id ?? null,
        tagNames: body.tags,
        createdBy: u.id,
      });
    }

    await logEntityCreated(
      "ticket",
      ticket.id,
      { title: ticket.title, status: ticket.status, priority: ticket.priority, category: ticket.category },
      {
        userId: u.id,
        userEmail: u.email,
        userName: u.name,
        ipAddress: request.ip,
        userAgent: String(request.headers["user-agent"] || ""),
      }
    );

    return reply.code(201).send(ticket);
  });

  // POST /tickets/suggest (Employee) - predictive suggestions before ticket creation
  server.post(
    "/suggest",
    { preHandler: [requireAuth, requireRole(["EMPLOYEE"])] },
    async (request, reply) => {
      const body = z
        .object({
          text: z.string().min(1).max(2000),
        })
        .parse(request.body);

      const u = request.authUser!;
      const suggestions = await suggestForText({
        userId: u.id,
        text: body.text,
      });

      return reply.send(suggestions);
    }
  );

  // GET /tickets/my (Employee)
  server.get("/my", { preHandler: [requireAuth, requireRole(["EMPLOYEE"]) ] }, async (request, reply) => {
    const u = request.authUser!;
    const rawQuery = request.query as any;
    const hasPaging = rawQuery && (rawQuery.limit !== undefined || rawQuery.offset !== undefined);

    const query = listTicketsQuerySchema.parse(request.query);

    const type = query.type
      ? query.type
          .split(',')
          .filter((t) => ['INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM'].includes(t)) as TicketType[]
      : undefined;
    const status = query.status
      ? query.status
          .split(',')
          .filter((s) => ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'].includes(s)) as TicketStatus[]
      : undefined;
    const priority = query.priority
      ? query.priority
          .split(',')
          .filter((p) => ['LOW', 'MEDIUM', 'HIGH'].includes(p)) as TicketPriority[]
      : undefined;
    const category = query.category ? query.category.split(',').filter((c) => c.trim()) : undefined;

    const result = await querySmartTickets({
      userId: u.id,
      role: u.role,
      organizationId: u.organization_id ?? null,
      teamId: u.team_id ?? null,
      q: query.q,
      type,
      status,
      priority,
      category,
      sort: query.sort,
      order: query.order,
      limit: query.limit,
      offset: query.offset,
      filters: parseTicketListFilters(query.filters),
      fields: query.fields ? query.fields.toString().split(",").map((field) => field.trim()).filter(Boolean) : undefined,
      viewId: query.view_id ?? null,
      groupBy: query.group_by ?? null,
      chartBy: query.chart_by ?? null,
    });

    if (!hasPaging) {
      return reply.send(
        (result.items as any[]).map((t) => ({
          id: t.id,
          display_number: t.display_number,
          type: t.type,
          title: t.title,
          status: t.status,
          priority: t.priority,
          category: t.category,
          updated_at: t.updated_at,
          tag_names: t.tag_names ?? [],
        }))
      );
    }

    return reply.send(result);
  });

  // GET /tickets (Admin/Agent/Manager)
  server.get("/", { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"]) ] }, async (request, reply) => {
    const u = request.authUser!;
    const query = listTicketsQuerySchema.parse(request.query);

    const type = query.type ? query.type.split(',').filter(t => ['INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM'].includes(t)) as TicketType[] : undefined;
    const status = query.status ? query.status.split(',').filter(s => ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'].includes(s)) as TicketStatus[] : undefined;
    const priority = query.priority ? query.priority.split(',').filter(p => ['LOW', 'MEDIUM', 'HIGH'].includes(p)) as TicketPriority[] : undefined;
    const category = query.category ? query.category.split(',').filter(c => c.trim()) : undefined;
    const assigned_agent = query.assigned_agent ? query.assigned_agent.split(',').filter(a => a.trim()) : undefined;
    const assigned_team = query.assigned_team ? query.assigned_team.split(',').filter(t => t.trim()) : undefined;

    const result = await querySmartTickets({
      userId: u.id,
      role: u.role,
      organizationId: u.organization_id ?? null,
      teamId: u.team_id ?? null,
      q: query.q,
      type,
      status,
      priority,
      category,
      assigned_agent,
      assigned_team,
      created_from: query.created_from,
      created_to: query.created_to,
      sort: query.sort,
      order: query.order,
      limit: query.limit,
      offset: query.offset,
      filters: parseTicketListFilters(query.filters),
      fields: query.fields ? query.fields.toString().split(",").map((field) => field.trim()).filter(Boolean) : undefined,
      viewId: query.view_id ?? null,
      groupBy: query.group_by ?? null,
      chartBy: query.chart_by ?? null,
    });

    return reply.send(result);
  });

  // GET /tickets/:id/auto-fix (Employee: own, Admin/Agent: any)
  server.get("/:id/auto-fix", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const ticket = await getTicketDetailById(params.id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const execRes = await pool.query<{
      id: string;
      status: string;
      current_step: number;
      started_at: string;
      completed_at: string | null;
      error_message: string | null;
    }>(
      `SELECT id, status, current_step, started_at, completed_at, error_message
       FROM workflow_executions
       WHERE ticket_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [params.id]
    );

    const execution = execRes.rows[0] ?? null;
    let steps: Array<{ step_index: number; step_description: string; executed_at: string; success: boolean }> = [];

    if (execution) {
      const stepsRes = await pool.query<{
        step_index: number;
        step_description: string;
        executed_at: string;
        success: boolean;
      }>(
        `SELECT step_index, step_description, executed_at, success
         FROM workflow_execution_steps
         WHERE execution_id = $1
         ORDER BY step_index ASC, executed_at ASC`,
        [execution.id]
      );
      steps = stepsRes.rows;
    }

    return reply.send({ execution, steps });
  });

  // GET /tickets/:id/relations (Employee: own, Admin/Agent/Manager: any)
  server.get("/:id/relations", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const ticket = await getTicketDetailById(params.id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const res = await pool.query(
      `SELECT
         tr.id,
         tr.source_ticket_id,
         tr.target_ticket_id,
         tr.relationship_type,
         tr.notes,
         tr.created_at,
         tr.created_by,
         creator.name AS created_by_name,
         s.display_number AS source_display_number,
         s.type AS source_type,
         s.title AS source_title,
         s.status AS source_status,
         t.display_number AS target_display_number,
         t.type AS target_type,
         t.title AS target_title,
         t.status AS target_status
       FROM ticket_relationships tr
       JOIN tickets s ON s.id = tr.source_ticket_id
       JOIN tickets t ON t.id = tr.target_ticket_id
       JOIN users creator ON creator.id = tr.created_by
       WHERE tr.source_ticket_id = $1 OR tr.target_ticket_id = $1
       ORDER BY tr.created_at DESC`,
      [params.id]
    );

    const items = res.rows.map((row) => {
      const isSource = row.source_ticket_id === params.id;
      return {
        id: row.id,
        relationship_type: row.relationship_type,
        notes: row.notes,
        direction: isSource ? "OUTGOING" : "INCOMING",
        created_at: row.created_at,
        created_by: row.created_by,
        created_by_name: row.created_by_name,
        related_ticket: isSource
          ? {
              id: row.target_ticket_id,
              display_number: row.target_display_number,
              type: row.target_type,
              title: row.target_title,
              status: row.target_status,
            }
          : {
              id: row.source_ticket_id,
              display_number: row.source_display_number,
              type: row.source_type,
              title: row.source_title,
              status: row.source_status,
            },
      };
    });

    return reply.send(items);
  });

  // POST /tickets/:id/relations (Admin/Agent/Manager)
  server.post(
    "/:id/relations",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT", "MANAGER"])] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = createRelationshipSchema.parse(request.body);

      if (params.id === body.target_ticket_id) {
        return reply.code(400).send({ message: "A ticket cannot relate to itself" });
      }

      const tickets = await pool.query<{
        id: string;
        type: TicketType;
        organization_id: string | null;
      }>(
        `SELECT id, type, organization_id
         FROM tickets
         WHERE id = ANY($1::uuid[])`,
        [[params.id, body.target_ticket_id]]
      );

      const source = tickets.rows.find((row) => row.id === params.id);
      const target = tickets.rows.find((row) => row.id === body.target_ticket_id);
      if (!source || !target) {
        return reply.code(404).send({ message: "Source or target ticket not found" });
      }
      if (isOutsideOrganization(u, source) || isOutsideOrganization(u, target)) {
        return reply.code(404).send({ message: "Source or target ticket not found" });
      }

      if (body.relationship_type === "CAUSE_OF") {
        if (source.type !== "INCIDENT" || target.type !== "PROBLEM") {
          return reply
            .code(400)
            .send({ message: "CAUSE_OF relation requires INCIDENT -> PROBLEM" });
        }
      }

      if (body.relationship_type === "RESOLVED_BY_CHANGE") {
        if (source.type !== "PROBLEM" || target.type !== "CHANGE") {
          return reply
            .code(400)
            .send({ message: "RESOLVED_BY_CHANGE relation requires PROBLEM -> CHANGE" });
        }
      }

      const result = await pool.query(
        `INSERT INTO ticket_relationships
          (source_ticket_id, target_ticket_id, relationship_type, notes, created_by)
         VALUES
          ($1, $2, $3::ticket_relationship_type, $4, $5)
         ON CONFLICT (source_ticket_id, target_ticket_id, relationship_type)
         DO UPDATE SET notes = EXCLUDED.notes
         RETURNING *`,
        [params.id, body.target_ticket_id, body.relationship_type, body.notes ?? null, u.id]
      );

      return reply.code(201).send(result.rows[0]);
    }
  );

  // DELETE /tickets/:id/relations/:relationId (Admin/Agent/Manager)
  server.delete(
    "/:id/relations/:relationId",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT", "MANAGER"])] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z
        .object({ id: z.string().uuid(), relationId: z.string().uuid() })
        .parse(request.params);

      const ticket = await getTicketDetailById(params.id);
      if (!ticket) return reply.code(404).send({ message: "Relationship not found" });
      if (isOutsideOrganization(u, ticket)) {
        return reply.code(404).send({ message: "Relationship not found" });
      }

      const res = await pool.query(
        `DELETE FROM ticket_relationships
         WHERE id = $1
           AND (source_ticket_id = $2 OR target_ticket_id = $2)`,
        [params.relationId, params.id]
      );

      if (res.rowCount === 0) {
        return reply.code(404).send({ message: "Relationship not found" });
      }

      return reply.code(204).send();
    }
  );

  // GET /tickets/:id/work-item-details (Employee: own, Admin/Agent/Manager: any)
  server.get("/:id/work-item-details", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const params = z.object({ id: z.string().uuid() }).parse(request.params);

    const ticket = await getTicketDetailById(params.id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    if (ticket.type === "INCIDENT") {
      const details = await pool.query(
        `SELECT ticket_id, impact, urgency, screenshot_urls, created_at, updated_at
         FROM incident_details
         WHERE ticket_id = $1`,
        [params.id]
      );
      return reply.send({ type: ticket.type, details: details.rows[0] ?? null });
    }

    if (ticket.type === "SERVICE_REQUEST") {
      const details = await pool.query(
        `SELECT ticket_id, request_category, due_date, approval_required, created_at, updated_at
         FROM service_request_details
         WHERE ticket_id = $1`,
        [params.id]
      );
      return reply.send({ type: ticket.type, details: details.rows[0] ?? null });
    }

    if (ticket.type === "CHANGE") {
      const details = await pool.query(
        `SELECT ticket_id, risk_level, rollback_plan, scheduled_at, created_at, updated_at
         FROM change_details
         WHERE ticket_id = $1`,
        [params.id]
      );
      return reply.send({ type: ticket.type, details: details.rows[0] ?? null });
    }

    const details = await pool.query(
      `SELECT ticket_id, rca_notes, permanent_fix, created_at, updated_at
       FROM problem_details
       WHERE ticket_id = $1`,
      [params.id]
    );
    return reply.send({ type: ticket.type, details: details.rows[0] ?? null });
  });

  // PATCH /tickets/:id/work-item-details (Admin/Agent/Manager)
  server.patch(
    "/:id/work-item-details",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT", "MANAGER"])] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const ticket = await getTicketDetailById(params.id);
      if (!ticket) return reply.code(404).send({ message: "Not found" });
      if (isOutsideOrganization(u, ticket)) {
        return reply.code(404).send({ message: "Not found" });
      }

      if (ticket.type === "INCIDENT") {
        const body = incidentDetailsSchema.parse(request.body);
        const result = await pool.query(
          `INSERT INTO incident_details (ticket_id, impact, urgency, screenshot_urls)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (ticket_id)
           DO UPDATE SET
             impact = EXCLUDED.impact,
             urgency = EXCLUDED.urgency,
             screenshot_urls = EXCLUDED.screenshot_urls,
             updated_at = now()
           RETURNING *`,
          [params.id, body.impact ?? null, body.urgency ?? null, body.screenshot_urls ?? null]
        );
        return reply.send({ type: ticket.type, details: result.rows[0] });
      }

      if (ticket.type === "SERVICE_REQUEST") {
        const body = serviceRequestDetailsSchema.parse(request.body);
        const existing = await pool.query<{ request_category: string; approval_required: boolean }>(
          `SELECT request_category, approval_required
           FROM service_request_details
           WHERE ticket_id = $1`,
          [params.id]
        );
        const existingRow = existing.rows[0] ?? null;
        const requestCategory = body.request_category ?? existingRow?.request_category ?? null;
        if (!requestCategory) {
          return reply.code(400).send({ message: "request_category is required for service requests" });
        }

        const result = await pool.query(
          `INSERT INTO service_request_details (ticket_id, request_category, due_date, approval_required)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (ticket_id)
           DO UPDATE SET
             request_category = EXCLUDED.request_category,
             due_date = EXCLUDED.due_date,
             approval_required = EXCLUDED.approval_required,
             updated_at = now()
           RETURNING *`,
          [
            params.id,
            requestCategory,
            body.due_date ?? null,
            body.approval_required ?? existingRow?.approval_required ?? false,
          ]
        );
        return reply.send({ type: ticket.type, details: result.rows[0] });
      }

      if (ticket.type === "CHANGE") {
        const body = changeDetailsSchema.parse(request.body);
        const result = await pool.query(
          `INSERT INTO change_details (ticket_id, risk_level, rollback_plan, scheduled_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (ticket_id)
           DO UPDATE SET
             risk_level = EXCLUDED.risk_level,
             rollback_plan = EXCLUDED.rollback_plan,
             scheduled_at = EXCLUDED.scheduled_at,
             updated_at = now()
           RETURNING *`,
          [params.id, body.risk_level ?? null, body.rollback_plan ?? null, body.scheduled_at ?? null]
        );
        return reply.send({ type: ticket.type, details: result.rows[0] });
      }

      const body = problemDetailsSchema.parse(request.body);
      const result = await pool.query(
        `INSERT INTO problem_details (ticket_id, rca_notes, permanent_fix)
         VALUES ($1, $2, $3)
         ON CONFLICT (ticket_id)
         DO UPDATE SET
           rca_notes = EXCLUDED.rca_notes,
           permanent_fix = EXCLUDED.permanent_fix,
           updated_at = now()
         RETURNING *`,
        [params.id, body.rca_notes ?? null, body.permanent_fix ?? null]
      );
      return reply.send({ type: ticket.type, details: result.rows[0] });
    }
  );

  // GET /tickets/:id (Employee: own, Admin/Agent: any)
  server.get("/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const id = (request.params as any).id as string;

    const ticket = await getTicketDetailById(id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }

    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const events = await getTicketEvents(ticket.id);
    const now = Date.now();
    const firstResponseDueAt = ticket.sla_first_response_due_at ? new Date(ticket.sla_first_response_due_at).getTime() : null;
    const resolutionDueAt = ticket.sla_resolution_due_at ? new Date(ticket.sla_resolution_due_at).getTime() : null;

    const sla = {
      first_response_due_at: ticket.sla_first_response_due_at,
      resolution_due_at: ticket.sla_resolution_due_at,
      first_response_at: ticket.first_response_at,
      resolved_at: ticket.resolved_at,
      closed_at: ticket.closed_at,
      first_response_breached:
        !ticket.first_response_at && typeof firstResponseDueAt === "number" ? now > firstResponseDueAt : false,
      resolution_breached:
        ticket.status !== "CLOSED" && typeof resolutionDueAt === "number" ? now > resolutionDueAt : false,
    };

    await logEntityViewed("ticket", ticket.id, {
      userId: u.id,
      userEmail: u.email,
      userName: u.name,
      ipAddress: request.ip,
      userAgent: String(request.headers["user-agent"] || ""),
    });

    return reply.send({ ticket, events, sla });
  });

  // GET /tickets/:id/comments (Employee: own, Admin/Agent: any)
  server.get("/:id/comments", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const id = (request.params as any).id as string;

    const ticket = await getTicketDetailById(id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const includeInternal = u.role !== "EMPLOYEE";
    const comments = await getTicketComments({ ticketId: ticket.id, includeInternal });
    return reply.send(comments);
  });

  // GET /tickets/:id/attachments (Employee: own, Admin/Agent: any)
  server.get("/:id/attachments", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const id = (request.params as any).id as string;

    const ticket = await getTicketDetailById(id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const res = await pool.query(
      `SELECT id, filename, content_type, size_bytes, created_at
       FROM ticket_attachments
       WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [ticket.id]
    );

    return reply.send(res.rows);
  });

  // GET /tickets/:id/attachments/:attachmentId (download)
  server.get("/:id/attachments/:attachmentId", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const params = z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }).parse(request.params);

    const ticket = await getTicketDetailById(params.id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const res = await pool.query(
      `SELECT filename, content_type, content
       FROM ticket_attachments
       WHERE id = $1 AND ticket_id = $2
       LIMIT 1`,
      [params.attachmentId, params.id]
    );

    const row = res.rows[0];
    if (!row) return reply.code(404).send({ message: "Not found" });

    reply.header("Content-Type", row.content_type || "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${row.filename}"`);
    return reply.send(row.content);
  });

  // POST /tickets/:id/comments (Employee: own, Admin/Agent: any)
  server.post("/:id/comments", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const id = (request.params as any).id as string;
    const body = commentSchema.parse(request.body);

    const ticket = await getTicketDetailById(id);
    if (!ticket) return reply.code(404).send({ message: "Not found" });
    if (isOutsideOrganization(u, ticket)) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (u.role === "EMPLOYEE" && ticket.created_by !== u.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const visibility =
      u.role === "EMPLOYEE"
        ? "REQUESTER_COMMENT"
        : body.visibility ?? (body.is_internal ? "INTERNAL_NOTE" : "REQUESTER_COMMENT");
    const isInternal = visibility === "INTERNAL_NOTE";
    const created = await createTicketComment({
      ticketId: ticket.id,
      authorId: u.id,
      body: body.body,
      isInternal,
      visibility,
    });

    await logAudit({
      entityType: "ticket_comment",
      entityId: created.id,
      action: "created",
      newValue: body.body,
      userId: u.id,
      userEmail: u.email,
      userName: u.name,
      ipAddress: request.ip,
      userAgent: String(request.headers["user-agent"] || ""),
      metadata: { ticketId: ticket.id, isInternal, visibility },
    });

    return reply.code(201).send(created);
  });

  // PATCH /tickets/:id/status (Admin/Agent)
  server.patch("/:id/status", { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT"]) ] }, async (request, reply) => {
    const u = request.authUser!;
    const id = (request.params as any).id as string;
    const body = statusSchema.parse(request.body);

    try {
      const before = await getTicketById(id);
      if (!before) {
        return reply.code(404).send({ message: "Not found" });
      }
      if (isOutsideOrganization(u, before)) {
        return reply.code(404).send({ message: "Not found" });
      }
      const updated = await updateTicketStatus({
        ticketId: id,
        newStatus: body.status,
        performedBy: u.id,
        resolution: body.resolution,
      });
      if (before) {
        await logEntityUpdate(
          "ticket",
          id,
          { status: before.status },
          { status: updated.status },
          {
            userId: u.id,
            userEmail: u.email,
            userName: u.name,
            ipAddress: request.ip,
            userAgent: String(request.headers["user-agent"] || ""),
          }
        );
      }
      return reply.send(updated);
    } catch (e: any) {
      return reply.code(e?.statusCode ?? 500).send({ message: e?.message ?? "Error" });
    }
  });

  // PATCH /tickets/:id/assign (Admin/Agent)
  server.patch("/:id/assign", { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT"]) ] }, async (request, reply) => {
    const u = request.authUser!;
    const id = (request.params as any).id as string;
    const body = assignSchema.parse(request.body);

    const before = await getTicketById(id);
    if (!before) {
      return reply.code(404).send({ message: "Not found" });
    }
    if (isOutsideOrganization(u, before)) {
      return reply.code(404).send({ message: "Not found" });
    }
    try {
      await validateAssignmentTargets({
        organizationId: u.organization_id ?? null,
        assignedTeam: body.assigned_team ?? null,
        assignedAgent: body.assigned_agent ?? null,
      });
    } catch (e: any) {
      return reply.code(e?.statusCode ?? 500).send({ message: e?.message ?? "Error" });
    }
    const updated = await assignTicket({
      ticketId: id,
      assignedTeam: body.assigned_team ?? null,
      assignedAgent: body.assigned_agent ?? null,
      performedBy: u.id,
    });

    if (before) {
      await logEntityUpdate(
        "ticket",
        id,
        { assigned_team: before.assigned_team, assigned_agent: before.assigned_agent },
        { assigned_team: updated.assigned_team, assigned_agent: updated.assigned_agent },
        {
          userId: u.id,
          userEmail: u.email,
          userName: u.name,
          ipAddress: request.ip,
          userAgent: String(request.headers["user-agent"] || ""),
        }
      );
    }

    return reply.send(updated);
  });

  // POST /tickets/maintenance/auto-close (Admin) - manual trigger for cron-style job
  server.post(
    "/maintenance/auto-close",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (_request, reply) => {
      await autoCloseIdleTickets();
      return reply.send({ ok: true });
    }
  );
};
