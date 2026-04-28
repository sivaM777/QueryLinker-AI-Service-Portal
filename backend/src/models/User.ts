import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().optional(),
  email: z.string().email(),
  passwordHash: z.string().optional(),
  role: z.enum(["Employee", "Admin"]),
  name: z.string().min(1).max(100),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type User = z.infer<typeof UserSchema>;
