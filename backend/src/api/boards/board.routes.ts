import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { MultipartFile } from "@fastify/multipart";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import {
  addBoardCardAttachment,
  addBoardMember,
  createBoard,
  createBoardCard,
  createBoardCardComment,
  createBoardColumn,
  createBoardSwimlane,
  deleteBoard,
  deleteBoardCard,
  deleteBoardColumn,
  deleteBoardSwimlane,
  downloadBoardAttachment,
  getBoard,
  getBoardCardActivity,
  getBoardMembers,
  getBoardView,
  listBoards,
  moveBoardCard,
  removeBoardMember,
  updateBoard,
  updateBoardCard,
  updateBoardColumn,
  updateBoardSwimlane,
  type BoardViewer,
} from "../../services/boards/board.service.js";

const roleGuard = [requireAuth, requireRole(["ADMIN", "MANAGER", "AGENT"])];

const boardViewer = (request: any): BoardViewer => {
  const user = request.authUser!;
  return {
    userId: user.id,
    role: user.role,
    organizationId: user.organization_id ?? null,
    teamId: user.team_id ?? null,
  };
};

const filterSchema = z.object({
  field: z.string().min(1).max(120),
  operator: z.enum(["eq", "neq", "contains", "in", "empty", "not_empty", "gte", "lte"]),
  value: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
});

const createBoardSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  kind: z.enum(["FREEFORM", "DATA_DRIVEN"]),
  mode: z.enum(["GUIDED", "FLEXIBLE"]).nullable().optional(),
  visibility: z.enum(["PERSONAL", "SHARED"]).optional(),
  team_id: z.string().uuid().nullable().optional(),
  saved_view_id: z.string().uuid().nullable().optional(),
  base_filters: z.array(filterSchema).optional(),
  column_field: z.enum(["status", "priority", "assigned_team", "assigned_agent"]).nullable().optional(),
  swimlane_mode: z.enum(["NONE", "MANUAL", "FIELD"]).optional(),
  swimlane_field: z.enum(["assigned_team", "assigned_agent", "priority", "requester_department"]).nullable().optional(),
  preset_key: z.enum(["OPS_QUEUE_STATUS", "HIGH_PRIORITY_ESCALATIONS", "AGENT_WORK_QUEUE", "PERSONAL_FREEFORM"]).nullable().optional(),
});

const updateBoardSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  visibility: z.enum(["PERSONAL", "SHARED"]).optional(),
  team_id: z.string().uuid().nullable().optional(),
  swimlane_mode: z.enum(["NONE", "MANUAL", "FIELD"]).optional(),
  swimlane_field: z.string().nullable().optional(),
  column_field: z.string().nullable().optional(),
});

const boardColumnSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().max(32).nullable().optional(),
  mapped_value: z.string().nullable().optional(),
  filter_config: z.array(filterSchema).optional(),
  drop_update: z
    .object({
      field: z.enum(["status", "priority", "assigned_team", "assigned_agent"]),
      value: z.string().nullable(),
    })
    .nullable()
    .optional(),
  position: z.number().int().min(0).optional(),
});

const boardSwimlaneSchema = z.object({
  name: z.string().min(1).max(120),
  mapped_value: z.string().nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

const boardCardSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  tags: z.array(z.string().max(40)).optional(),
  checklist_summary: z.object({ total: z.number().int().min(0), completed: z.number().int().min(0) }).optional(),
  column_id: z.string().uuid().nullable().optional(),
  swimlane_id: z.string().uuid().nullable().optional(),
});

const updateBoardCardSchema = boardCardSchema.partial();

const moveCardSchema = z.object({
  destination_column_id: z.string().uuid(),
  destination_swimlane_key: z.string().nullable().optional(),
  ordered_card_ids: z.array(z.string()).optional(),
});

const boardCommentSchema = z.object({
  body: z.string().min(1).max(8000),
  visibility: z.enum(["REQUESTER_COMMENT", "INTERNAL_NOTE"]).optional(),
});

const memberSchema = z.object({
  user_id: z.string().uuid(),
  member_role: z.enum(["OWNER", "EDITOR", "VIEWER"]).optional(),
});

const parseSingleUpload = async (request: any) => {
  const part = (await request.file()) as MultipartFile | undefined;
  if (!part || !part.filename) {
    const err = new Error("Attachment file is required");
    (err as any).statusCode = 400;
    throw err;
  }
  const buffer = await part.toBuffer();
  return {
    filename: part.filename,
    contentType: part.mimetype || "application/octet-stream",
    sizeBytes: buffer.length,
    buffer,
  };
};

