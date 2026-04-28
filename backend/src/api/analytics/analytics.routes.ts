import { FastifyPluginAsync } from "fastify";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import { getLatestTrends } from "../../services/analytics/trend.service.js";
import { getRootCauseClusters } from "../../services/analytics/root-cause.service.js";
import { assignTicket } from "../../services/tickets/ticket.service.js";

type AgentLoadRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  team_id: string | null;
  max_concurrent_tickets: number;
  open_tickets: number;
  in_progress_tickets: number;
  high_priority_count: number;
  medium_priority_count: number;
  low_priority_count: number;
  weighted_score: number;
};

type CandidateTicketRow = {
  id: string;
  display_number: string | null;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER";
  assigned_agent: string | null;
  assigned_team: string | null;
  updated_at: string;
};

type WorkloadRecommendation = {
  ticket_id: string;
  display_number: string | null;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER";
  from_agent: { id: string; name: string; email: string };
  to_agent: { id: string; name: string; email: string };
  assigned_team: string | null;
  reason: string;
};

type AuthenticatedUser = {
  id: string;
  role: "ADMIN" | "MANAGER" | "AGENT" | "EMPLOYEE";
  organization_id?: string | null;
};

type TeamOverviewTicketRow = {
  id: string;
  display_number: string | null;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  assigned_agent: string | null;
};

type TeamOverviewSummary = {
  active_tickets: number;
  open: number;
  in_progress: number;
  high_priority: number;
};

const buildManagedAgentFilter = (viewer: AuthenticatedUser) => {
  if (viewer.role !== "MANAGER") {
    const params = viewer.organization_id ? [viewer.organization_id] : [];
    return {
      join: "",
      where: `u.role IN ('AGENT', 'ADMIN')${viewer.organization_id ? " AND u.organization_id = $1" : ""}`,
      params: params as unknown[],
    };
  }

  const params: unknown[] = [viewer.id];
  const orgClause = viewer.organization_id ? " AND u.organization_id = $2" : "";
  if (viewer.organization_id) params.push(viewer.organization_id);

  return {
    join: "LEFT JOIN teams managed_team ON managed_team.id = u.team_id",
    where:
      `u.role = 'AGENT' AND (u.manager_id = $1 OR managed_team.manager_id = $1)${orgClause}`,
    params,
  };
};

