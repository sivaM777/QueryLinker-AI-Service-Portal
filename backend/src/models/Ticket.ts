import { z } from "zod";

export const TicketSchema = z.object({
  id: z.string().optional(),
  summary: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.enum(["Network", "Software", "Hardware", "Access / Authentication"]),
  priority: z.enum(["Low", "Medium", "High"]),
  status: z.enum(["Open", "In Progress", "Resolved", "Closed"]),
  assignee: z.string().optional(),
  requesterEmail: z.string().email(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type Ticket = z.infer<typeof TicketSchema>;
