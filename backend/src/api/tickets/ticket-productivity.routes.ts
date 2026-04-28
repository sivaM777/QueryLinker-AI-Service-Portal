import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { getTicketDetailById } from "../../services/tickets/ticket.service.js";
import {
  bulkUpdateTickets,
  createContextualTicket,
  createTicketSavedView,
  createTicketTemplate,
  deleteTicketSavedView,
  deleteTicketTemplate,
  getTicketProductivityDefaults,
  getTicketSavedViews,
  getTicketTemplates,
  inlineUpdateTicketField,
  parseTicketListFilters,
  updateTicketSavedView,
  updateTicketTemplate,
} from "../../services/tickets/ticket-productivity.service.js";
import { addTicketWatcher, getTicketWatchers, removeTicketWatcher } from "../../services/tickets/ticket-watchers.service.js";

const savedViewSchema = z.object({
  name: z.string().min(1).max(120),
  scope: z.enum(["PERSONAL", "TEAM"]).optional(),
  team_id: z.string().uuid().nullable().optional(),
  columns: z.array(z.string()).optional(),
  filters: z
    .array(
      z.object({
        field: z.string().min(1).max(120),
        operator: z.enum(["eq", "neq", "contains", "in", "empty", "not_empty", "gte", "lte"]),
        value: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
      })
    )
    .optional(),
  sort_field: z.string().optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
  page_size: z.number().int().min(10).max(200).optional(),
});

const templateSchema = z.object({
  name: z.string().min(1).max(120),
  scope: z.enum(["PERSONAL", "TEAM"]).optional(),
  team_id: z.string().uuid().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  body: z.string().max(4000).nullable().optional(),
  ticket_type: z.enum(["INCIDENT", "SERVICE_REQUEST", "CHANGE", "PROBLEM"]).optional(),
  category: z.string().max(120).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assigned_team: z.string().uuid().nullable().optional(),
  assigned_agent: z.string().uuid().nullable().optional(),
  default_tags: z.array(z.string().max(40)).max(20).optional(),
});

const inlineUpdateSchema = z.object({
  field: z.enum(["status", "priority", "assigned_team", "assigned_agent", "tags"]),
  value: z.union([z.string(), z.array(z.string())]).nullable(),
  assigned_team: z.string().uuid().nullable().optional(),
  assigned_agent: z.string().uuid().nullable().optional(),
});

const bulkUpdateSchema = z.object({
  ticket_ids: z.array(z.string().uuid()).min(1).max(200),
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assigned_team: z.string().uuid().nullable().optional(),
  assigned_agent: z.string().uuid().nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

const routeViewer = (request: any) => {
  const user = request.authUser!;
  return {
    userId: user.id,
    role: user.role,
    organizationId: user.organization_id ?? null,
    teamId: user.team_id ?? null,
  };
};

const ensureTicketAccess = async (request: any, ticketId: string) => {
  const user = request.authUser!;
  const ticket = await getTicketDetailById(ticketId);
  if (!ticket) {
    const err = new Error("Ticket not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (user.organization_id && ticket.organization_id !== user.organization_id) {
    const err = new Error("Ticket not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (user.role === "EMPLOYEE" && ticket.created_by !== user.id) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  return ticket;
};

export const ticketProductivityRoutes: FastifyPluginAsync = async (server) => {
  server.get("/productivity/defaults", { preHandler: [requireAuth] }, async (_request, reply) => {
    return reply.send(getTicketProductivityDefaults());
  });

  server.get("/views", { preHandler: [requireAuth] }, async (request, reply) => {
    const views = await getTicketSavedViews(routeViewer(request));
    return reply.send(views);
  });

  server.post("/views", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = savedViewSchema.parse(request.body);
    const created = await createTicketSavedView(routeViewer(request), body);
    return reply.code(201).send(created);
  });

  server.patch("/views/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = savedViewSchema.partial().parse(request.body);
    const updated = await updateTicketSavedView(routeViewer(request), params.id, body);
    return reply.send(updated);
  });

  server.delete("/views/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const deleted = await deleteTicketSavedView(routeViewer(request), params.id);
    if (!deleted) return reply.code(404).send({ message: "Saved view not found" });
    return reply.code(204).send();
  });

  server.get("/templates", { preHandler: [requireAuth] }, async (request, reply) => {
    const templates = await getTicketTemplates(routeViewer(request));
    return reply.send(templates);
  });

  server.post("/templates", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = templateSchema.parse(request.body);
    const created = await createTicketTemplate(routeViewer(request), body);
    return reply.code(201).send(created);
  });

  server.patch("/templates/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = templateSchema.partial().parse(request.body);
    const updated = await updateTicketTemplate(routeViewer(request), params.id, body);
    return reply.send(updated);
  });

  server.delete("/templates/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const deleted = await deleteTicketTemplate(routeViewer(request), params.id);
    if (!deleted) return reply.code(404).send({ message: "Template not found" });
    return reply.code(204).send();
  });

  server.patch("/:id/inline", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = inlineUpdateSchema.parse(request.body);
    await ensureTicketAccess(request, params.id);

    const user = request.authUser!;
    if (body.field !== "tags" && user.role === "EMPLOYEE") {
      return reply.code(403).send({ message: "Forbidden" });
    }

    const updated = await inlineUpdateTicketField({
      ...routeViewer(request),
      ticketId: params.id,
      field: body.field,
      value: body.value,
      companionAssignedTeam: body.assigned_team ?? null,
      companionAssignedAgent: body.assigned_agent ?? null,
    });

    return reply.send(updated);
  });

  server.post("/bulk-update", { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] }, async (request, reply) => {
    const body = bulkUpdateSchema.parse(request.body);
    const result = await bulkUpdateTickets({
      ...routeViewer(request),
      ticketIds: body.ticket_ids,
      status: body.status,
      priority: body.priority,
      assigned_team: body.assigned_team ?? undefined,
      assigned_agent: body.assigned_agent ?? undefined,
      tags: body.tags,
    });
    return reply.send(result);
  });

  server.get("/:id/watchers", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await ensureTicketAccess(request, params.id);
    const watchers = await getTicketWatchers(params.id);
    return reply.send(watchers);
  });

  server.post("/:id/watch", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await ensureTicketAccess(request, params.id);
    const user = request.authUser!;
    const row = await addTicketWatcher({
      ticketId: params.id,
      userId: user.id,
      createdBy: user.id,
    });
    return reply.code(201).send(row);
  });

  server.delete("/:id/watch", { preHandler: [requireAuth] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await ensureTicketAccess(request, params.id);
    const user = request.authUser!;
    await removeTicketWatcher({ ticketId: params.id, userId: user.id });
    return reply.code(204).send();
  });

  server.post(
    "/:id/create-problem",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await ensureTicketAccess(request, params.id);
      const created = await createContextualTicket({
        ...routeViewer(request),
        sourceTicketId: params.id,
        targetType: "PROBLEM",
      });
      return reply.code(201).send(created);
    }
  );

  server.post(
    "/:id/create-change",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      await ensureTicketAccess(request, params.id);
      const created = await createContextualTicket({
        ...routeViewer(request),
        sourceTicketId: params.id,
        targetType: "CHANGE",
      });
      return reply.code(201).send(created);
    }
  );
};
