import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import { hashPassword } from "../../services/auth/auth.service.js";
import { pipeline } from "stream/promises";
import fs from "fs";
import path from "path";

export const userRoutes: FastifyPluginAsync = async (server) => {
  // Minimal placeholder; user management would be expanded later.
  server.get("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send(request.authUser);
  });

  const createUserSchema = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    password: z.string().min(6).max(200),
    role: z.enum(["EMPLOYEE", "AGENT", "MANAGER", "ADMIN"]),
    team_id: z.string().uuid().nullable().optional(),
    manager_id: z.string().uuid().nullable().optional(),
    phone: z.string().max(20).nullable().optional(),
    department: z.string().max(100).nullable().optional(),
    location: z.string().max(100).nullable().optional(),
    bio: z.string().max(1000).nullable().optional(),
    avatar_url: z.string().url().nullable().optional(),
    max_concurrent_tickets: z.number().int().min(1).max(20).optional(),
    certifications: z.array(z.string()).optional(),
    hire_date: z.string().date().nullable().optional(),
  });

  const updateUserSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).max(200).optional(),
    role: z.enum(["EMPLOYEE", "AGENT", "MANAGER", "ADMIN"]).optional(),
    team_id: z.string().uuid().nullable().optional(),
    manager_id: z.string().uuid().nullable().optional(),
    phone: z.string().max(20).nullable().optional(),
    department: z.string().max(100).nullable().optional(),
    location: z.string().max(100).nullable().optional(),
    bio: z.string().max(1000).nullable().optional(),
    avatar_url: z.string().url().nullable().optional(),
    availability_status: z.enum(["ONLINE", "BUSY", "OFFLINE", "ON_BREAK", "AWAY"]).optional(),
    max_concurrent_tickets: z.number().int().min(1).max(20).optional(),
    certifications: z.array(z.string()).optional(),
    hire_date: z.string().date().nullable().optional(),
  });

  const validateUserRelationships = async (args: {
    organizationId: string | null;
    teamId?: string | null;
    managerId?: string | null;
  }) => {
    if (!args.organizationId) return;

    if (args.teamId) {
      const team = await pool.query(
        `SELECT id FROM teams WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [args.teamId, args.organizationId]
      );
      if (!team.rows[0]) {
        const err = new Error("Team does not belong to this organization");
        (err as any).statusCode = 400;
        throw err;
      }
    }

    if (args.managerId) {
      const manager = await pool.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND organization_id = $2
           AND role IN ('MANAGER', 'ADMIN')
         LIMIT 1`,
        [args.managerId, args.organizationId]
      );
      if (!manager.rows[0]) {
        const err = new Error("Manager does not belong to this organization");
        (err as any).statusCode = 400;
        throw err;
      }
    }
  };

  server.patch("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser!;
    const body = updateUserSchema.parse(request.body);
    const id = u.id;

    const updates: string[] = [];
    const values: any[] = [id];
    let idx = 2;

    if (body.name !== undefined) {
      updates.push(`name = $${idx}`);
      values.push(body.name);
      idx += 1;
    }
    if (body.email !== undefined) {
      updates.push(`email = $${idx}`);
      values.push(body.email.toLowerCase());
      idx += 1;
    }
    if (body.phone !== undefined) {
      updates.push(`phone = $${idx}`);
      values.push(body.phone);
      idx += 1;
    }
    if (body.department !== undefined) {
      updates.push(`department = $${idx}`);
      values.push(body.department);
      idx += 1;
    }
    if (body.location !== undefined) {
      updates.push(`location = $${idx}`);
      values.push(body.location);
      idx += 1;
    }
    if (body.bio !== undefined) {
      updates.push(`bio = $${idx}`);
      values.push(body.bio);
      idx += 1;
    }
    if (body.avatar_url !== undefined) {
      updates.push(`avatar_url = $${idx}`);
      values.push(body.avatar_url);
      idx += 1;
    }
    if (body.availability_status !== undefined) {
      updates.push(`availability_status = $${idx}`);
      values.push(body.availability_status);
      idx += 1;
    }
    if (body.max_concurrent_tickets !== undefined) {
      updates.push(`max_concurrent_tickets = $${idx}`);
      values.push(body.max_concurrent_tickets);
      idx += 1;
    }
    if (body.certifications !== undefined) {
      updates.push(`certifications = $${idx}`);
      values.push(body.certifications);
      idx += 1;
    }
    if (body.hire_date !== undefined) {
      updates.push(`hire_date = $${idx}`);
      values.push(body.hire_date);
      idx += 1;
    }
    if (body.password !== undefined) {
      const passwordHash = await hashPassword(body.password);
      updates.push(`password_hash = $${idx}`);
      values.push(passwordHash);
      idx += 1;
    }

    if (updates.length === 0) {
      const res = await pool.query(
        "SELECT id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at FROM users WHERE id = $1",
        [id]
      );
      return reply.send(res.rows[0]);
    }

    updates.push("updated_at = now()");

    const res = await pool.query(
      `UPDATE users SET ${updates.join(", ")}
       WHERE id = $1
       RETURNING id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at`,
      values
    );

    return reply.send(res.rows[0]);
  });

  server.post("/me/avatar", { preHandler: [requireAuth] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ message: "No file uploaded" });
    }

    const u = request.authUser!;
    const fileExtension = path.extname(data.filename).toLowerCase();
    const allowedExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
    
    if (!allowedExtensions.includes(fileExtension)) {
      return reply.code(400).send({ message: "Invalid file type" });
    }

    const filename = `${u.id}-${Date.now()}${fileExtension}`;
    const uploadDir = path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadDir, filename);

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    await pipeline(data.file, fs.createWriteStream(filePath));

    // Use full URL if possible, but relative is safer for now if we don't have a config for base URL.
    // However, the frontend might need a full URL if it's on a different port/domain (which it is, typically).
    // The backend serves static files at /uploads/
    // If frontend and backend are different ports, frontend needs to know the backend URL.
    // The frontend typically has a base API URL.
    // If I return `/uploads/filename`, the frontend can prepend the API base URL if needed, OR the backend URL.
    // But usually `avatar_url` is expected to be a full URL or relative to the app root.
    // Let's return the relative path from the server root.
    // If the frontend uses the backend URL as a prefix for images, this works.
    
    // Use relative URL so frontend can handle it via proxy or base URL
    const avatarUrl = `/uploads/${filename}`;

    await pool.query("UPDATE users SET avatar_url = $1 WHERE id = $2", [avatarUrl, u.id]);

    return reply.send({ avatar_url: avatarUrl });
  });

  server.get(
    "/",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT", "MANAGER"]) ] },
    async (request, reply) => {
      const querySchema = z.object({
        role: z.enum(["EMPLOYEE", "AGENT", "MANAGER", "ADMIN"]).optional(),
      });

      const q = querySchema.parse(request.query);

      const u = request.authUser!;
      const organizationId = u.organization_id ?? null;

      // Least-privilege: Agents may only fetch an agent directory to support ticket assignment.
      // Admins may list all users.
      if (u.role === "AGENT") {
        if (q.role !== "AGENT") {
          return reply.code(403).send({ message: "Forbidden" });
        }
        const res = await pool.query(
          `SELECT id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at
           FROM users
           WHERE role = 'AGENT'
             AND ($1::uuid IS NULL OR organization_id = $1)
           ORDER BY name ASC`,
          [organizationId]
        );
        return reply.send(res.rows);
      }

      if (q.role) {
        const res = await pool.query(
          `SELECT id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at
           FROM users
           WHERE role = $1
             AND ($2::uuid IS NULL OR organization_id = $2)
           ORDER BY name ASC`,
          [q.role, organizationId]
        );
        return reply.send(res.rows);
      }

      const res = await pool.query(
        `SELECT id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at
         FROM users
         WHERE ($1::uuid IS NULL OR organization_id = $1)
         ORDER BY name ASC`,
        [organizationId]
      );
      return reply.send(res.rows);
    }
  );

  server.get(
    "/managers/search",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"])] },
    async (request, reply) => {
      const querySchema = z.object({
        q: z.string().trim().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(25).optional(),
      });

      const q = querySchema.parse(request.query);
      const requester = request.authUser!;
      const organizationId = requester.organization_id ?? null;

      if (requester.role === "MANAGER") {
        const res = await pool.query(
          `SELECT id, name, email, role, team_id, manager_id, avatar_url
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [requester.id]
        );
        return reply.send(res.rows);
      }

      const search = q.q?.trim() || "";
      const limit = q.limit ?? 10;
      const likeTerm = `%${search}%`;

      const res = await pool.query(
        `SELECT id, name, email, role, team_id, manager_id, avatar_url
         FROM users
         WHERE role IN ('MANAGER', 'ADMIN')
           AND ($3::uuid IS NULL OR organization_id = $3)
           AND (
             $1 = ''
             OR name ILIKE $2
             OR email ILIKE $2
           )
         ORDER BY
           CASE WHEN role = 'MANAGER' THEN 0 ELSE 1 END,
           name ASC
         LIMIT $4`,
        [search, likeTerm, organizationId, limit]
      );
      return reply.send(res.rows);
    }
  );

  server.get(
    "/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"]) ] },
    async (request, reply) => {
      const id = (request.params as any).id as string;
      const u = request.authUser!;
      const res = await pool.query(
        `SELECT id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at
         FROM users
         WHERE id = $1
           AND ($2::uuid IS NULL OR organization_id = $2)`,
        [id, u.organization_id ?? null]
      );
      const row = res.rows[0] ?? null;
      if (!row) return reply.code(404).send({ message: "Not found" });
      return reply.send(row);
    }
  );

  server.post(
    "/",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"]) ] },
    async (request, reply) => {
      const body = createUserSchema.parse(request.body);
      const requester = request.authUser!;
      const organizationId = requester.organization_id ?? null;

      // Manager restriction: Can only create AGENT role
      if (requester.role === "MANAGER" && body.role !== "AGENT") {
        return reply.code(403).send({ message: "Managers can only create Agent users" });
      }

      const passwordHash = await hashPassword(body.password);
      try {
        await validateUserRelationships({
          organizationId,
          teamId: body.team_id ?? null,
          managerId: body.manager_id ?? null,
        });
        const res = await pool.query(
          `INSERT INTO users (name, email, password_hash, role, team_id, manager_id, phone, department, location, bio, avatar_url, max_concurrent_tickets, certifications, hire_date, organization_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at`,
          [
            body.name, 
            body.email.toLowerCase(), 
            passwordHash, 
            body.role, 
            body.team_id ?? null, 
            body.manager_id ?? null,
            body.phone ?? null,
            body.department ?? null,
            body.location ?? null,
            body.bio ?? null,
            body.avatar_url ?? null,
            body.max_concurrent_tickets ?? 5,
            body.certifications ?? null,
            body.hire_date ?? null,
            organizationId
          ]
        );
        return reply.code(201).send(res.rows[0]);
      } catch (e: any) {
        if (e?.statusCode) {
          return reply.code(e.statusCode).send({ message: e.message });
        }
        if (String(e?.code) === "23505") {
          return reply.code(409).send({ message: "Email already exists" });
        }
        return reply.code(500).send({ message: "Error" });
      }
    }
  );

  server.patch(
    "/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER"]) ] },
    async (request, reply) => {
      const id = (request.params as any).id as string;
      const body = updateUserSchema.parse(request.body);
      const requester = request.authUser!;
      const organizationId = requester.organization_id ?? null;

      const existing = await pool.query(
        `SELECT id, name, email, role, team_id, manager_id, created_at
         FROM users
         WHERE id = $1
           AND ($2::uuid IS NULL OR organization_id = $2)`,
        [id, organizationId]
      );
      if (!existing.rows[0]) return reply.code(404).send({ message: "Not found" });

      const updates: string[] = [];
      const values: any[] = [id];
      let idx = 2;

      if (body.name !== undefined) {
        updates.push(`name = $${idx}`);
        values.push(body.name);
        idx += 1;
      }
      if (body.email !== undefined) {
        updates.push(`email = $${idx}`);
        values.push(body.email.toLowerCase());
        idx += 1;
      }
      if (body.role !== undefined) {
        updates.push(`role = $${idx}`);
        values.push(body.role);
        idx += 1;
      }
      if (body.team_id !== undefined) {
        updates.push(`team_id = $${idx}`);
        values.push(body.team_id);
        idx += 1;
      }

      if (body.manager_id !== undefined) {
        updates.push(`manager_id = $${idx}`);
        values.push(body.manager_id);
        idx += 1;
      }
      if (body.phone !== undefined) {
        updates.push(`phone = $${idx}`);
        values.push(body.phone);
        idx += 1;
      }
      if (body.department !== undefined) {
        updates.push(`department = $${idx}`);
        values.push(body.department);
        idx += 1;
      }
      if (body.location !== undefined) {
        updates.push(`location = $${idx}`);
        values.push(body.location);
        idx += 1;
      }
      if (body.bio !== undefined) {
        updates.push(`bio = $${idx}`);
        values.push(body.bio);
        idx += 1;
      }
      if (body.avatar_url !== undefined) {
        updates.push(`avatar_url = $${idx}`);
        values.push(body.avatar_url);
        idx += 1;
      }
      if (body.availability_status !== undefined) {
        updates.push(`availability_status = $${idx}`);
        values.push(body.availability_status);
        idx += 1;
      }
      if (body.max_concurrent_tickets !== undefined) {
        updates.push(`max_concurrent_tickets = $${idx}`);
        values.push(body.max_concurrent_tickets);
        idx += 1;
      }
      if (body.certifications !== undefined) {
        updates.push(`certifications = $${idx}`);
        values.push(JSON.stringify(body.certifications));
        idx += 1;
      }
      if (body.hire_date !== undefined) {
        updates.push(`hire_date = $${idx}`);
        values.push(body.hire_date ? new Date(body.hire_date) : null);
        idx += 1;
      }
      if (body.password !== undefined) {
        const passwordHash = await hashPassword(body.password);
        updates.push(`password_hash = $${idx}`);
        values.push(passwordHash);
        idx += 1;
      }

      if (updates.length === 0) {
        return reply.send(existing.rows[0]);
      }

      try {
        await validateUserRelationships({
          organizationId,
          teamId: body.team_id,
          managerId: body.manager_id,
        });
        const res = await pool.query(
          `UPDATE users SET ${updates.join(", ")}
           WHERE id = $1
             AND ($${idx}::uuid IS NULL OR organization_id = $${idx})
           RETURNING id, name, email, role, team_id, manager_id, phone, department, location, bio, avatar_url, availability_status, max_concurrent_tickets, certifications, hire_date, created_at`,
          [...values, organizationId]
        );
        return reply.send(res.rows[0]);
      } catch (e: any) {
        if (e?.statusCode) {
          return reply.code(e.statusCode).send({ message: e.message });
        }
        if (String(e?.code) === "23505") {
          return reply.code(409).send({ message: "Email already exists" });
        }
        return reply.code(500).send({ message: "Error" });
      }
    }
  );

  server.delete(
    "/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN"]) ] },
    async (request, reply) => {
      const u = request.authUser!;
      const id = (request.params as any).id as string;
      if (u.id === id) return reply.code(400).send({ message: "Cannot delete self" });
      try {
        const res = await pool.query(
          "DELETE FROM users WHERE id = $1 AND ($2::uuid IS NULL OR organization_id = $2)",
          [id, u.organization_id ?? null]
        );
        if (res.rowCount === 0) return reply.code(404).send({ message: "Not found" });
        return reply.code(204).send();
      } catch {
        return reply.code(409).send({ message: "User is in use" });
      }
    }
  );
};