const getAgentLoadRows = async (viewer: AuthenticatedUser): Promise<AgentLoadRow[]> => {
  const scope = buildManagedAgentFilter(viewer);
  const res = await pool.query<AgentLoadRow>(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.role,
       u.team_id,
       COALESCE(u.max_concurrent_tickets, 20) AS max_concurrent_tickets,
       COALESCE(w.open_tickets_count, 0) AS open_tickets,
       COALESCE(w.in_progress_tickets_count, 0) AS in_progress_tickets,
       COALESCE(w.high_priority_count, 0) AS high_priority_count,
       COALESCE(w.medium_priority_count, 0) AS medium_priority_count,
       COALESCE(w.low_priority_count, 0) AS low_priority_count,
       ((COALESCE(w.high_priority_count, 0) * 4) +
        (COALESCE(w.medium_priority_count, 0) * 2) +
        (COALESCE(w.low_priority_count, 0) * 1)) AS weighted_score
     FROM users u
     ${scope.join}
     LEFT JOIN agent_workload w ON w.agent_id = u.id
     WHERE ${scope.where}
     ORDER BY weighted_score DESC, u.name ASC`,
    scope.params
  );
  return res.rows;
};

const getTeamOverview = async (viewer: AuthenticatedUser) => {
  const agentRows = await getAgentLoadRows(viewer);
  const summary = agentRows.reduce<TeamOverviewSummary>(
    (acc, row) => {
      acc.open += row.open_tickets;
      acc.in_progress += row.in_progress_tickets;
      acc.high_priority += row.high_priority_count;
      acc.active_tickets += row.open_tickets + row.in_progress_tickets;
      return acc;
    },
    { active_tickets: 0, open: 0, in_progress: 0, high_priority: 0 }
  );

  if (!agentRows.length) {
    return {
      agents: [] as AgentLoadRow[],
      summary,
      tickets: {
        open: [] as TeamOverviewTicketRow[],
        in_progress: [] as TeamOverviewTicketRow[],
        high_priority: [] as TeamOverviewTicketRow[],
      },
    };
  }

  const ticketRes = await pool.query<TeamOverviewTicketRow>(
    `SELECT id, display_number, title, priority, status, assigned_agent
     FROM tickets
     WHERE assigned_agent = ANY($1::uuid[])
       AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER')
     ORDER BY updated_at DESC`,
    [agentRows.map((row) => row.id)]
  );

  return {
    agents: agentRows,
    summary,
    tickets: {
      open: ticketRes.rows.filter((ticket) => ticket.status === "OPEN"),
      in_progress: ticketRes.rows.filter(
        (ticket) => ticket.status === "IN_PROGRESS" || ticket.status === "WAITING_FOR_CUSTOMER"
      ),
      high_priority: ticketRes.rows.filter((ticket) => ticket.priority === "HIGH"),
    },
  };
};

const buildWorkloadRecommendations = async (
  viewer: AuthenticatedUser,
  limit: number
): Promise<WorkloadRecommendation[]> => {
  const agentRows = await getAgentLoadRows(viewer);
  if (!agentRows.length) return [];

  const overloaded = agentRows.filter((row) => {
    const activeCount = row.open_tickets + row.in_progress_tickets;
    return activeCount >= Math.max(1, row.max_concurrent_tickets) || row.weighted_score >= row.max_concurrent_tickets * 2;
  });
  const available = agentRows.filter((row) => {
    const activeCount = row.open_tickets + row.in_progress_tickets;
    return activeCount + 1 < Math.max(1, row.max_concurrent_tickets);
  });

  if (!overloaded.length || !available.length) return [];

  const overloadedIds = overloaded.map((row) => row.id);
  const ticketRes = await pool.query<CandidateTicketRow>(
    `SELECT id, display_number, title, priority, status, assigned_agent, assigned_team, updated_at
     FROM tickets
     WHERE assigned_agent = ANY($1::uuid[])
       AND status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER')
     ORDER BY
       CASE priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
       updated_at ASC`,
    [overloadedIds]
  );

  const agentById = new Map(agentRows.map((row) => [row.id, row]));
  const remainingCapacity = new Map<string, number>();
  for (const row of available) {
    const activeCount = row.open_tickets + row.in_progress_tickets;
    remainingCapacity.set(row.id, Math.max(0, row.max_concurrent_tickets - activeCount - 1));
  }

  const recommendations: WorkloadRecommendation[] = [];

  for (const ticket of ticketRes.rows) {
    if (!ticket.assigned_agent) continue;
    const fromAgent = agentById.get(ticket.assigned_agent);
    if (!fromAgent) continue;

    const candidate = available
      .filter((agent) => agent.id !== ticket.assigned_agent)
      .sort((a, b) => {
        const aCapacity = remainingCapacity.get(a.id) || 0;
        const bCapacity = remainingCapacity.get(b.id) || 0;
        const sameTeamA = a.team_id && fromAgent.team_id && a.team_id === fromAgent.team_id ? 1 : 0;
        const sameTeamB = b.team_id && fromAgent.team_id && b.team_id === fromAgent.team_id ? 1 : 0;
        if (sameTeamA !== sameTeamB) return sameTeamB - sameTeamA;
        if (aCapacity !== bCapacity) return bCapacity - aCapacity;
        return a.weighted_score - b.weighted_score;
      })
      .find((agent) => (remainingCapacity.get(agent.id) || 0) > 0);

    if (!candidate) continue;
    const candidateCapacity = remainingCapacity.get(candidate.id) || 0;
    if (candidateCapacity <= 0) continue;

    remainingCapacity.set(candidate.id, candidateCapacity - 1);

    recommendations.push({
      ticket_id: ticket.id,
      display_number: ticket.display_number,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      assigned_team: ticket.assigned_team,
      from_agent: {
        id: fromAgent.id,
        name: fromAgent.name,
        email: fromAgent.email,
      },
      to_agent: {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
      },
      reason:
        candidate.team_id && fromAgent.team_id && candidate.team_id === fromAgent.team_id
          ? "Same-team rebalance to reduce queue pressure"
          : "Cross-team rebalance based on capacity and workload score",
    });

    if (recommendations.length >= limit) break;
  }

  return recommendations;
};

export const analyticsRoutes: FastifyPluginAsync = async (server) => {
  // GET /analytics/sla-risk (Admin/Agent)
  server.get(
    "/analytics/sla-risk",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const viewer = request.authUser! as AuthenticatedUser;
      const params: unknown[] = [];
      const orgClause = viewer.organization_id ? "AND t.organization_id = $1" : "";
      if (viewer.organization_id) params.push(viewer.organization_id);
      const res = await pool.query<{
        id: string;
        display_number: string | null;
        title: string;
        priority: string;
        status: string;
        sla_resolution_due_at: string | null;
        risk: string | null;
      }>(
        `SELECT
           t.id,
           t.display_number,
           t.title,
           t.priority,
           t.status,
           t.sla_resolution_due_at,
           (t.integration_metadata -> 'ai' ->> 'sla_breach_risk')::text AS risk
         FROM tickets t
         WHERE t.status IN ('OPEN', 'IN_PROGRESS')
           AND (t.integration_metadata -> 'ai' ->> 'sla_breach_risk') IS NOT NULL
           ${orgClause}
         ORDER BY t.sla_resolution_due_at ASC
         LIMIT 10`,
        params
      );

      const counts = res.rows.reduce(
        (acc, r) => {
          const k = (r.risk || "").toUpperCase();
          if (k === "HIGH") acc.high += 1;
          else if (k === "MEDIUM") acc.medium += 1;
          else acc.low += 1;
          return acc;
        },
        { high: 0, medium: 0, low: 0 }
      );

      return reply.send({ counts, tickets: res.rows });
    }
  );

  // GET /analytics/trends (Admin/Agent)
  server.get(
    "/analytics/trends",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (_request, reply) => {
      const trends = await getLatestTrends();
      return reply.send({ trends });
    }
  );

  // GET /analytics/root-causes (Admin/Agent)
  server.get(
    "/analytics/root-causes",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])] },
    async (request, reply) => {
      const viewer = request.authUser! as AuthenticatedUser;
      const clusters = await getRootCauseClusters(viewer.organization_id ?? null);
      return reply.send({ clusters });
    }
  );

  // GET /analytics/integrations/email/tickets (Admin only)
  server.get(
    "/analytics/integrations/email/tickets",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request, reply) => {
      const viewer = request.authUser! as AuthenticatedUser;
      const res = await pool.query<{ date: string; count: string }>(
        `SELECT DATE(created_at) as date, COUNT(*)::text as count
         FROM tickets
         WHERE source_type = 'EMAIL' AND created_at >= NOW() - INTERVAL '30 days'
           ${viewer.organization_id ? "AND organization_id = $1" : ""}
         GROUP BY DATE(created_at)
         ORDER BY date DESC`,
        viewer.organization_id ? [viewer.organization_id] : []
      );
      return reply.send(res.rows.map(r => ({ date: r.date, count: parseInt(r.count) })));
    }
  );

  // GET /analytics/agent-workload/recommendations (Admin/Manager)
  server.get(
    "/analytics/agent-workload/recommendations",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      const viewer = request.authUser! as AuthenticatedUser;
      const query = (request.query ?? {}) as { limit?: string | number };
      const rawLimit = Number(query.limit ?? 20);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 20;
      const recommendations = await buildWorkloadRecommendations(viewer, limit);
      return reply.send({ recommendations, total: recommendations.length });
    }
  );

  // POST /analytics/agent-workload/rebalance (Admin/Manager)
  server.post(
    "/analytics/agent-workload/rebalance",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      const user = request.authUser! as AuthenticatedUser;
      const body = (request.body ?? {}) as {
        ticket_ids?: string[];
        max_moves?: number;
        dry_run?: boolean;
      };

      const maxMoves = Math.max(1, Math.min(100, Number(body.max_moves ?? 20)));
      const suggestions = await buildWorkloadRecommendations(user, maxMoves);
      const filtered = Array.isArray(body.ticket_ids) && body.ticket_ids.length
        ? suggestions.filter((item) => body.ticket_ids!.includes(item.ticket_id))
        : suggestions;

      if (body.dry_run) {
        return reply.send({
          dry_run: true,
          planned_moves: filtered,
          moved: [],
          skipped: [],
        });
      }

      const moved: Array<{ ticket_id: string; to_agent_id: string }> = [];
      const skipped: Array<{ ticket_id: string; reason: string }> = [];

      for (const item of filtered) {
        try {
          await assignTicket({
            ticketId: item.ticket_id,
            assignedTeam: item.assigned_team,
            assignedAgent: item.to_agent.id,
            performedBy: user.id,
          });
          moved.push({ ticket_id: item.ticket_id, to_agent_id: item.to_agent.id });
        } catch (error: unknown) {
          skipped.push({
            ticket_id: item.ticket_id,
            reason: error instanceof Error ? error.message : "Failed to reassign ticket",
          });
        }
      }

      return reply.send({
        dry_run: false,
        planned_moves: filtered,
        moved,
        skipped,
      });
    }
  );

  // GET /analytics/agent-workload (Admin/Manager)
  server.get(
    "/analytics/agent-workload",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      const viewer = request.authUser! as AuthenticatedUser;
      const agents = await getAgentLoadRows(viewer);
      return reply.send({ agents });
    }
  );

  server.get(
    "/analytics/team-overview",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      const viewer = request.authUser! as AuthenticatedUser;
      const overview = await getTeamOverview(viewer);
      return reply.send(overview);
    }
  );
};
