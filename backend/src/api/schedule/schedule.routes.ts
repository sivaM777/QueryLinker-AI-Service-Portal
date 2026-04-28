import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { FastifyPluginAsync } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import { z } from "zod";
import { pool } from "../../config/db.js";
import { requireAuth, requireRole, type AuthUser } from "../../middlewares/auth.js";
import { dispatchNotification } from "../../services/notifications/notification.service.js";
import { broadcastScheduleUpdate } from "../../websocket/socket-server.js";

const shiftTypeSchema = z.enum(["MORNING", "EVENING", "NIGHT", "OFF"]);
const timeOffStatusSchema = z.enum(["PENDING", "APPROVED", "DENIED", "CANCELLED"]);

const allowedAttachmentExtensions = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp"]);
const maxAttachmentBytes = 5 * 1024 * 1024;

type TimeOffStatus = z.infer<typeof timeOffStatusSchema>;

type ScheduleUserRow = {
  id: string;
  name: string;
  role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
  team_id: string | null;
  avatar_url: string | null;
  organization_id: string | null;
  manager_id: string | null;
  email: string;
};

const addDaysToDate = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map((value) => parseInt(value, 10));
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  date.setUTCDate(date.getUTCDate() + days);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const isManagerViewer = (requester: AuthUser) => requester.role === "MANAGER";
const canManageSchedule = (requester: AuthUser) => requester.role === "MANAGER" || requester.role === "ADMIN";

const scheduleActionUrlForRole = (role: AuthUser["role"]) => {
  if (role === "EMPLOYEE") return null;
  return "/admin/schedule";
};

