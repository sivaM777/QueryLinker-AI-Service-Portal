import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { env } from "../../config/env.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import {
  decideApproval,
  getApprovalByToken,
  getPendingApprovalForTicket,
} from "../../services/approvals/approval.service.js";
import { assignTicket } from "../../services/tickets/ticket.service.js";
import { insertNotification } from "../../services/notifications/notification.service.js";

type TicketOwnerRow = {
  created_by: string;
};

export const approvalRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    "/approvals/pending",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
          status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
        })
        .parse(request.query);

      const res = await pool.query(
        `SELECT
           ar.*,
           t.display_number AS ticket_display_number,
           t.title AS ticket_title,
           u.name AS requested_by_name,
           u.email AS requested_by_email
         FROM approval_requests ar
         JOIN tickets t ON t.id = ar.ticket_id
         JOIN users u ON u.id = ar.requested_by
         WHERE ($3::approval_status IS NULL OR ar.status = $3::approval_status)
         ORDER BY ar.created_at DESC
         LIMIT $1 OFFSET $2`,
        [query.limit, query.offset, query.status ?? null]
      );

      const countRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM approval_requests ar
         WHERE ($1::approval_status IS NULL OR ar.status = $1::approval_status)`,
        [query.status ?? null]
      );

      return reply.send({ items: res.rows, total: parseInt(countRes.rows[0]?.count ?? "0") });
    }
  );

  server.get(
    "/approvals/tickets/:ticketId/pending",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z.object({ ticketId: z.string().uuid() }).parse(request.params);

      const ownerRes = await pool.query<TicketOwnerRow>(
        "SELECT created_by FROM tickets WHERE id = $1",
        [params.ticketId]
      );
      const owner = ownerRes.rows[0];
      if (!owner) return reply.code(404).send({ message: "Ticket not found" });

      if (u.role === "EMPLOYEE" && owner.created_by !== u.id) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const pending = await getPendingApprovalForTicket(params.ticketId);
      if (
        pending &&
        u.role === "EMPLOYEE" &&
        pending.status === "pending" &&
        pending.requested_by !== u.id
      ) {
        return reply.send({ approval: null });
      }
      return reply.send({ approval: pending });
    }
  );

  server.post(
    "/approvals/:id/approve",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      const current = await pool.query(
        "SELECT * FROM approval_requests WHERE id = $1",
        [params.id]
      );
      const reqRow: any = current.rows[0];
      if (!reqRow) return reply.code(404).send({ message: "Not found" });

      if (u.role === "EMPLOYEE" && reqRow.requested_by !== u.id) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      if (u.role === "AGENT") {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const decided = await decideApproval({ approvalId: params.id, decision: "approved" });

      // Manager escalation approval: reroute to Escalations team and force HIGH priority
      try {
        const input = (decided as any).input_data || {};
        if (input?.type === "ESCALATION_REROUTE") {
          const escTeam = await pool.query<{ id: string }>(
            "SELECT id FROM teams WHERE lower(name) = lower($1) LIMIT 1",
            [String(input.target_team_name || "Escalations")]
          );
          const escTeamId = escTeam.rows[0]?.id ?? null;
          const performerId = u.id;

          if (escTeamId) {
            await assignTicket({
              ticketId: decided.ticket_id,
              assignedTeam: escTeamId,
              assignedAgent: null,
              performedBy: performerId,
            });
          }

          await pool.query(
            "UPDATE tickets SET priority = 'HIGH' WHERE id = $1",
            [decided.ticket_id]
          );

          const requesterRes = await pool.query<{ created_by: string }>(
            "SELECT created_by FROM tickets WHERE id = $1",
            [decided.ticket_id]
          );
          const requesterId = requesterRes.rows[0]?.created_by;
          if (requesterId) {
            await insertNotification({
              userId: requesterId,
              ticketId: decided.ticket_id,
              type: "TICKET_STATUS_CHANGED",
              title: "Ticket escalated",
              body: "Your ticket was escalated to the Escalations team due to an SLA breach.",
            });
          }

          try {
            const ticketRes = await pool.query<{
              id: string;
              title: string;
              description: string;
              category: string | null;
              priority: string;
              status: string;
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
              [decided.ticket_id]
            );
            const t = ticketRes.rows[0];
            if (t) {
              const { processAlerts } = await import("../../services/alerts/alert-rules.service.js");
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
                eventType: "TICKET_ESCALATED",
              });
            }
          } catch (err) {
            console.error(`Failed to process alert rules for escalated ticket ${decided.ticket_id}:`, err);
          }

          return reply.send({ ok: true, approval: decided, escalated: true });
        }
      } catch (err) {
        console.error("Failed to execute escalation approval:", err);
      }

      const workflowRes = await pool.query("SELECT * FROM workflows WHERE id = $1", [decided.workflow_id]);
      const workflow = workflowRes.rows[0];
      if (!workflow) return reply.code(404).send({ message: "Workflow not found" });

      // Resume existing workflow execution from where it left off (after approval step)
      const { resumeWorkflowExecution } = await import("../../services/workflows/auto-resolution.service.js");
      const execution = await resumeWorkflowExecution(
        decided.workflow_execution_id!,
        workflow,
        decided.step_index, // Resume from step after approval
        { ...(decided.input_data || {}), approved: true },
        decided.ticket_id
      );

      return reply.send({ ok: true, approval: decided, execution });
    }
  );

  server.post(
    "/approvals/:id/reject",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);

      const current = await pool.query(
        "SELECT * FROM approval_requests WHERE id = $1",
        [params.id]
      );
      const reqRow: any = current.rows[0];
      if (!reqRow) return reply.code(404).send({ message: "Not found" });

      if (u.role === "EMPLOYEE" && reqRow.requested_by !== u.id) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      if (u.role === "AGENT") {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const decided = await decideApproval({ approvalId: params.id, decision: "rejected" });

      const { routeTicket, applyRouting } = await import("../../services/routing/intelligent-routing.service.js");
      const tRes = await pool.query("SELECT * FROM tickets WHERE id = $1", [decided.ticket_id]);
      const t = tRes.rows[0];
      if (t) {
        const routing = await routeTicket({
          ticketId: t.id,
          category: t.category,
          priority: t.priority,
          title: t.title,
          description: t.description,
          performedBy: decided.requested_by,
        });

        if (routing.confidence >= 0.6) {
          await applyRouting(t.id, routing, decided.requested_by);
        }
      }

      return reply.send({ ok: true, approval: decided });
    }
  );

  server.get("/approvals/confirm/:token", async (request, reply) => {
    const params = z.object({ token: z.string().min(10) }).parse(request.params);
    const query = z
      .object({
        decision: z.enum(["approve", "reject"]),
      })
      .parse(request.query);

    const approval = await getApprovalByToken(params.token);
    if (!approval) return reply.code(404).send({ message: "Not found" });

    if (approval.status !== "pending") {
      const webUrl = env.PUBLIC_WEB_URL || "http://localhost:3000";
      return reply.redirect(`${webUrl}/app/tickets/${approval.ticket_id}`);
    }

    const decision = query.decision === "approve" ? "approved" : "rejected";
    const decided = await decideApproval({ approvalId: approval.id, decision });

    if (decision === "approved") {
      const workflowRes = await pool.query("SELECT * FROM workflows WHERE id = $1", [decided.workflow_id]);
      const workflow = workflowRes.rows[0];
      if (workflow && decided.workflow_execution_id) {
        const { resumeWorkflowExecution } = await import("../../services/workflows/auto-resolution.service.js");
        await resumeWorkflowExecution(
          decided.workflow_execution_id,
          workflow,
          decided.step_index, // Resume from step after approval
          { ...(decided.input_data || {}), approved: true },
          decided.ticket_id
        );
      }
    } else {
      const { routeTicket, applyRouting } = await import("../../services/routing/intelligent-routing.service.js");
      const tRes = await pool.query("SELECT * FROM tickets WHERE id = $1", [decided.ticket_id]);
      const t = tRes.rows[0];
      if (t) {
        const routing = await routeTicket({
          ticketId: t.id,
          category: t.category,
          priority: t.priority,
          title: t.title,
          description: t.description,
          performedBy: decided.requested_by,
        });
        if (routing.confidence >= 0.6) {
          await applyRouting(t.id, routing, decided.requested_by);
        }
      }
    }

    const webUrl = env.PUBLIC_WEB_URL || "http://localhost:3000";
    return reply.redirect(`${webUrl}/app/tickets/${decided.ticket_id}?approval=${decision}`);
  });

  // Verification endpoint - user confirms if auto-fix worked (YES/NO)
  server.post(
    "/approvals/:id/verify",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = z.object({
        worked: z.boolean(),
        notes: z.string().optional(),
      }).parse(request.body);

      const approvalRes = await pool.query(
        "SELECT * FROM approval_requests WHERE id = $1",
        [params.id]
      );
      const approval = approvalRes.rows[0];
      if (!approval) return reply.code(404).send({ message: "Approval not found" });

      if (u.role === "EMPLOYEE" && approval.requested_by !== u.id) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      // Record verification result
      await pool.query(
        `INSERT INTO workflow_verifications 
         (approval_id, ticket_id, worked, notes, verified_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (approval_id) DO UPDATE SET
           worked = EXCLUDED.worked,
           notes = EXCLUDED.notes,
           verified_at = now()`,
        [params.id, approval.ticket_id, body.worked, body.notes || null, u.id]
      );

      if (body.worked) {
        // Auto-resolve the ticket
        const { updateTicketStatus } = await import("../../services/tickets/ticket.service.js");
        await updateTicketStatus({
          ticketId: approval.ticket_id,
          newStatus: "RESOLVED",
          performedBy: u.id,
          skipResolutionValidation: true,
        });

        // Add success comment
        await pool.query(
          `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
           VALUES ($1, $2, $3, false)`,
          [approval.ticket_id, u.id, "✅ Auto-resolution successful! Issue resolved by AI automation."]
        );
      } else {
        // Escalate - route to human agent
        const { routeTicket, applyRouting } = await import("../../services/routing/intelligent-routing.service.js");
        const tRes = await pool.query("SELECT * FROM tickets WHERE id = $1", [approval.ticket_id]);
        const t = tRes.rows[0];
        if (t) {
          const routing = await routeTicket({
            ticketId: t.id,
            category: t.category,
            priority: t.priority,
            title: t.title,
            description: t.description,
            performedBy: u.id,
          });

          if (routing.confidence >= 0.6) {
            await applyRouting(t.id, routing, u.id);
          }
        }

        // Add escalation comment
        await pool.query(
          `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
           VALUES ($1, $2, $3, false)`,
          [approval.ticket_id, u.id, "❌ Auto-resolution did not work. Escalating to support team."]
        );
      }

      return reply.send({ ok: true, worked: body.worked });
    }
  );

  // Get verification status for a ticket
  server.get(
    "/tickets/:ticketId/verification",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const u = request.authUser!;
      const params = z.object({ ticketId: z.string().uuid() }).parse(request.params);

      const ownerRes = await pool.query(
        "SELECT created_by FROM tickets WHERE id = $1",
        [params.ticketId]
      );
      const owner = ownerRes.rows[0];
      if (!owner) return reply.code(404).send({ message: "Ticket not found" });

      if (u.role === "EMPLOYEE" && owner.created_by !== u.id) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const verifyRes = await pool.query(
        `SELECT * FROM workflow_verifications WHERE ticket_id = $1 ORDER BY verified_at DESC LIMIT 1`,
        [params.ticketId]
      );

      return reply.send({ verification: verifyRes.rows[0] || null });
    }
  );
};
