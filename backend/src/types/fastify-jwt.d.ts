import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      id: string;
      email: string;
      name: string;
      role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
      team_id: string | null;
      session_id?: string | null;
    };
    user: {
      id: string;
      email: string;
      name: string;
      role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
      team_id: string | null;
      session_id?: string | null;
    };
  }
}