const getUserById = async (userId: string): Promise<ScheduleUserRow | null> => {
  const result = await pool.query<ScheduleUserRow>(
    `SELECT id, name, email, role, team_id, avatar_url, organization_id, manager_id
     FROM users
     WHERE id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
};

const assertSameOrganization = (requester: AuthUser, target: { organization_id: string | null }) => {
  const requesterOrg = requester.organization_id ?? null;
  const targetOrg = target.organization_id ?? null;
  if (requesterOrg !== targetOrg) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
};

const assertCanManageUser = async (requester: AuthUser, userId: string) => {
  const user = await getUserById(userId);
  if (!user) {
    const err = new Error("User not found");
    (err as any).statusCode = 404;
    throw err;
  }

  assertSameOrganization(requester, user);

  if (requester.role === "MANAGER" && user.manager_id !== requester.id) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }

  return user;
};

const parseTimeOffMultipart = async (request: any) => {
  const fields: Record<string, string> = {};
  let attachment:
    | {
        filename: string;
        contentType: string;
        tempPath: string;
        url: string;
      }
    | null = null;

  const uploadDir = path.join(process.cwd(), "uploads", "time-off");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  for await (const part of request.parts()) {
    if (part.type === "file") {
      const filePart = part as MultipartFile;
      if (!filePart.filename) continue;

      if (attachment) {
        const err = new Error("Only one leave document can be uploaded per request");
        (err as any).statusCode = 400;
        throw err;
      }

      const extension = path.extname(filePart.filename).toLowerCase();
      if (!allowedAttachmentExtensions.has(extension)) {
        const err = new Error("Leave document must be a PDF, DOC, DOCX, PNG, JPG, JPEG, or WEBP file");
        (err as any).statusCode = 400;
        throw err;
      }

      const filename = `${Date.now()}-${randomUUID()}${extension}`;
      const filePath = path.join(uploadDir, filename);
      let sizeBytes = 0;

      filePart.file.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
        if (sizeBytes > maxAttachmentBytes) {
          filePart.file.destroy(new Error("Leave document exceeds the 5 MB limit"));
        }
      });

      try {
        await pipeline(filePart.file, fs.createWriteStream(filePath));
      } catch (error) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        const err = new Error(
          sizeBytes > maxAttachmentBytes
            ? "Leave document exceeds the 5 MB limit"
            : "Failed to upload leave document"
        );
        (err as any).statusCode = 400;
        throw err;
      }

      attachment = {
        filename: filePart.filename,
        contentType: filePart.mimetype || "application/octet-stream",
        tempPath: filePath,
        url: `/uploads/time-off/${filename}`,
      };
      continue;
    }

    fields[part.fieldname] = typeof part.value === "string" ? part.value : String(part.value ?? "");
  }

  return { fields, attachment };
};

const notifyTimeOffRequested = async (args: {
  requester: AuthUser;
  requesterName: string;
  subject: string;
  startDate: string;
  endDate: string;
  managerId: string | null;
}) => {
  const recipients = await pool.query<{ id: string; email: string | null; role: AuthUser["role"] }>(
    `SELECT id, email, role
     FROM users
     WHERE organization_id IS NOT DISTINCT FROM $1::uuid
       AND (
         role = 'ADMIN'
         OR (role = 'MANAGER' AND id = $2)
       )`,
    [args.requester.organization_id ?? null, args.managerId]
  );

  await Promise.all(
    recipients.rows.map((recipient) =>
      dispatchNotification({
        userId: recipient.id,
        audienceRole: recipient.role,
        type: "TIME_OFF_REQUESTED",
        title: "New time-off request",
        body: `${args.requesterName} requested leave for ${args.startDate} to ${args.endDate}.`,
        actionUrl: "/admin/schedule",
        metadata: {
          subject: args.subject,
          requesterId: args.requester.id,
          startDate: args.startDate,
          endDate: args.endDate,
        },
        dedupeKey: `time-off-requested:${recipient.id}:${args.requester.id}:${args.startDate}:${args.endDate}:${args.subject}`,
        emailEnabled: true,
        emailTo: recipient.email,
      })
    )
  );
};

const notifyTimeOffDecision = async (args: {
  targetUserId: string;
  targetRole: AuthUser["role"];
  targetEmail: string | null;
  subject: string;
  status: TimeOffStatus;
  approverName: string;
  startDate: string;
  endDate: string;
}) => {
  if (args.status !== "APPROVED" && args.status !== "DENIED") return;

  await dispatchNotification({
    userId: args.targetUserId,
    audienceRole: args.targetRole,
    type: args.status === "APPROVED" ? "TIME_OFF_APPROVED" : "TIME_OFF_DENIED",
    title: args.status === "APPROVED" ? "Time-off request approved" : "Time-off request declined",
    body:
      args.status === "APPROVED"
        ? `${args.approverName} approved your leave request for ${args.startDate} to ${args.endDate}.`
        : `${args.approverName} declined your leave request for ${args.startDate} to ${args.endDate}.`,
    actionUrl: scheduleActionUrlForRole(args.targetRole),
    metadata: {
      subject: args.subject,
      startDate: args.startDate,
      endDate: args.endDate,
      approverName: args.approverName,
    },
    dedupeKey: `time-off-decision:${args.targetUserId}:${args.startDate}:${args.endDate}:${args.status}:${args.subject}`,
    emailEnabled: true,
    emailTo: args.targetEmail,
  });
};

export const scheduleRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    "/schedule/weekly",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT", "EMPLOYEE"])] },
    async (request, reply) => {
      const querySchema = z.object({
        start: z.string().date(),
        role: z.enum(["EMPLOYEE", "AGENT", "MANAGER", "ADMIN"]).optional(),
        user_id: z.string().uuid().optional(),
      });
      const query = querySchema.parse(request.query);
      const requester = request.authUser!;
      const start = query.start;
      const end = addDaysToDate(start, 6);
      const role = query.role ?? "AGENT";

      if (requester.role === "AGENT" && role !== "AGENT") {
        return reply.code(403).send({ message: "Forbidden" });
      }
      if (requester.role === "EMPLOYEE" && role !== "EMPLOYEE") {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const values: Array<string | null> = [role, requester.organization_id ?? null];
      const filters = [
        "u.role = $1",
        "u.organization_id IS NOT DISTINCT FROM $2::uuid",
      ];
      let idx = 3;

      if (requester.role === "AGENT" || requester.role === "EMPLOYEE") {
        filters.push(`u.id = $${idx}`);
        values.push(requester.id);
        idx += 1;
      } else if (isManagerViewer(requester) && role === "AGENT") {
        filters.push(`u.manager_id = $${idx}`);
        values.push(requester.id);
        idx += 1;
        if (query.user_id) {
          filters.push(`u.id = $${idx}`);
          values.push(query.user_id);
          idx += 1;
        }
      } else if (query.user_id) {
        filters.push(`u.id = $${idx}`);
        values.push(query.user_id);
        idx += 1;
      }

      const usersRes = await pool.query<ScheduleUserRow>(
        `SELECT u.id, u.name, u.email, u.role, u.team_id, u.avatar_url, u.organization_id, u.manager_id
         FROM users u
         WHERE ${filters.join(" AND ")}
         ORDER BY u.name ASC`,
        values
      );

      const users = usersRes.rows;
      if (users.length === 0) {
        return reply.send({ start, end, users: [], shifts: [], timeOff: [] });
      }

      const userIds = users.map((u) => u.id);

      const shiftsRes = await pool.query(
        `SELECT user_id, shift_date::text AS shift_date, shift_type
         FROM schedule_shifts
         WHERE shift_date BETWEEN $1 AND $2
           AND user_id = ANY($3::uuid[])
         ORDER BY shift_date ASC`,
        [start, end, userIds]
      );

      const timeOffRes = await pool.query(
        `SELECT
           tor.id,
           tor.user_id,
           u.name AS user_name,
           tor.start_date::text AS start_date,
           tor.end_date::text AS end_date,
           tor.subject,
           tor.reason,
           tor.status,
           tor.approver_id,
           approver.name AS approver_name,
           tor.decided_at,
           tor.created_at,
           tor.attachment_name,
           tor.attachment_url,
           tor.attachment_content_type
         FROM time_off_requests tor
         JOIN users u ON u.id = tor.user_id
         LEFT JOIN users approver ON approver.id = tor.approver_id
         WHERE tor.user_id = ANY($3::uuid[])
           AND tor.start_date <= $2
           AND tor.end_date >= $1
         ORDER BY tor.start_date ASC`,
        [start, end, userIds]
      );

      return reply.send({
        start,
        end,
        users,
        shifts: shiftsRes.rows,
        timeOff: timeOffRes.rows,
      });
    }
  );

  server.post(
    "/schedule/shifts",
    { preHandler: [requireAuth, requireRole(["MANAGER", "ADMIN"])] },
    async (request, reply) => {
      const bodySchema = z.object({
        user_id: z.string().uuid(),
        shift_date: z.string().date(),
        shift_type: shiftTypeSchema,
      });
      const body = bodySchema.parse(request.body);
      const requester = request.authUser!;
      const targetUser = await assertCanManageUser(requester, body.user_id);

      const res = await pool.query(
        `INSERT INTO schedule_shifts (user_id, shift_date, shift_type, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, shift_date)
         DO UPDATE SET shift_type = EXCLUDED.shift_type, created_by = $4, updated_at = now()
         RETURNING id, user_id, shift_date::text AS shift_date, shift_type, created_by, created_at, updated_at`,
        [body.user_id, body.shift_date, body.shift_type, requester.id]
      );

      broadcastScheduleUpdate(requester.organization_id ?? null, {
        type: "shift_updated",
        userId: body.user_id,
        shiftDate: body.shift_date,
        shiftType: body.shift_type,
      });

      return reply.send({ ...res.rows[0], user_name: targetUser.name });
    }
  );

  server.post(
    "/schedule/shifts/bulk",
    { preHandler: [requireAuth, requireRole(["MANAGER", "ADMIN"])] },
    async (request, reply) => {
      const bodySchema = z.object({
        shifts: z
          .array(
            z.object({
              user_id: z.string().uuid(),
              shift_date: z.string().date(),
              shift_type: shiftTypeSchema,
            })
          )
          .min(1),
      });
      const body = bodySchema.parse(request.body);
      const requester = request.authUser!;

      const validatedUsers = new Map<string, ScheduleUserRow>();
      for (const shift of body.shifts) {
        if (!validatedUsers.has(shift.user_id)) {
          validatedUsers.set(shift.user_id, await assertCanManageUser(requester, shift.user_id));
        }
      }

      await pool.query("BEGIN");
      try {
        const results: any[] = [];
        for (const shift of body.shifts) {
          const res = await pool.query(
            `INSERT INTO schedule_shifts (user_id, shift_date, shift_type, created_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, shift_date)
             DO UPDATE SET shift_type = EXCLUDED.shift_type, created_by = $4, updated_at = now()
             RETURNING id, user_id, shift_date::text AS shift_date, shift_type, created_by, created_at, updated_at`,
            [shift.user_id, shift.shift_date, shift.shift_type, requester.id]
          );
          results.push(res.rows[0]);
        }
        await pool.query("COMMIT");

        broadcastScheduleUpdate(requester.organization_id ?? null, {
          type: "bulk_shift_updated",
          count: results.length,
        });

        return reply.send({ shifts: results });
      } catch {
        await pool.query("ROLLBACK");
        return reply.code(500).send({ message: "Failed to update shifts" });
      }
    }
  );

  server.get(
    "/schedule/time-off",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT", "EMPLOYEE"])] },
    async (request, reply) => {
      const querySchema = z.object({
        start: z.string().date().optional(),
        end: z.string().date().optional(),
        status: timeOffStatusSchema.optional(),
        user_id: z.string().uuid().optional(),
      });
      const query = querySchema.parse(request.query);
      const requester = request.authUser!;

      const start = query.start ?? addDaysToDate(new Date().toISOString().slice(0, 10), 0);
      const end = query.end ?? addDaysToDate(start, 30);

      const conditions: string[] = [
        "tor.start_date <= $1",
        "tor.end_date >= $2",
        "u.organization_id IS NOT DISTINCT FROM $3::uuid",
      ];
      const values: Array<string | null> = [end, start, requester.organization_id ?? null];
      let idx = 4;

      if (requester.role === "AGENT" || requester.role === "EMPLOYEE") {
        conditions.push(`u.id = $${idx}`);
        values.push(requester.id);
        idx += 1;
      } else if (requester.role === "MANAGER") {
        conditions.push(`(u.manager_id = $${idx} OR u.id = $${idx})`);
        values.push(requester.id);
        idx += 1;
        if (query.user_id) {
          conditions.push(`u.id = $${idx}`);
          values.push(query.user_id);
          idx += 1;
        }
      } else if (query.user_id) {
        conditions.push(`u.id = $${idx}`);
        values.push(query.user_id);
        idx += 1;
      }

      if (query.status) {
        conditions.push(`tor.status = $${idx}`);
        values.push(query.status);
        idx += 1;
      }

      const res = await pool.query(
        `SELECT
           tor.id,
           tor.user_id,
           u.name AS user_name,
           tor.start_date::text AS start_date,
           tor.end_date::text AS end_date,
           tor.subject,
           tor.reason,
           tor.status,
           tor.approver_id,
           approver.name AS approver_name,
           tor.decided_at,
           tor.created_at,
           tor.attachment_name,
           tor.attachment_url,
           tor.attachment_content_type
         FROM time_off_requests tor
         JOIN users u ON u.id = tor.user_id
         LEFT JOIN users approver ON approver.id = tor.approver_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY tor.created_at DESC`,
        values
      );

      return reply.send(res.rows);
    }
  );

  server.post(
    "/schedule/time-off",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT", "EMPLOYEE"])] },
    async (request, reply) => {
      const requester = request.authUser!;
      const isMultipart = typeof (request as any).isMultipart === "function" && (request as any).isMultipart();

      if (!isMultipart) {
        return reply.code(400).send({ message: "Leave subject, reason, and document upload are required" });
      }

      const multipart = await parseTimeOffMultipart(request);
      const bodySchema = z.object({
        start_date: z.string().date(),
        end_date: z.string().date(),
        subject: z.string().min(3).max(160),
        reason: z.string().min(10).max(2000),
      });
      const body = bodySchema.parse(multipart.fields);

      if (!multipart.attachment) {
        return reply.code(400).send({ message: "Please upload a leave letter or supporting document" });
      }

      if (body.start_date > body.end_date) {
        return reply.code(400).send({ message: "Start date must be before end date" });
      }

      const requesterRow = await getUserById(requester.id);
      if (!requesterRow) {
        return reply.code(404).send({ message: "User not found" });
      }

      const res = await pool.query(
        `INSERT INTO time_off_requests
           (user_id, start_date, end_date, subject, reason, attachment_name, attachment_url, attachment_content_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING
           id,
           user_id,
           start_date::text AS start_date,
           end_date::text AS end_date,
           subject,
           reason,
           status,
           approver_id,
           decided_at,
           created_at,
           attachment_name,
           attachment_url,
           attachment_content_type`,
        [
          requester.id,
          body.start_date,
          body.end_date,
          body.subject.trim(),
          body.reason.trim(),
          multipart.attachment.filename,
          multipart.attachment.url,
          multipart.attachment.contentType,
        ]
      );

      await notifyTimeOffRequested({
        requester,
        requesterName: requesterRow.name,
        subject: body.subject.trim(),
        startDate: body.start_date,
        endDate: body.end_date,
        managerId: requesterRow.manager_id,
      });

      broadcastScheduleUpdate(requester.organization_id ?? null, {
        type: "time_off_requested",
        userId: requester.id,
        subject: body.subject.trim(),
        startDate: body.start_date,
        endDate: body.end_date,
      });

      return reply.code(201).send({ ...res.rows[0], user_name: requesterRow.name, approver_name: null });
    }
  );

  server.patch(
    "/schedule/time-off/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT", "EMPLOYEE"])] },
    async (request, reply) => {
      const paramsSchema = z.object({ id: z.string().uuid() });
      const bodySchema = z.object({
        status: timeOffStatusSchema,
      });
      const params = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);
      const requester = request.authUser!;

      const existing = await pool.query<{
        id: string;
        user_id: string;
        status: TimeOffStatus;
        subject: string;
        start_date: string;
        end_date: string;
        organization_id: string | null;
        manager_id: string | null;
        role: AuthUser["role"];
        email: string | null;
        name: string;
      }>(
        `SELECT
           tor.id,
           tor.user_id,
           tor.status,
           tor.subject,
           tor.start_date::text AS start_date,
           tor.end_date::text AS end_date,
           u.organization_id,
           u.manager_id,
           u.role,
           u.email,
           u.name
         FROM time_off_requests tor
         JOIN users u ON u.id = tor.user_id
         WHERE tor.id = $1`,
        [params.id]
      );
      const row = existing.rows[0];
      if (!row) return reply.code(404).send({ message: "Not found" });

      assertSameOrganization(requester, row);

      if (body.status === "CANCELLED") {
        if (requester.role !== "ADMIN" && requester.role !== "MANAGER" && row.user_id !== requester.id) {
          return reply.code(403).send({ message: "Forbidden" });
        }
      } else if (requester.role !== "ADMIN") {
        if (requester.role !== "MANAGER" || row.manager_id !== requester.id) {
          return reply.code(403).send({ message: "Forbidden" });
        }
      }

      const approverId =
        body.status === "APPROVED" || body.status === "DENIED" ? requester.id : null;

      const res = await pool.query(
        `UPDATE time_off_requests
         SET status = $2::time_off_status,
             approver_id = $3::uuid,
             decided_at = CASE
               WHEN $2::time_off_status IN ('APPROVED'::time_off_status, 'DENIED'::time_off_status) THEN now()
               ELSE NULL::timestamptz
             END,
             updated_at = now()
         WHERE id = $1
         RETURNING
           id,
           user_id,
           start_date::text AS start_date,
           end_date::text AS end_date,
           subject,
           reason,
           status,
           approver_id,
           decided_at,
           created_at,
           attachment_name,
           attachment_url,
           attachment_content_type`,
        [params.id, body.status, approverId]
      );

      const updated = res.rows[0];

      if (body.status === "APPROVED" || body.status === "DENIED") {
        await notifyTimeOffDecision({
          targetUserId: row.user_id,
          targetRole: row.role,
          targetEmail: row.email,
          subject: row.subject,
          status: body.status,
          approverName: requester.name,
          startDate: row.start_date,
          endDate: row.end_date,
        });
      }

      broadcastScheduleUpdate(requester.organization_id ?? null, {
        type: "time_off_status_changed",
        requestId: params.id,
        userId: row.user_id,
        status: body.status,
      });

      return reply.send({
        ...updated,
        user_name: row.name,
        approver_name: approverId ? requester.name : null,
      });
    }
  );
};
