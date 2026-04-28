import { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../config/db.js";

export type UserRole = "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  team_id: string | null;
  organization_id?: string | null;
  organization_name?: string | null;
  organization_is_demo?: boolean;
  session_id?: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const payload = await request.jwtVerify<AuthUser>();
    if (!payload?.id) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    const res = await pool.query<{ active_session_id: string | null; active_session_tab_id: string | null }>(
      "SELECT active_session_id, active_session_tab_id FROM users WHERE id = $1",
      [payload.id]
    );
    const activeSessionId = res.rows[0]?.active_session_id ?? null;
    const activeTabId = res.rows[0]?.active_session_tab_id ?? null;
    const tabIdHeader = String((request.headers as Record<string, unknown>)["x-tab-id"] ?? "").trim();
    if (!activeSessionId || !payload.session_id || payload.session_id !== activeSessionId) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    if (activeTabId && (!tabIdHeader || tabIdHeader !== activeTabId)) {
      return reply.code(401).send({ message: "Unauthorized" });
    }
    request.authUser = payload;
  } catch {
    return reply.code(401).send({ message: "Unauthorized" });
  }
};

export const requireRole = (allowed: UserRole[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    if (!allowed.includes(request.authUser.role)) {
      return reply.code(403).send({ message: "Forbidden" });
    }
  };
};

export const requireEmployeeOrOwner = (getOwnerId: (request: FastifyRequest) => string) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      return reply.code(401).send({ message: "Unauthorized" });
    }

    if (request.authUser.role === "ADMIN" || request.authUser.role === "AGENT") return;

    const ownerId = getOwnerId(request);
    if (ownerId !== request.authUser.id) {
      return reply.code(403).send({ message: "Forbidden" });
    }
  };
};
