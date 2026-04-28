import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";

type SupportLevel = "L1" | "L2" | "L3";

const supportLevelRank: Record<SupportLevel, number> = {
  L1: 1,
  L2: 2,
  L3: 3,
};

type TeamValidationRow = {
  id: string;
  name: string;
  support_level: SupportLevel | null;
  parent_team_id: string | null;
};

const validateTeamRelationships = async (args: {
  teamId?: string;
  organizationId?: string | null;
  supportLevel: SupportLevel | null;
  parentTeamId: string | null;
  escalationTeamId: string | null;
}) => {
  if (args.parentTeamId) {
    const parentRes = await pool.query<TeamValidationRow>(
      `SELECT id, name, support_level, parent_team_id
       FROM teams
       WHERE id = $1
         AND ($2::uuid IS NULL OR organization_id = $2)`,
      [args.parentTeamId, args.organizationId ?? null]
    );
    const parent = parentRes.rows[0] ?? null;
    if (!parent) {
      const err = new Error("Parent team not found");
      (err as any).statusCode = 404;
      throw err;
    }
    if (parent.parent_team_id) {
      const err = new Error("Only top-level teams can be selected as parent teams");
      (err as any).statusCode = 400;
      throw err;
    }
    if (args.supportLevel && parent.support_level && args.supportLevel !== parent.support_level) {
      const err = new Error("Sub-teams must use the same support level as their parent team");
      (err as any).statusCode = 400;
      throw err;
    }
  }

  if (args.escalationTeamId) {
    if (!args.supportLevel) {
      const err = new Error("A support level is required when setting an escalation team");
      (err as any).statusCode = 400;
      throw err;
    }

    const escalationRes = await pool.query<TeamValidationRow>(
      `SELECT id, name, support_level, parent_team_id
       FROM teams
       WHERE id = $1
         AND ($2::uuid IS NULL OR organization_id = $2)`,
      [args.escalationTeamId, args.organizationId ?? null]
    );
    const escalationTeam = escalationRes.rows[0] ?? null;
    if (!escalationTeam) {
      const err = new Error("Escalation team not found");
      (err as any).statusCode = 404;
      throw err;
    }
    if (!escalationTeam.support_level) {
      const err = new Error("Escalation team must have a support level");
      (err as any).statusCode = 400;
      throw err;
    }
    if (args.teamId && escalationTeam.id === args.teamId) {
      const err = new Error("A team cannot escalate to itself");
      (err as any).statusCode = 400;
      throw err;
    }
    if (supportLevelRank[escalationTeam.support_level] <= supportLevelRank[args.supportLevel]) {
      const err = new Error("Escalation team must be at a higher support level");
      (err as any).statusCode = 400;
      throw err;
    }
  }
};

