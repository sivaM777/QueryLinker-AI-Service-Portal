import { z } from "zod";

export const TeamSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  category: z.enum(["Network", "Software", "Hardware", "Access / Authentication"]),
});

export type Team = z.infer<typeof TeamSchema>;
