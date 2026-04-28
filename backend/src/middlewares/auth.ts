import { FastifyReply, FastifyRequest } from "fastify";

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