export const boardRoutes: FastifyPluginAsync = async (server) => {
  server.get("/", { preHandler: roleGuard }, async (request, reply) => {
    return reply.send(await listBoards(boardViewer(request)));
  });

  server.post("/", { preHandler: roleGuard }, async (request, reply) => {
    const body = createBoardSchema.parse(request.body);
    const created = await createBoard(boardViewer(request), body);
    return reply.code(201).send(created);
  });

  server.get("/:id", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return reply.send(await getBoard(boardViewer(request), params.id));
  });

  server.patch("/:id", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateBoardSchema.parse(request.body);
    return reply.send(await updateBoard(boardViewer(request), params.id, body));
  });

  server.delete("/:id", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await deleteBoard(boardViewer(request), params.id);
    return reply.code(204).send();
  });

  server.get("/:id/view", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return reply.send(await getBoardView(boardViewer(request), params.id));
  });

  server.post("/:id/columns", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = boardColumnSchema.parse(request.body);
    return reply.code(201).send(await createBoardColumn(boardViewer(request), params.id, body));
  });

  server.patch("/:id/columns/:columnId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), columnId: z.string().uuid() }).parse(request.params);
    const body = boardColumnSchema.partial().parse(request.body);
    return reply.send(await updateBoardColumn(boardViewer(request), params.id, params.columnId, body));
  });

  server.delete("/:id/columns/:columnId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), columnId: z.string().uuid() }).parse(request.params);
    await deleteBoardColumn(boardViewer(request), params.id, params.columnId);
    return reply.code(204).send();
  });

  server.post("/:id/swimlanes", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = boardSwimlaneSchema.parse(request.body);
    return reply.code(201).send(await createBoardSwimlane(boardViewer(request), params.id, body));
  });

  server.patch("/:id/swimlanes/:swimlaneId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), swimlaneId: z.string().uuid() }).parse(request.params);
    const body = boardSwimlaneSchema.partial().parse(request.body);
    return reply.send(await updateBoardSwimlane(boardViewer(request), params.id, params.swimlaneId, body));
  });

  server.delete("/:id/swimlanes/:swimlaneId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), swimlaneId: z.string().uuid() }).parse(request.params);
    await deleteBoardSwimlane(boardViewer(request), params.id, params.swimlaneId);
    return reply.code(204).send();
  });

  server.post("/:id/cards", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = boardCardSchema.parse(request.body);
    return reply.code(201).send(await createBoardCard(boardViewer(request), params.id, body));
  });

  server.patch("/:id/cards/:cardId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), cardId: z.string().uuid() }).parse(request.params);
    const body = updateBoardCardSchema.parse(request.body);
    return reply.send(await updateBoardCard(boardViewer(request), params.id, params.cardId, body));
  });

  server.delete("/:id/cards/:cardId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), cardId: z.string().uuid() }).parse(request.params);
    await deleteBoardCard(boardViewer(request), params.id, params.cardId);
    return reply.code(204).send();
  });

  server.post("/:id/cards/:cardId/move", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), cardId: z.string() }).parse(request.params);
    const body = moveCardSchema.parse(request.body);
    return reply.send(await moveBoardCard(boardViewer(request), params.id, params.cardId, body));
  });

  server.get("/:id/cards/:cardId/activity", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), cardId: z.string() }).parse(request.params);
    return reply.send(await getBoardCardActivity(boardViewer(request), params.id, params.cardId));
  });

  server.post("/:id/cards/:cardId/comments", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), cardId: z.string() }).parse(request.params);
    const body = boardCommentSchema.parse(request.body);
    return reply.code(201).send(await createBoardCardComment(boardViewer(request), params.id, params.cardId, body));
  });

  server.post("/:id/cards/:cardId/attachments", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), cardId: z.string() }).parse(request.params);
    const file = await parseSingleUpload(request);
    const created = await addBoardCardAttachment({
      viewer: boardViewer(request),
      boardId: params.id,
      cardId: params.cardId,
      ...file,
    });
    return reply.code(201).send(created);
  });

  server.get("/:id/cards/:cardId/attachments/:attachmentId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z
      .object({ id: z.string().uuid(), cardId: z.string(), attachmentId: z.string().uuid() })
      .parse(request.params);
    const file = await downloadBoardAttachment(boardViewer(request), params.id, params.cardId, params.attachmentId);
    if (!file) {
      return reply.code(404).send({ message: "Attachment not found" });
    }
    reply.header("Content-Type", file.content_type || "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename=\"${file.filename}\"`);
    return reply.send(file.content);
  });

  server.get("/:id/members", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    return reply.send(await getBoardMembers(boardViewer(request), params.id));
  });

  server.post("/:id/members", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = memberSchema.parse(request.body);
    return reply.code(201).send(await addBoardMember(boardViewer(request), params.id, body));
  });

  server.delete("/:id/members/:userId", { preHandler: roleGuard }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(request.params);
    await removeBoardMember(boardViewer(request), params.id, params.userId);
    return reply.code(204).send();
  });
};