const validateTeamManager = async (managerId: string | null, organizationId?: string | null) => {
  if (!managerId) return;

  const managerRes = await pool.query<{ id: string; role: "MANAGER" | "ADMIN" | "AGENT" | "EMPLOYEE" }>(
    `SELECT id, role
     FROM users
     WHERE id = $1
       AND ($2::uuid IS NULL OR organization_id = $2)`,
    [managerId, organizationId ?? null]
  );
  const manager = managerRes.rows[0] ?? null;
  if (!manager) {
    const err = new Error("Manager not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (!["MANAGER", "ADMIN"].includes(manager.role)) {
    const err = new Error("Only manager or admin users can own a team");
    (err as any).statusCode = 400;
    throw err;
  }
};

export const teamRoutes: FastifyPluginAsync = async (server) => {
  const teamSchema = z.object({
    name: z.string().min(1).max(100),
    support_level: z.enum(['L1', 'L2', 'L3']).optional(),
    escalation_team_id: z.string().uuid().nullable().optional(),
    auto_escalate_minutes: z.number().int().min(5).max(1440).optional(),
    parent_team_id: z.string().uuid().nullable().optional(),
    manager_id: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
    roles_and_responsibilities: z.array(z.string()).optional(),
  });

  server.get(
    "/",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT", "MANAGER"]) ] },
    async (request, reply) => {
      const requester = request.authUser!;
      const res = await pool.query(
        `SELECT
           t.id,
           t.name,
           t.support_level,
           t.escalation_team_id,
           t.auto_escalate_minutes,
           t.parent_team_id,
           t.manager_id,
           t.description,
           t.roles_and_responsibilities,
           t.created_at,
           manager_user.name AS manager_name,
           manager_user.email AS manager_email
         FROM teams t
         LEFT JOIN users manager_user ON manager_user.id = t.manager_id
         WHERE ($1::uuid IS NULL OR t.organization_id = $1)
         ORDER BY t.name ASC`
        ,
        [requester.organization_id ?? null]
      );
      return reply.send(res.rows);
    }
  );

  server.post(
    "/",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"]) ] },
    async (request, reply) => {
      const body = teamSchema.parse(request.body);
      const requester = request.authUser!;

      if (requester.role === "MANAGER" && body.manager_id && body.manager_id !== requester.id) {
        return reply.code(403).send({ message: "Managers can only assign themselves as team owners" });
      }
      if (!body.manager_id) {
        return reply.code(400).send({ message: "A team manager is required" });
      }

      const organizationId = requester.organization_id ?? null;

      const exists = await pool.query<{ id: string }>(
        `SELECT id FROM teams
         WHERE lower(name) = lower($1)
           AND ($2::uuid IS NULL OR organization_id = $2)
         LIMIT 1`,
        [body.name, organizationId]
      );
      if (exists.rows[0]) return reply.code(409).send({ message: "Team already exists" });

      await validateTeamRelationships({
        supportLevel: body.support_level ?? null,
        organizationId,
        parentTeamId: body.parent_team_id ?? null,
        escalationTeamId: body.escalation_team_id ?? null,
      });
      await validateTeamManager(body.manager_id ?? null, organizationId);

      const res = await pool.query(
        `INSERT INTO teams (
           name,
           support_level,
           escalation_team_id,
           auto_escalate_minutes,
           parent_team_id,
           manager_id,
           description,
           roles_and_responsibilities,
           organization_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, support_level, escalation_team_id, auto_escalate_minutes, parent_team_id, manager_id, description, roles_and_responsibilities, organization_id, created_at`,
        [
          body.name, 
          body.support_level || null, 
          body.escalation_team_id || null, 
          body.auto_escalate_minutes || null,
          body.parent_team_id || null,
          body.manager_id || null,
          body.description || null,
          JSON.stringify(body.roles_and_responsibilities || []),
          organizationId
        ]
      );
      return reply.code(201).send(res.rows[0]);
    }
  );

  server.patch(
    "/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"]) ] },
    async (request, reply) => {
      const id = (request.params as any).id as string;
      const body = teamSchema.parse(request.body);
      const requester = request.authUser!;
      const organizationId = requester.organization_id ?? null;

      if (requester.role === "MANAGER" && body.manager_id && body.manager_id !== requester.id) {
        return reply.code(403).send({ message: "Managers can only assign themselves as team owners" });
      }
      if (!body.manager_id) {
        return reply.code(400).send({ message: "A team manager is required" });
      }

      const exists = await pool.query<{ id: string }>(
        `SELECT id FROM teams
         WHERE lower(name) = lower($1)
           AND id <> $2
           AND ($3::uuid IS NULL OR organization_id = $3)
         LIMIT 1`,
        [body.name, id, organizationId]
      );
      if (exists.rows[0]) return reply.code(409).send({ message: "Team already exists" });

      await validateTeamRelationships({
        teamId: id,
        organizationId,
        supportLevel: body.support_level ?? null,
        parentTeamId: body.parent_team_id ?? null,
        escalationTeamId: body.escalation_team_id ?? null,
      });
      await validateTeamManager(body.manager_id ?? null, organizationId);

      const res = await pool.query(
        `UPDATE teams
         SET name = $2,
             support_level = $3,
             escalation_team_id = $4,
             auto_escalate_minutes = $5,
             parent_team_id = $6,
             manager_id = $7,
             description = $8,
             roles_and_responsibilities = $9
         WHERE id = $1
           AND ($10::uuid IS NULL OR organization_id = $10)
         RETURNING id, name, support_level, escalation_team_id, auto_escalate_minutes, parent_team_id, manager_id, description, roles_and_responsibilities, organization_id, created_at`,
        [
          id, 
          body.name, 
          body.support_level || null, 
          body.escalation_team_id || null, 
          body.auto_escalate_minutes || null,
          body.parent_team_id || null,
          body.manager_id || null,
          body.description || null,
          JSON.stringify(body.roles_and_responsibilities || []),
          organizationId
        ]
      );
      const row = res.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Not found" });
      return reply.send(row);
    }
  );

  server.get(
    "/by-support-level/:level",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT", "MANAGER"]) ] },
    async (request, reply) => {
      const level = (request.params as any).level as string;
      const requester = request.authUser!;
      if (!['L1', 'L2', 'L3'].includes(level)) {
        return reply.code(400).send({ message: "Invalid support level" });
      }

      const res = await pool.query(
        `SELECT id, name, support_level, escalation_team_id, auto_escalate_minutes, created_at
         FROM teams
         WHERE support_level = $1
           AND ($2::uuid IS NULL OR organization_id = $2)
         ORDER BY name ASC`,
        [level, requester.organization_id ?? null]
      );
      return reply.send(res.rows);
    }
  );

  server.delete(
    "/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"]) ] },
    async (request, reply) => {
      const id = (request.params as any).id as string;
      const requester = request.authUser!;
      try {
        await pool.query("BEGIN");
        await pool.query(
          "UPDATE users SET team_id = NULL WHERE team_id = $1 AND ($2::uuid IS NULL OR organization_id = $2)",
          [id, requester.organization_id ?? null]
        );
        const res = await pool.query(
          "DELETE FROM teams WHERE id = $1 AND ($2::uuid IS NULL OR organization_id = $2)",
          [id, requester.organization_id ?? null]
        );
        if (res.rowCount === 0) {
          await pool.query("ROLLBACK");
          return reply.code(404).send({ message: "Not found" });
        }
        await pool.query("COMMIT");
        return reply.code(204).send();
      } catch {
        try {
          await pool.query("ROLLBACK");
        } catch {
          // ignore
        }
        return reply.code(409).send({ message: "Team is in use" });
      }
    }
  );
};
