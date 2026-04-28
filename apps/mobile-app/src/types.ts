export type UserRole = "EMPLOYEE" | "AGENT" | "ADMIN";

export type User = {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  team_id: string | null;
};

export type TicketPriority = "LOW" | "MEDIUM" | "HIGH";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export type Ticket = {
  id: string;
  title: string;
  description: string;
  created_by: string;
  category: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_team: string | null;
  assigned_agent: string | null;
  ai_confidence: number | null;
  created_at: string;
  updated_at: string;
};
