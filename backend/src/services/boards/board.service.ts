import { pool } from "../../config/db.js";
import type { NotificationAudienceRole } from "../notifications/notification.service.js";
import { insertNotification } from "../notifications/notification.service.js";
import {
  querySmartTickets,
  type TicketCommentVisibility,
  type TicketListFilter,
  type TicketListFilterOperator,
  inlineUpdateTicketField,
} from "../tickets/ticket-productivity.service.js";
import {
  createTicketComment,
  getTicketComments,
  getTicketDetailById,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
  updateTicketStatus,
} from "../tickets/ticket.service.js";
import { broadcastBoardEvent, broadcastBoardUpdated } from "./board-realtime.service.js";

export type BoardKind = "FREEFORM" | "DATA_DRIVEN";
export type BoardMode = "GUIDED" | "FLEXIBLE";
export type BoardVisibility = "PERSONAL" | "SHARED";
export type BoardSourceEntity = "TICKET";
export type BoardSwimlaneMode = "NONE" | "MANUAL" | "FIELD";
export type BoardMemberRole = "OWNER" | "EDITOR" | "VIEWER";

export type BoardViewer = {
  userId: string;
  role: NotificationAudienceRole;
  organizationId?: string | null;
  teamId?: string | null;
};

export type BoardRow = {
  id: string;
  organization_id: string | null;
  owner_user_id: string;
  owner_name?: string | null;
  team_id: string | null;
  team_name?: string | null;
  name: string;
  description: string | null;
  kind: BoardKind;
  mode: BoardMode | null;
  visibility: BoardVisibility;
  source_entity: BoardSourceEntity | null;
  base_filters: TicketListFilter[];
  column_field: string | null;
  swimlane_mode: BoardSwimlaneMode;
  swimlane_field: string | null;
  created_at: string;
  updated_at: string;
};

export type BoardColumnRow = {
  id: string;
  board_id: string;
  name: string;
  position: number;
  color: string | null;
  archived: boolean;
  mapped_value: string | null;
  filter_config: TicketListFilter[];
  drop_update: BoardDropUpdateRule | null;
  created_at: string;
};

export type BoardSwimlaneRow = {
  id: string;
  board_id: string;
  name: string;
  position: number;
  mapped_value: string | null;
  color: string | null;
  created_at: string;
};

export type BoardCardRow = {
  id: string;
  board_id: string;
  column_id: string | null;
  swimlane_id: string | null;
  title: string;
  description: string | null;
  priority: TicketPriority;
  assignee_user_id: string | null;
  assignee_name?: string | null;
  due_date: string | null;
  tags: string[];
  checklist_summary: { total: number; completed: number };
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type BoardMemberRow = {
  id: string;
  board_id: string;
  user_id: string;
  member_role: BoardMemberRole;
  created_by: string;
  created_at: string;
  name: string;
  email: string;
  role: NotificationAudienceRole;
};

export type BoardDropUpdateRule = {
  field: "status" | "priority" | "assigned_team" | "assigned_agent";
  value: string | null;
};

export type BoardCardActivityItem = {
  id: string;
  type: "EVENT" | "COMMENT" | "INTERNAL_NOTE" | "ATTACHMENT";
  actor_name: string | null;
  actor_id: string | null;
  body: string | null;
  filename?: string | null;
  attachment_id?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type BoardCardView = {
  id: string;
  board_card_id?: string | null;
  kind: "FREEFORM" | "TICKET";
  title: string;
  description: string | null;
  display_number?: string | null;
  type?: TicketType | null;
  status?: TicketStatus | null;
  priority: TicketPriority;
  assigned_team?: string | null;
  assigned_team_name?: string | null;
  assigned_agent?: string | null;
  assigned_agent_name?: string | null;
  requester_name?: string | null;
  requester_department?: string | null;
  due_date?: string | null;
  tags: string[];
  checklist_summary?: { total: number; completed: number };
  column_id: string | null;
  swimlane_key: string | null;
  updated_at: string;
  comment_count: number;
  attachment_count: number;
};

export type BoardViewResponse = {
  board: BoardRow & { can_edit: boolean; can_manage: boolean };
  columns: BoardColumnRow[];
  swimlanes: Array<{ id: string; key: string | null; name: string; position: number; color?: string | null }>;
  cards: BoardCardView[];
  members: BoardMemberRow[];
};

const MAX_BOARD_TICKETS = 1000;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const SYNTHETIC_DEFAULT_LANE = "__default__";
const SYNTHETIC_UNASSIGNED = "__unassigned__";

const STATUS_ORDER: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"];
const PRIORITY_ORDER: TicketPriority[] = ["HIGH", "MEDIUM", "LOW"];

const parseJsonArray = <T>(value: unknown, fallback: T[]): T[] => (Array.isArray(value) ? (value as T[]) : fallback);

const mapBoard = (row: any): BoardRow => ({
  ...row,
  base_filters: parseJsonArray<TicketListFilter>(row.base_filters, []),
});

const mapBoardColumn = (row: any): BoardColumnRow => ({
  ...row,
  filter_config: parseJsonArray<TicketListFilter>(row.filter_config, []),
  drop_update: row.drop_update ? (row.drop_update as BoardDropUpdateRule) : null,
});

const mapBoardCard = (row: any): BoardCardRow => ({
  ...row,
  tags: parseJsonArray<string>(row.tags, []),
  checklist_summary:
    row.checklist_summary && typeof row.checklist_summary === "object"
      ? row.checklist_summary
      : { total: 0, completed: 0 },
});

const normalizeTextArray = (value?: string[] | null) =>
  Array.from(new Set((value || []).map((entry) => String(entry).trim()).filter(Boolean)));

const normalizeBoardFilters = (value?: TicketListFilter[] | null) => {
  return (value || [])
    .filter((filter) => filter && typeof filter.field === "string" && typeof filter.operator === "string")
    .map((filter) => ({
      field: filter.field,
      operator: filter.operator as TicketListFilterOperator,
      value: filter.value ?? null,
    }));
};

const boardAccessWhere = (
  viewer: BoardViewer,
  params: any[],
  opts?: { includePersonalShared?: boolean }
) => {
  params.push(viewer.organizationId ?? null);
  const orgIndex = params.length;
  params.push(viewer.userId);
  const userIndex = params.length;
  params.push(viewer.teamId ?? null);
  const teamIndex = params.length;
  params.push(viewer.role);
  const roleIndex = params.length;

  const personalSharedGuard = opts?.includePersonalShared ? "OR b.visibility = 'PERSONAL'" : "";

  return `
    b.organization_id IS NOT DISTINCT FROM $${orgIndex}
    AND (
      b.owner_user_id = $${userIndex}
      OR EXISTS (
        SELECT 1
        FROM task_board_members bm
        WHERE bm.board_id = b.id
          AND bm.user_id = $${userIndex}
      )
      OR (
        b.visibility = 'SHARED'
        AND (
          $${roleIndex} = 'ADMIN'
          OR b.team_id IS NULL
          OR b.team_id = $${teamIndex}
        )
      )
      ${personalSharedGuard}
    )
  `;
};

const getBoardAndAccess = async (viewer: BoardViewer, boardId: string) => {
  const params: any[] = [boardId];
  const accessSql = boardAccessWhere(viewer, params);
  const res = await pool.query(
    `SELECT
       b.*,
       owner.name AS owner_name,
       tm.name AS team_name
     FROM task_boards b
     JOIN users owner ON owner.id = b.owner_user_id
     LEFT JOIN teams tm ON tm.id = b.team_id
     WHERE b.id = $1
       AND ${accessSql}
     LIMIT 1`,
    params
  );
  const board = res.rows[0] ? mapBoard(res.rows[0]) : null;
  if (!board) {
    const err = new Error("Board not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const memberRes = await pool.query<{ member_role: BoardMemberRole }>(
    `SELECT member_role
     FROM task_board_members
     WHERE board_id = $1 AND user_id = $2
     LIMIT 1`,
    [boardId, viewer.userId]
  );
  const memberRole = memberRes.rows[0]?.member_role ?? null;
  const canManage =
    board.owner_user_id === viewer.userId ||
    viewer.role === "ADMIN" ||
    ((viewer.role === "MANAGER") && (board.team_id === viewer.teamId || board.owner_user_id === viewer.userId));
  const canEdit =
    canManage ||
    memberRole === "OWNER" ||
    memberRole === "EDITOR" ||
    (board.visibility === "SHARED" && (viewer.role === "AGENT" || viewer.role === "MANAGER" || viewer.role === "ADMIN"));

  return { board, memberRole, canManage, canEdit };
};

const touchBoard = async (boardId: string) => {
  await pool.query(`UPDATE task_boards SET updated_at = now() WHERE id = $1`, [boardId]);
};

const recordBoardEvent = async (args: {
  boardId: string;
  actorUserId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  cardId?: string | null;
  ticketId?: string | null;
}) => {
  await pool.query(
    `INSERT INTO task_board_card_events (board_id, card_id, ticket_id, actor_user_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [args.boardId, args.cardId ?? null, args.ticketId ?? null, args.actorUserId, args.eventType, JSON.stringify(args.payload || {})]
  );
};

const getBoardColumns = async (boardId: string) => {
  const res = await pool.query(
    `SELECT *
     FROM task_board_columns
     WHERE board_id = $1
     ORDER BY archived ASC, position ASC, created_at ASC`,
    [boardId]
  );
  return res.rows.map(mapBoardColumn);
};

const getBoardSwimlanes = async (boardId: string) => {
  const res = await pool.query(
    `SELECT *
     FROM task_board_swimlanes
     WHERE board_id = $1
     ORDER BY position ASC, created_at ASC`,
    [boardId]
  );
  return res.rows as BoardSwimlaneRow[];
};

const getBoardMembersInternal = async (boardId: string): Promise<BoardMemberRow[]> => {
  const res = await pool.query(
    `SELECT
       bm.*,
       u.name,
       u.email,
       u.role
     FROM task_board_members bm
     JOIN users u ON u.id = bm.user_id
     WHERE bm.board_id = $1
     ORDER BY
       CASE bm.member_role WHEN 'OWNER' THEN 0 WHEN 'EDITOR' THEN 1 ELSE 2 END,
       lower(u.name) ASC`,
    [boardId]
  );
  return res.rows as BoardMemberRow[];
};

const matchesFilter = (record: Record<string, any>, filter: TicketListFilter): boolean => {
  const value = record[filter.field];
  const normalizedValues = Array.isArray(filter.value)
    ? filter.value.map((entry) => String(entry))
    : filter.value !== null && filter.value !== undefined
      ? [String(filter.value)]
      : [];

  switch (filter.operator) {
    case "eq":
      return String(value ?? "") === String(filter.value ?? "");
    case "neq":
      return String(value ?? "") !== String(filter.value ?? "");
    case "contains":
      return String(value ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    case "in":
      return normalizedValues.includes(String(value ?? ""));
    case "empty":
      return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    case "not_empty":
      return !(value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0));
    case "gte":
      return String(value ?? "") >= String(filter.value ?? "");
    case "lte":
      return String(value ?? "") <= String(filter.value ?? "");
    default:
      return false;
  }
};

const getTicketFilterComparableRecord = (ticket: Record<string, any>) => ({
  source: ticket.source_type,
  type: ticket.type,
  subject: ticket.title,
  requester: `${ticket.requester_name || ""} ${ticket.requester_email || ""}`.trim(),
  requester_department: ticket.requester_department,
  requester_manager: ticket.requester_manager_name,
  requester_location: ticket.requester_location,
  assigned_team_name: ticket.assigned_team_name,
  assigned_agent_name: ticket.assigned_agent_name,
  creator_name: ticket.creator_name,
  priority: ticket.priority,
  status: ticket.status,
  updated: ticket.updated_at,
  created: ticket.created_at,
  category: ticket.category,
  tags: ticket.tag_names,
  assigned_team: ticket.assigned_team,
  assigned_agent: ticket.assigned_agent,
});

const resolveSwimlaneForTicket = (
  board: BoardRow,
  ticket: Record<string, any>,
  manualSwimlanes: BoardSwimlaneRow[]
) => {
  if (board.kind === "FREEFORM") {
    return { key: SYNTHETIC_DEFAULT_LANE, label: "Board" };
  }
  if (board.swimlane_mode === "NONE") {
    return { key: SYNTHETIC_DEFAULT_LANE, label: "Board" };
  }
  if (board.swimlane_mode === "MANUAL") {
    return {
      key: manualSwimlanes[0]?.id || SYNTHETIC_DEFAULT_LANE,
      label: manualSwimlanes[0]?.name || "Board",
    };
  }
  switch (board.swimlane_field) {
    case "assigned_team":
      return {
        key: ticket.assigned_team || SYNTHETIC_UNASSIGNED,
        label: ticket.assigned_team_name || "Unassigned",
      };
    case "assigned_agent":
      return {
        key: ticket.assigned_agent || SYNTHETIC_UNASSIGNED,
        label: ticket.assigned_agent_name || "Unassigned",
      };
    case "priority":
      return {
        key: ticket.priority || SYNTHETIC_UNASSIGNED,
        label: ticket.priority || "Unspecified",
      };
    case "requester_department":
      return {
        key: ticket.requester_department || SYNTHETIC_UNASSIGNED,
        label: ticket.requester_department || "Unspecified",
      };
    default:
      return { key: SYNTHETIC_DEFAULT_LANE, label: "Board" };
  }
};

const getTicketColumnForBoard = (board: BoardRow, columns: BoardColumnRow[], ticket: Record<string, any>) => {
  const activeColumns = columns.filter((column) => !column.archived);
  if (board.mode === "GUIDED") {
    const field = board.column_field;
    const currentValue =
      field === "status"
        ? ticket.status
        : field === "priority"
          ? ticket.priority
          : field === "assigned_team"
            ? ticket.assigned_team
            : field === "assigned_agent"
              ? ticket.assigned_agent
              : null;
    return (
      activeColumns.find((column) => String(column.mapped_value ?? "") === String(currentValue ?? "")) ||
      activeColumns.find((column) => column.mapped_value === null && (currentValue === null || currentValue === undefined)) ||
      null
    );
  }

  for (const column of activeColumns) {
    const filters = column.filter_config || [];
    if (!filters.length) continue;
    const comparable = getTicketFilterComparableRecord(ticket);
    if (filters.every((filter) => matchesFilter(comparable, filter))) {
      return column;
    }
  }
  return activeColumns[0] || null;
};

const fetchAllBoardTickets = async (viewer: BoardViewer, board: BoardRow) => {
  const allItems: any[] = [];
  let offset = 0;
  while (offset < MAX_BOARD_TICKETS) {
    const page = await querySmartTickets({
      ...viewer,
      limit: 200,
      offset,
      filters: board.base_filters,
    });
    const items = Array.isArray(page.items) ? (page.items as any[]) : [];
    allItems.push(...items);
    offset += items.length;
    if (items.length === 0 || items.length < 200 || offset >= Number(page.total || 0)) {
      break;
    }
  }
  return allItems;
};

const ensureBoardOwnerMember = async (boardId: string, ownerUserId: string) => {
  await pool.query(
    `INSERT INTO task_board_members (board_id, user_id, member_role, created_by)
     VALUES ($1, $2, 'OWNER', $2)
     ON CONFLICT (board_id, user_id)
     DO UPDATE SET member_role = 'OWNER'`,
    [boardId, ownerUserId]
  );
};

const seedFreeformColumns = async (boardId: string) => {
  const columns = [
    { name: "Backlog", color: "#2563eb" },
    { name: "In Progress", color: "#7c3aed" },
    { name: "Done", color: "#059669" },
  ];
  for (const [index, column] of columns.entries()) {
    await pool.query(
      `INSERT INTO task_board_columns (board_id, name, position, color, filter_config)
       VALUES ($1, $2, $3, $4, '[]'::jsonb)`,
      [boardId, column.name, index, column.color]
    );
  }
};

const seedGuidedColumns = async (board: BoardRow, viewer: BoardViewer) => {
  if (board.column_field === "status") {
    for (const [index, status] of STATUS_ORDER.entries()) {
      await pool.query(
        `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
         VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6::jsonb)`,
        [
          board.id,
          status.replace(/_/g, " "),
          index,
          ["#2563eb", "#8b5cf6", "#f59e0b", "#059669", "#64748b"][index] || "#64748b",
          status,
          JSON.stringify({ field: "status", value: status }),
        ]
      );
    }
    return;
  }

  if (board.column_field === "priority") {
    for (const [index, priority] of PRIORITY_ORDER.entries()) {
      await pool.query(
        `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
         VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6::jsonb)`,
        [
          board.id,
          priority,
          index,
          ["#dc2626", "#f59e0b", "#2563eb"][index] || "#64748b",
          priority,
          JSON.stringify({ field: "priority", value: priority }),
        ]
      );
    }
    return;
  }

  if (board.column_field === "assigned_team") {
    await pool.query(
      `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
       VALUES ($1, 'Unassigned', 0, '#94a3b8', NULL, '[]'::jsonb, $2::jsonb)`,
      [board.id, JSON.stringify({ field: "assigned_team", value: null })]
    );

    const teams = await pool.query<{ id: string; name: string }>(
      `SELECT id, name
       FROM teams
       WHERE organization_id IS NOT DISTINCT FROM $1
       ORDER BY lower(name) ASC`,
      [viewer.organizationId ?? null]
    );
    for (const [index, team] of teams.rows.entries()) {
      await pool.query(
        `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
         VALUES ($1, $2, $3, '#2563eb', $4, '[]'::jsonb, $5::jsonb)`,
        [board.id, team.name, index + 1, team.id, JSON.stringify({ field: "assigned_team", value: team.id })]
      );
    }
    return;
  }

  if (board.column_field === "assigned_agent") {
    await pool.query(
      `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
       VALUES ($1, 'Unassigned', 0, '#94a3b8', NULL, '[]'::jsonb, $2::jsonb)`,
      [board.id, JSON.stringify({ field: "assigned_agent", value: null })]
    );

    const agents = await pool.query<{ id: string; name: string }>(
      `SELECT id, name
       FROM users
       WHERE organization_id IS NOT DISTINCT FROM $1
         AND role IN ('AGENT', 'ADMIN')
       ORDER BY lower(name) ASC`,
      [viewer.organizationId ?? null]
    );
    for (const [index, agent] of agents.rows.entries()) {
      await pool.query(
        `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
         VALUES ($1, $2, $3, '#7c3aed', $4, '[]'::jsonb, $5::jsonb)`,
        [board.id, agent.name, index + 1, agent.id, JSON.stringify({ field: "assigned_agent", value: agent.id })]
      );
    }
    return;
  }
};

const seedFlexibleColumns = async (board: BoardRow) => {
  const definitions = [
    {
      name: "Open",
      color: "#2563eb",
      filters: [{ field: "status", operator: "eq", value: "OPEN" }] as TicketListFilter[],
      dropUpdate: { field: "status", value: "OPEN" } as BoardDropUpdateRule,
    },
    {
      name: "In Progress",
      color: "#7c3aed",
      filters: [{ field: "status", operator: "eq", value: "IN_PROGRESS" }] as TicketListFilter[],
      dropUpdate: { field: "status", value: "IN_PROGRESS" } as BoardDropUpdateRule,
    },
    {
      name: "Waiting",
      color: "#f59e0b",
      filters: [{ field: "status", operator: "eq", value: "WAITING_FOR_CUSTOMER" }] as TicketListFilter[],
      dropUpdate: { field: "status", value: "WAITING_FOR_CUSTOMER" } as BoardDropUpdateRule,
    },
    {
      name: "Resolved",
      color: "#059669",
      filters: [{ field: "status", operator: "eq", value: "RESOLVED" }] as TicketListFilter[],
      dropUpdate: { field: "status", value: "RESOLVED" } as BoardDropUpdateRule,
    },
  ];

  for (const [index, definition] of definitions.entries()) {
    await pool.query(
      `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
       VALUES ($1, $2, $3, $4, NULL, $5::jsonb, $6::jsonb)`,
      [board.id, definition.name, index, definition.color, JSON.stringify(definition.filters), JSON.stringify(definition.dropUpdate)]
    );
  }
};

const resolveSavedViewFilters = async (viewer: BoardViewer, savedViewId?: string | null) => {
  if (!savedViewId) return [] as TicketListFilter[];
  const res = await pool.query<{ filters: TicketListFilter[] }>(
    `SELECT filters
     FROM ticket_saved_views
     WHERE id = $1
       AND entity_type = 'ticket'
       AND organization_id IS NOT DISTINCT FROM $2
       AND (
         owner_user_id = $3
         OR scope = 'TEAM'
       )
     LIMIT 1`,
    [savedViewId, viewer.organizationId ?? null, viewer.userId]
  );
  return parseJsonArray<TicketListFilter>(res.rows[0]?.filters, []);
};

export const listBoards = async (viewer: BoardViewer) => {
  const params: any[] = [];
  const accessSql = boardAccessWhere(viewer, params);
  const res = await pool.query(
    `SELECT
       b.*,
       owner.name AS owner_name,
       tm.name AS team_name,
       (SELECT COUNT(*)::int FROM task_board_columns c WHERE c.board_id = b.id AND c.archived = false) AS column_count,
       (SELECT COUNT(*)::int FROM task_board_cards c WHERE c.board_id = b.id) AS freeform_card_count
     FROM task_boards b
     JOIN users owner ON owner.id = b.owner_user_id
     LEFT JOIN teams tm ON tm.id = b.team_id
     WHERE ${accessSql}
     ORDER BY b.updated_at DESC, lower(b.name) ASC`,
    params
  );
  return res.rows.map((row) => ({
    ...mapBoard(row),
    column_count: Number(row.column_count || 0),
    freeform_card_count: Number(row.freeform_card_count || 0),
    is_owner: row.owner_user_id === viewer.userId,
  }));
};

export const createBoard = async (
  viewer: BoardViewer,
  input: {
    name: string;
    description?: string | null;
    kind: BoardKind;
    mode?: BoardMode | null;
    visibility?: BoardVisibility;
    team_id?: string | null;
    saved_view_id?: string | null;
    base_filters?: TicketListFilter[];
    column_field?: "status" | "priority" | "assigned_team" | "assigned_agent" | null;
    swimlane_mode?: BoardSwimlaneMode;
    swimlane_field?: "assigned_team" | "assigned_agent" | "priority" | "requester_department" | null;
    preset_key?: "OPS_QUEUE_STATUS" | "HIGH_PRIORITY_ESCALATIONS" | "AGENT_WORK_QUEUE" | "PERSONAL_FREEFORM" | null;
  }
) => {
  const visibility = input.visibility === "SHARED" ? "SHARED" : "PERSONAL";
  if (visibility === "SHARED" && !["ADMIN", "MANAGER"].includes(viewer.role)) {
    const err = new Error("Only admin and manager users can create shared boards");
    (err as any).statusCode = 403;
    throw err;
  }

  const baseFilters = normalizeBoardFilters([
    ...(await resolveSavedViewFilters(viewer, input.saved_view_id ?? null)),
    ...(input.base_filters || []),
  ]);

  if (input.preset_key === "HIGH_PRIORITY_ESCALATIONS") {
    baseFilters.push({ field: "priority", operator: "eq", value: "HIGH" });
  }

  const boardKind = input.preset_key === "PERSONAL_FREEFORM" ? "FREEFORM" : input.kind;
  const boardMode =
    input.preset_key === "OPS_QUEUE_STATUS"
      ? "GUIDED"
      : input.preset_key === "HIGH_PRIORITY_ESCALATIONS"
        ? "FLEXIBLE"
        : input.preset_key === "AGENT_WORK_QUEUE"
          ? "GUIDED"
          : input.mode ?? null;
  const columnField =
    input.preset_key === "OPS_QUEUE_STATUS"
      ? "status"
      : input.preset_key === "AGENT_WORK_QUEUE"
        ? "assigned_agent"
        : input.column_field ?? null;
  const swimlaneMode =
    boardKind === "FREEFORM"
      ? input.swimlane_mode ?? "NONE"
      : input.swimlane_mode ?? "NONE";
  const swimlaneField = boardKind === "DATA_DRIVEN" ? input.swimlane_field ?? null : null;

  const result = await pool.query(
    `INSERT INTO task_boards
      (organization_id, owner_user_id, team_id, name, description, kind, mode, visibility, source_entity, base_filters, column_field, swimlane_mode, swimlane_field)
     VALUES
      ($1, $2, $3, $4, $5, $6::task_board_kind, $7::task_board_mode, $8::task_board_visibility, $9::task_board_source_entity, $10::jsonb, $11, $12::task_board_swimlane_mode, $13)
     RETURNING *`,
    [
      viewer.organizationId ?? null,
      viewer.userId,
      visibility === "SHARED" ? input.team_id ?? viewer.teamId ?? null : null,
      input.name.trim(),
      input.description ?? null,
      boardKind,
      boardMode,
      visibility,
      boardKind === "DATA_DRIVEN" ? "TICKET" : null,
      JSON.stringify(baseFilters),
      columnField,
      swimlaneMode,
      swimlaneField,
    ]
  );
  const board = mapBoard(result.rows[0]);
  await ensureBoardOwnerMember(board.id, viewer.userId);

  if (board.kind === "FREEFORM") {
    await seedFreeformColumns(board.id);
  } else if (board.mode === "GUIDED") {
    await seedGuidedColumns(board, viewer);
  } else {
    await seedFlexibleColumns(board);
  }

  await recordBoardEvent({
    boardId: board.id,
    actorUserId: viewer.userId,
    eventType: "BOARD_CREATED",
    payload: { name: board.name, kind: board.kind, mode: board.mode },
  });
  broadcastBoardUpdated(board.id, "created");
  return (await getBoard(viewer, board.id));
};

export const getBoard = async (viewer: BoardViewer, boardId: string) => {
  const { board, canEdit, canManage } = await getBoardAndAccess(viewer, boardId);
  return { ...board, can_edit: canEdit, can_manage: canManage };
};

export const updateBoard = async (
  viewer: BoardViewer,
  boardId: string,
  input: Partial<{
    name: string;
    description: string | null;
    visibility: BoardVisibility;
    team_id: string | null;
    swimlane_mode: BoardSwimlaneMode;
    swimlane_field: string | null;
    column_field: string | null;
  }>
) => {
  const { board, canManage } = await getBoardAndAccess(viewer, boardId);
  if (!canManage) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }

  const res = await pool.query(
    `UPDATE task_boards
     SET name = $2,
         description = $3,
         visibility = $4::task_board_visibility,
         team_id = $5,
         swimlane_mode = $6::task_board_swimlane_mode,
         swimlane_field = $7,
         column_field = $8,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      boardId,
      input.name?.trim() || board.name,
      input.description ?? board.description,
      input.visibility ?? board.visibility,
      input.team_id ?? board.team_id,
      input.swimlane_mode ?? board.swimlane_mode,
      input.swimlane_field ?? board.swimlane_field,
      input.column_field ?? board.column_field,
    ]
  );
  await recordBoardEvent({
    boardId,
    actorUserId: viewer.userId,
    eventType: "BOARD_UPDATED",
    payload: { changed: Object.keys(input) },
  });
  broadcastBoardUpdated(boardId, "board-updated");
  return { ...(mapBoard(res.rows[0])), can_edit: true, can_manage: true };
};

export const deleteBoard = async (viewer: BoardViewer, boardId: string) => {
  const { canManage } = await getBoardAndAccess(viewer, boardId);
  if (!canManage) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  const res = await pool.query(`DELETE FROM task_boards WHERE id = $1`, [boardId]);
  return (res.rowCount ?? 0) > 0;
};

export const getBoardView = async (viewer: BoardViewer, boardId: string): Promise<BoardViewResponse> => {
  const { board, canEdit, canManage } = await getBoardAndAccess(viewer, boardId);
  const [columns, manualSwimlanes, members] = await Promise.all([
    getBoardColumns(boardId),
    getBoardSwimlanes(boardId),
    getBoardMembersInternal(boardId),
  ]);

  if (board.kind === "FREEFORM") {
    const cardRes = await pool.query(
      `SELECT c.*, assignee.name AS assignee_name
       FROM task_board_cards c
       LEFT JOIN users assignee ON assignee.id = c.assignee_user_id
       WHERE c.board_id = $1
       ORDER BY c.position ASC, c.updated_at DESC`,
      [boardId]
    );
    const commentCounts = await pool.query<{ card_id: string; count: number }>(
      `SELECT card_id, COUNT(*)::int AS count
       FROM task_board_card_comments
       WHERE card_id = ANY($1::uuid[])
       GROUP BY card_id`,
      [cardRes.rows.map((row) => row.id)]
    );
    const attachmentCounts = await pool.query<{ card_id: string; count: number }>(
      `SELECT card_id, COUNT(*)::int AS count
       FROM task_board_card_attachments
       WHERE card_id = ANY($1::uuid[])
       GROUP BY card_id`,
      [cardRes.rows.map((row) => row.id)]
    );
    const commentCountMap = new Map(commentCounts.rows.map((row) => [row.card_id, Number(row.count || 0)]));
    const attachmentCountMap = new Map(attachmentCounts.rows.map((row) => [row.card_id, Number(row.count || 0)]));

    const swimlanes =
      board.swimlane_mode === "MANUAL" && manualSwimlanes.length
        ? manualSwimlanes.map((lane) => ({
            id: lane.id,
            key: lane.id,
            name: lane.name,
            position: lane.position,
            color: lane.color,
          }))
        : [{ id: SYNTHETIC_DEFAULT_LANE, key: SYNTHETIC_DEFAULT_LANE, name: "Board", position: 0 }];

    const cards = cardRes.rows.map((row) => {
      const card = mapBoardCard(row);
      return {
        id: card.id,
        board_card_id: card.id,
        kind: "FREEFORM" as const,
        title: card.title,
        description: card.description,
        priority: card.priority,
        due_date: card.due_date,
        tags: card.tags,
        checklist_summary: card.checklist_summary,
        column_id: card.column_id,
        swimlane_key: card.swimlane_id || SYNTHETIC_DEFAULT_LANE,
        updated_at: card.updated_at,
        comment_count: commentCountMap.get(card.id) || 0,
        attachment_count: attachmentCountMap.get(card.id) || 0,
      };
    });

    return {
      board: { ...board, can_edit: canEdit, can_manage: canManage },
      columns,
      swimlanes,
      cards,
      members,
    };
  }

  const tickets = await fetchAllBoardTickets(viewer, board);
  const positionRes = await pool.query(
    `SELECT *
     FROM task_board_record_positions
     WHERE board_id = $1`,
    [boardId]
  );
  const positionMap = new Map<string, any>(positionRes.rows.map((row) => [row.ticket_id, row]));
  const commentCountRes = await pool.query<{ ticket_id: string; count: number }>(
    `SELECT ticket_id, COUNT(*)::int AS count
     FROM ticket_comments
     WHERE ticket_id = ANY($1::uuid[])
     GROUP BY ticket_id`,
    [tickets.map((ticket) => ticket.id)]
  );
  const attachmentCountRes = await pool.query<{ ticket_id: string; count: number }>(
    `SELECT ticket_id, COUNT(*)::int AS count
     FROM ticket_attachments
     WHERE ticket_id = ANY($1::uuid[])
     GROUP BY ticket_id`,
    [tickets.map((ticket) => ticket.id)]
  );
  const commentCountMap = new Map(commentCountRes.rows.map((row) => [row.ticket_id, Number(row.count || 0)]));
  const attachmentCountMap = new Map(attachmentCountRes.rows.map((row) => [row.ticket_id, Number(row.count || 0)]));

  const dynamicSwimlaneMap = new Map<string, { id: string; key: string | null; name: string; position: number }>();
  const cards: BoardCardView[] = [];

  for (const ticket of tickets) {
    const column = getTicketColumnForBoard(board, columns, ticket);
    if (!column) continue;
    const swimlane = resolveSwimlaneForTicket(board, ticket, manualSwimlanes);
    const persisted = positionMap.get(ticket.id);
    if (!dynamicSwimlaneMap.has(String(swimlane.key || SYNTHETIC_DEFAULT_LANE))) {
      dynamicSwimlaneMap.set(String(swimlane.key || SYNTHETIC_DEFAULT_LANE), {
        id: String(swimlane.key || SYNTHETIC_DEFAULT_LANE),
        key: swimlane.key || SYNTHETIC_DEFAULT_LANE,
        name: swimlane.label,
        position: dynamicSwimlaneMap.size,
      });
    }

    cards.push({
      id: ticket.id,
      kind: "TICKET",
      title: ticket.title,
      description: ticket.description,
      display_number: ticket.display_number,
      type: ticket.type,
      status: ticket.status,
      priority: ticket.priority,
      assigned_team: ticket.assigned_team,
      assigned_team_name: ticket.assigned_team_name,
      assigned_agent: ticket.assigned_agent,
      assigned_agent_name: ticket.assigned_agent_name,
      requester_name: ticket.requester_name,
      requester_department: ticket.requester_department,
      tags: Array.isArray(ticket.tag_names) ? ticket.tag_names : [],
      column_id: column.id,
      swimlane_key: swimlane.key || SYNTHETIC_DEFAULT_LANE,
      updated_at: ticket.updated_at,
      comment_count: commentCountMap.get(ticket.id) || 0,
      attachment_count: attachmentCountMap.get(ticket.id) || 0,
      board_card_id: persisted?.id ?? null,
    });
  }

  cards.sort((a, b) => {
    const posA = positionMap.get(a.id)?.position;
    const posB = positionMap.get(b.id)?.position;
    if (a.column_id === b.column_id && a.swimlane_key === b.swimlane_key) {
      if (posA !== undefined && posB !== undefined) return posA - posB;
      if (posA !== undefined) return -1;
      if (posB !== undefined) return 1;
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  const swimlanes =
    board.swimlane_mode === "NONE"
      ? [{ id: SYNTHETIC_DEFAULT_LANE, key: SYNTHETIC_DEFAULT_LANE, name: "Board", position: 0 }]
      : board.swimlane_mode === "MANUAL"
        ? manualSwimlanes.map((lane) => ({
            id: lane.id,
            key: lane.id,
            name: lane.name,
            position: lane.position,
            color: lane.color,
          }))
        : Array.from(dynamicSwimlaneMap.values()).sort((a, b) => a.position - b.position);

  return {
    board: { ...board, can_edit: canEdit, can_manage: canManage },
    columns,
    swimlanes,
    cards,
    members,
  };
};

export const createBoardColumn = async (
  viewer: BoardViewer,
  boardId: string,
  input: {
    name: string;
    color?: string | null;
    mapped_value?: string | null;
    filter_config?: TicketListFilter[];
    drop_update?: BoardDropUpdateRule | null;
    position?: number;
  }
) => {
  const { canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  const positionRes = await pool.query<{ max_position: number | null }>(
    `SELECT MAX(position) AS max_position FROM task_board_columns WHERE board_id = $1`,
    [boardId]
  );
  const nextPosition = input.position ?? Number(positionRes.rows[0]?.max_position ?? -1) + 1;
  const res = await pool.query(
    `INSERT INTO task_board_columns (board_id, name, position, color, mapped_value, filter_config, drop_update)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING *`,
    [
      boardId,
      input.name.trim(),
      nextPosition,
      input.color ?? null,
      input.mapped_value ?? null,
      JSON.stringify(normalizeBoardFilters(input.filter_config || [])),
      input.drop_update ? JSON.stringify(input.drop_update) : null,
    ]
  );
  await touchBoard(boardId);
  await recordBoardEvent({ boardId, actorUserId: viewer.userId, eventType: "COLUMN_CREATED", payload: { name: input.name } });
  broadcastBoardUpdated(boardId, "column-created");
  return mapBoardColumn(res.rows[0]);
};

export const updateBoardColumn = async (
  viewer: BoardViewer,
  boardId: string,
  columnId: string,
  input: Partial<{
    name: string;
    color: string | null;
    archived: boolean;
    mapped_value: string | null;
    filter_config: TicketListFilter[];
    drop_update: BoardDropUpdateRule | null;
    position: number;
  }>
) => {
  const { canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  const existingRes = await pool.query(`SELECT * FROM task_board_columns WHERE id = $1 AND board_id = $2`, [columnId, boardId]);
  const existing = existingRes.rows[0];
  if (!existing) {
    const err = new Error("Column not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const res = await pool.query(
    `UPDATE task_board_columns
     SET name = $3,
         position = $4,
         color = $5,
         archived = $6,
         mapped_value = $7,
         filter_config = $8::jsonb,
         drop_update = $9::jsonb
     WHERE id = $1 AND board_id = $2
     RETURNING *`,
    [
      columnId,
      boardId,
      input.name?.trim() || existing.name,
      input.position ?? existing.position,
      input.color ?? existing.color,
      input.archived ?? existing.archived,
      input.mapped_value ?? existing.mapped_value,
      JSON.stringify(normalizeBoardFilters(input.filter_config ?? existing.filter_config ?? [])),
      input.drop_update === undefined ? JSON.stringify(existing.drop_update) : input.drop_update ? JSON.stringify(input.drop_update) : null,
    ]
  );
  await touchBoard(boardId);
  broadcastBoardUpdated(boardId, "column-updated", { columnId });
  return mapBoardColumn(res.rows[0]);
};

export const deleteBoardColumn = async (viewer: BoardViewer, boardId: string, columnId: string) => {
  const { canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  const res = await pool.query(`DELETE FROM task_board_columns WHERE id = $1 AND board_id = $2`, [columnId, boardId]);
  await touchBoard(boardId);
  broadcastBoardUpdated(boardId, "column-deleted", { columnId });
  return (res.rowCount ?? 0) > 0;
};

export const createBoardSwimlane = async (
  viewer: BoardViewer,
  boardId: string,
  input: { name: string; mapped_value?: string | null; color?: string | null; position?: number }
) => {
  const { board, canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  if (board.swimlane_mode === "NONE") {
    const err = new Error("Enable swimlanes on the board before adding lanes");
    (err as any).statusCode = 400;
    throw err;
  }
  const positionRes = await pool.query<{ max_position: number | null }>(
    `SELECT MAX(position) AS max_position FROM task_board_swimlanes WHERE board_id = $1`,
    [boardId]
  );
  const nextPosition = input.position ?? Number(positionRes.rows[0]?.max_position ?? -1) + 1;
  const res = await pool.query(
    `INSERT INTO task_board_swimlanes (board_id, name, position, mapped_value, color)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [boardId, input.name.trim(), nextPosition, input.mapped_value ?? null, input.color ?? null]
  );
  await touchBoard(boardId);
  broadcastBoardUpdated(boardId, "swimlane-created");
  return res.rows[0] as BoardSwimlaneRow;
};

export const updateBoardSwimlane = async (
  viewer: BoardViewer,
  boardId: string,
  swimlaneId: string,
  input: Partial<{ name: string; mapped_value: string | null; color: string | null; position: number }>
) => {
  const { canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  const existingRes = await pool.query(`SELECT * FROM task_board_swimlanes WHERE id = $1 AND board_id = $2`, [swimlaneId, boardId]);
  const existing = existingRes.rows[0];
  if (!existing) {
    const err = new Error("Swimlane not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const res = await pool.query(
    `UPDATE task_board_swimlanes
     SET name = $3,
         mapped_value = $4,
         color = $5,
         position = $6
     WHERE id = $1 AND board_id = $2
     RETURNING *`,
    [
      swimlaneId,
      boardId,
      input.name?.trim() || existing.name,
      input.mapped_value ?? existing.mapped_value,
      input.color ?? existing.color,
      input.position ?? existing.position,
    ]
  );
  await touchBoard(boardId);
  broadcastBoardUpdated(boardId, "swimlane-updated");
  return res.rows[0] as BoardSwimlaneRow;
};

export const deleteBoardSwimlane = async (viewer: BoardViewer, boardId: string, swimlaneId: string) => {
  const { canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  const res = await pool.query(`DELETE FROM task_board_swimlanes WHERE id = $1 AND board_id = $2`, [swimlaneId, boardId]);
  await touchBoard(boardId);
  broadcastBoardUpdated(boardId, "swimlane-deleted");
  return (res.rowCount ?? 0) > 0;
};

export const createBoardCard = async (
  viewer: BoardViewer,
  boardId: string,
  input: {
    title: string;
    description?: string | null;
    priority?: TicketPriority;
    assignee_user_id?: string | null;
    due_date?: string | null;
    tags?: string[];
    checklist_summary?: { total: number; completed: number };
    column_id?: string | null;
    swimlane_id?: string | null;
  }
) => {
  const { board, canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  if (board.kind !== "FREEFORM") {
    const err = new Error("Manual cards are only supported on freeform boards");
    (err as any).statusCode = 400;
    throw err;
  }
  const positionRes = await pool.query<{ max_position: number | null }>(
    `SELECT MAX(position) AS max_position
     FROM task_board_cards
     WHERE board_id = $1
       AND column_id IS NOT DISTINCT FROM $2
       AND swimlane_id IS NOT DISTINCT FROM $3`,
    [boardId, input.column_id ?? null, input.swimlane_id ?? null]
  );
  const nextPosition = Number(positionRes.rows[0]?.max_position ?? -1) + 1;
  const res = await pool.query(
    `INSERT INTO task_board_cards
      (board_id, column_id, swimlane_id, title, description, priority, assignee_user_id, due_date, tags, checklist_summary, position, created_by)
     VALUES
      ($1, $2, $3, $4, $5, $6::ticket_priority, $7, $8, $9::text[], $10::jsonb, $11, $12)
     RETURNING *`,
    [
      boardId,
      input.column_id ?? null,
      input.swimlane_id ?? null,
      input.title.trim(),
      input.description ?? null,
      input.priority ?? "MEDIUM",
      input.assignee_user_id ?? null,
      input.due_date ?? null,
      normalizeTextArray(input.tags),
      JSON.stringify(input.checklist_summary || { total: 0, completed: 0 }),
      nextPosition,
      viewer.userId,
    ]
  );
  await touchBoard(boardId);
  await recordBoardEvent({
    boardId,
    cardId: res.rows[0].id,
    actorUserId: viewer.userId,
    eventType: "CARD_CREATED",
    payload: { title: input.title.trim() },
  });
  broadcastBoardEvent(boardId, "board:card-created", { cardId: res.rows[0].id });
  return mapBoardCard(res.rows[0]);
};

export const updateBoardCard = async (
  viewer: BoardViewer,
  boardId: string,
  cardId: string,
  input: Partial<{
    title: string;
    description: string | null;
    priority: TicketPriority;
    assignee_user_id: string | null;
    due_date: string | null;
    tags: string[];
    checklist_summary: { total: number; completed: number };
  }>
) => {
  const { board, canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  if (board.kind !== "FREEFORM") {
    const err = new Error("Only freeform cards can be edited directly");
    (err as any).statusCode = 400;
    throw err;
  }
  const existingRes = await pool.query(`SELECT * FROM task_board_cards WHERE id = $1 AND board_id = $2`, [cardId, boardId]);
  const existing = existingRes.rows[0];
  if (!existing) {
    const err = new Error("Card not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const res = await pool.query(
    `UPDATE task_board_cards
     SET title = $3,
         description = $4,
         priority = $5::ticket_priority,
         assignee_user_id = $6,
         due_date = $7,
         tags = $8::text[],
         checklist_summary = $9::jsonb,
         updated_at = now()
     WHERE id = $1 AND board_id = $2
     RETURNING *`,
    [
      cardId,
      boardId,
      input.title?.trim() || existing.title,
      input.description ?? existing.description,
      input.priority ?? existing.priority,
      input.assignee_user_id ?? existing.assignee_user_id,
      input.due_date ?? existing.due_date,
      normalizeTextArray(input.tags ?? existing.tags),
      JSON.stringify(input.checklist_summary ?? existing.checklist_summary ?? { total: 0, completed: 0 }),
    ]
  );
  await touchBoard(boardId);
  await recordBoardEvent({
    boardId,
    cardId,
    actorUserId: viewer.userId,
    eventType: "CARD_UPDATED",
    payload: { changed: Object.keys(input) },
  });
  broadcastBoardEvent(boardId, "board:card-updated", { cardId });
  return mapBoardCard(res.rows[0]);
};

export const deleteBoardCard = async (viewer: BoardViewer, boardId: string, cardId: string) => {
  const { board, canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  if (board.kind !== "FREEFORM") {
    const err = new Error("Only freeform cards can be deleted");
    (err as any).statusCode = 400;
    throw err;
  }
  const res = await pool.query(`DELETE FROM task_board_cards WHERE id = $1 AND board_id = $2`, [cardId, boardId]);
  await touchBoard(boardId);
  await recordBoardEvent({
    boardId,
    actorUserId: viewer.userId,
    eventType: "CARD_DELETED",
    payload: { cardId },
  });
  broadcastBoardEvent(boardId, "board:card-deleted", { cardId });
  return (res.rowCount ?? 0) > 0;
};

const applyTicketMoveUpdate = async (viewer: BoardViewer, ticketId: string, rule: BoardDropUpdateRule) => {
  if (rule.field === "status") {
    await updateTicketStatus({
      ticketId,
      newStatus: String(rule.value) as TicketStatus,
      performedBy: viewer.userId,
      skipResolutionValidation: String(rule.value) === "RESOLVED",
    });
    return;
  }

  await inlineUpdateTicketField({
    ...viewer,
    ticketId,
    field: rule.field,
    value: rule.value,
  });
};

export const moveBoardCard = async (
  viewer: BoardViewer,
  boardId: string,
  cardId: string,
  input: {
    destination_column_id: string;
    destination_swimlane_key?: string | null;
    ordered_card_ids?: string[];
  }
) => {
  const { board, canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }

  const columns = await getBoardColumns(boardId);
  const destinationColumn = columns.find((column) => column.id === input.destination_column_id && !column.archived);
  if (!destinationColumn) {
    const err = new Error("Destination column not found");
    (err as any).statusCode = 404;
    throw err;
  }

  if (board.kind === "FREEFORM") {
    const swimlaneId =
      board.swimlane_mode === "MANUAL" && input.destination_swimlane_key && input.destination_swimlane_key !== SYNTHETIC_DEFAULT_LANE
        ? input.destination_swimlane_key
        : null;
    await pool.query(
      `UPDATE task_board_cards
       SET column_id = $3,
           swimlane_id = $4,
           position = $5,
           updated_at = now()
       WHERE id = $1 AND board_id = $2`,
      [cardId, boardId, destinationColumn.id, swimlaneId, 0]
    );
    if (input.ordered_card_ids?.length) {
      for (const [index, orderedId] of input.ordered_card_ids.entries()) {
        await pool.query(
          `UPDATE task_board_cards
           SET position = $4, column_id = $3, swimlane_id = $5, updated_at = now()
           WHERE id = $1 AND board_id = $2`,
          [orderedId, boardId, destinationColumn.id, index, swimlaneId]
        );
      }
    }
    await touchBoard(boardId);
    await recordBoardEvent({
      boardId,
      cardId,
      actorUserId: viewer.userId,
      eventType: "CARD_MOVED",
      payload: { destination_column_id: destinationColumn.id, destination_swimlane_key: swimlaneId },
    });
    broadcastBoardEvent(boardId, "board:card-moved", {
      cardId,
      destination_column_id: destinationColumn.id,
      destination_swimlane_key: swimlaneId,
    });
    return { ok: true };
  }

  const rules: BoardDropUpdateRule[] = [];
  if (board.mode === "GUIDED") {
    if (board.column_field) {
      rules.push({
        field: board.column_field as BoardDropUpdateRule["field"],
        value: destinationColumn.mapped_value,
      });
    }
  } else if (destinationColumn.drop_update) {
    rules.push(destinationColumn.drop_update);
  } else {
    const err = new Error("This column does not support drag updates");
    (err as any).statusCode = 400;
    throw err;
  }

  if (board.swimlane_mode === "FIELD" && board.swimlane_field && input.destination_swimlane_key) {
    if (["assigned_team", "assigned_agent", "priority"].includes(board.swimlane_field)) {
      const fieldRule: BoardDropUpdateRule = {
        field: board.swimlane_field as BoardDropUpdateRule["field"],
        value: input.destination_swimlane_key === SYNTHETIC_UNASSIGNED ? null : input.destination_swimlane_key,
      };
      if (!rules.some((rule) => rule.field === fieldRule.field)) {
        rules.push(fieldRule);
      }
    } else if (board.swimlane_field === "requester_department") {
      const err = new Error("Requester department swimlanes are read-only");
      (err as any).statusCode = 400;
      throw err;
    }
  }

  for (const rule of rules) {
    await applyTicketMoveUpdate(viewer, cardId, rule);
  }

  if (input.ordered_card_ids?.length) {
    for (const [index, orderedId] of input.ordered_card_ids.entries()) {
      await pool.query(
        `INSERT INTO task_board_record_positions (board_id, ticket_id, column_id, swimlane_key, position, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (board_id, ticket_id)
         DO UPDATE SET column_id = EXCLUDED.column_id,
                       swimlane_key = EXCLUDED.swimlane_key,
                       position = EXCLUDED.position,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()`,
        [
          boardId,
          orderedId,
          destinationColumn.id,
          input.destination_swimlane_key ?? SYNTHETIC_DEFAULT_LANE,
          index,
          viewer.userId,
        ]
      );
    }
  } else {
    await pool.query(
      `INSERT INTO task_board_record_positions (board_id, ticket_id, column_id, swimlane_key, position, updated_by)
       VALUES ($1, $2, $3, $4, 0, $5)
       ON CONFLICT (board_id, ticket_id)
       DO UPDATE SET column_id = EXCLUDED.column_id,
                     swimlane_key = EXCLUDED.swimlane_key,
                     position = 0,
                     updated_by = EXCLUDED.updated_by,
                     updated_at = now()`,
      [boardId, cardId, destinationColumn.id, input.destination_swimlane_key ?? SYNTHETIC_DEFAULT_LANE, viewer.userId]
    );
  }

  await touchBoard(boardId);
  await recordBoardEvent({
    boardId,
    ticketId: cardId,
    actorUserId: viewer.userId,
    eventType: "TICKET_MOVED",
    payload: { destination_column_id: destinationColumn.id, destination_swimlane_key: input.destination_swimlane_key ?? null },
  });
  broadcastBoardEvent(boardId, "board:card-moved", {
    cardId,
    destination_column_id: destinationColumn.id,
    destination_swimlane_key: input.destination_swimlane_key ?? null,
  });
  return { ok: true };
};

export const getBoardCardActivity = async (viewer: BoardViewer, boardId: string, cardId: string): Promise<BoardCardActivityItem[]> => {
  const { board } = await getBoardAndAccess(viewer, boardId);

  if (board.kind === "FREEFORM") {
    const cardRes = await pool.query(`SELECT id FROM task_board_cards WHERE id = $1 AND board_id = $2`, [cardId, boardId]);
    if (!cardRes.rows[0]) {
      const err = new Error("Card not found");
      (err as any).statusCode = 404;
      throw err;
    }

    const [eventsRes, commentsRes, attachmentsRes] = await Promise.all([
      pool.query(
        `SELECT e.id, e.event_type, e.payload, e.created_at, u.name AS actor_name, e.actor_user_id
         FROM task_board_card_events e
         JOIN users u ON u.id = e.actor_user_id
         WHERE e.board_id = $1 AND e.card_id = $2`,
        [boardId, cardId]
      ),
      pool.query(
        `SELECT c.id, c.body, c.created_at, u.name AS actor_name, c.author_id AS actor_user_id
         FROM task_board_card_comments c
         JOIN users u ON u.id = c.author_id
         WHERE c.card_id = $1`,
        [cardId]
      ),
      pool.query(
        `SELECT a.id, a.filename, a.created_at, u.name AS actor_name, a.created_by AS actor_user_id
         FROM task_board_card_attachments a
         JOIN users u ON u.id = a.created_by
         WHERE a.card_id = $1`,
        [cardId]
      ),
    ]);

    return [
      ...eventsRes.rows.map(
        (row) =>
          ({
            id: row.id,
            type: "EVENT",
            actor_name: row.actor_name,
            actor_id: row.actor_user_id,
            body: row.event_type,
            metadata: row.payload || {},
            created_at: row.created_at,
          } satisfies BoardCardActivityItem)
      ),
      ...commentsRes.rows.map(
        (row) =>
          ({
            id: row.id,
            type: "COMMENT",
            actor_name: row.actor_name,
            actor_id: row.actor_user_id,
            body: row.body,
            metadata: {},
            created_at: row.created_at,
          } satisfies BoardCardActivityItem)
      ),
      ...attachmentsRes.rows.map(
        (row) =>
          ({
            id: row.id,
            type: "ATTACHMENT",
            actor_name: row.actor_name,
            actor_id: row.actor_user_id,
            body: row.filename,
            filename: row.filename,
            attachment_id: row.id,
            metadata: {},
            created_at: row.created_at,
          } satisfies BoardCardActivityItem)
      ),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  const ticket = await getTicketDetailById(cardId);
  if (!ticket || (viewer.organizationId && ticket.organization_id !== viewer.organizationId)) {
    const err = new Error("Card not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const [comments, eventsRes, attachmentsRes] = await Promise.all([
    getTicketComments({ ticketId: cardId, includeInternal: true }),
    pool.query(
      `SELECT e.id, e.action, e.old_value, e.new_value, e.timestamp, u.name AS actor_name, e.performed_by
       FROM ticket_events e
       JOIN users u ON u.id = e.performed_by
       WHERE e.ticket_id = $1`,
      [cardId]
    ),
    pool.query(
      `SELECT a.id, a.filename, a.created_at, u.name AS actor_name, a.created_by
       FROM ticket_attachments a
       JOIN users u ON u.id = a.created_by
       WHERE a.ticket_id = $1`,
      [cardId]
    ),
  ]);

  return [
    ...eventsRes.rows.map(
      (row) =>
        ({
          id: row.id,
          type: "EVENT",
          actor_name: row.actor_name,
          actor_id: row.performed_by,
          body: row.action,
          metadata: { old_value: row.old_value, new_value: row.new_value },
          created_at: row.timestamp,
        } satisfies BoardCardActivityItem)
    ),
    ...comments.map(
      (comment) =>
        ({
          id: comment.id,
          type: comment.visibility === "INTERNAL_NOTE" ? "INTERNAL_NOTE" : "COMMENT",
          actor_name: comment.author_name,
          actor_id: comment.author_id,
          body: comment.body,
          metadata: { visibility: comment.visibility },
          created_at: comment.created_at,
        } satisfies BoardCardActivityItem)
    ),
    ...attachmentsRes.rows.map(
      (row) =>
        ({
          id: row.id,
          type: "ATTACHMENT",
          actor_name: row.actor_name,
          actor_id: row.created_by,
          body: row.filename,
          filename: row.filename,
          attachment_id: row.id,
          metadata: {},
          created_at: row.created_at,
        } satisfies BoardCardActivityItem)
    ),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
};

export const createBoardCardComment = async (
  viewer: BoardViewer,
  boardId: string,
  cardId: string,
  input: { body: string; visibility?: TicketCommentVisibility }
) => {
  const { board, canEdit } = await getBoardAndAccess(viewer, boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }

  if (board.kind === "FREEFORM") {
    const cardRes = await pool.query(`SELECT title FROM task_board_cards WHERE id = $1 AND board_id = $2`, [cardId, boardId]);
    if (!cardRes.rows[0]) {
      const err = new Error("Card not found");
      (err as any).statusCode = 404;
      throw err;
    }
    const res = await pool.query(
      `INSERT INTO task_board_card_comments (card_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [cardId, viewer.userId, input.body.trim()]
    );
    await recordBoardEvent({
      boardId,
      cardId,
      actorUserId: viewer.userId,
      eventType: "COMMENT_ADDED",
      payload: { body: input.body.trim() },
    });
    await touchBoard(boardId);
    broadcastBoardEvent(boardId, "board:comment-added", { cardId });
    return res.rows[0];
  }

  const ticket = await getTicketDetailById(cardId);
  if (!ticket || (viewer.organizationId && ticket.organization_id !== viewer.organizationId)) {
    const err = new Error("Card not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const created = await createTicketComment({
    ticketId: cardId,
    authorId: viewer.userId,
    body: input.body.trim(),
    isInternal: (input.visibility ?? "REQUESTER_COMMENT") === "INTERNAL_NOTE",
    visibility: input.visibility ?? "REQUESTER_COMMENT",
  });
  await recordBoardEvent({
    boardId,
    ticketId: cardId,
    actorUserId: viewer.userId,
    eventType: "TICKET_COMMENT_ADDED",
    payload: { visibility: input.visibility ?? "REQUESTER_COMMENT" },
  });
  await touchBoard(boardId);
  broadcastBoardEvent(boardId, "board:comment-added", { cardId });
  return created;
};

export const addBoardCardAttachment = async (args: {
  viewer: BoardViewer;
  boardId: string;
  cardId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
}) => {
  const { board, canEdit } = await getBoardAndAccess(args.viewer, args.boardId);
  if (!canEdit) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  if (args.sizeBytes > MAX_UPLOAD_BYTES) {
    const err = new Error("Attachment exceeds the 2 MB limit");
    (err as any).statusCode = 400;
    throw err;
  }

  if (board.kind === "FREEFORM") {
    const cardRes = await pool.query(`SELECT id FROM task_board_cards WHERE id = $1 AND board_id = $2`, [args.cardId, args.boardId]);
    if (!cardRes.rows[0]) {
      const err = new Error("Card not found");
      (err as any).statusCode = 404;
      throw err;
    }
    const res = await pool.query(
      `INSERT INTO task_board_card_attachments (card_id, filename, content_type, size_bytes, content, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, content_type, size_bytes, created_at`,
      [args.cardId, args.filename, args.contentType, args.sizeBytes, args.buffer, args.viewer.userId]
    );
    await recordBoardEvent({
      boardId: args.boardId,
      cardId: args.cardId,
      actorUserId: args.viewer.userId,
      eventType: "ATTACHMENT_ADDED",
      payload: { filename: args.filename, attachment_id: res.rows[0].id },
    });
    await touchBoard(args.boardId);
    broadcastBoardEvent(args.boardId, "board:attachment-added", { cardId: args.cardId });
    return res.rows[0];
  }

  const ticket = await getTicketDetailById(args.cardId);
  if (!ticket || (args.viewer.organizationId && ticket.organization_id !== args.viewer.organizationId)) {
    const err = new Error("Card not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const res = await pool.query(
    `INSERT INTO ticket_attachments (ticket_id, filename, content_type, size_bytes, content, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, filename, content_type, size_bytes, created_at`,
    [args.cardId, args.filename, args.contentType, args.sizeBytes, args.buffer, args.viewer.userId]
  );
  await recordBoardEvent({
    boardId: args.boardId,
    ticketId: args.cardId,
    actorUserId: args.viewer.userId,
    eventType: "TICKET_ATTACHMENT_ADDED",
    payload: { filename: args.filename, attachment_id: res.rows[0].id },
  });
  await touchBoard(args.boardId);
  broadcastBoardEvent(args.boardId, "board:attachment-added", { cardId: args.cardId });
  return res.rows[0];
};

export const downloadBoardAttachment = async (viewer: BoardViewer, boardId: string, cardId: string, attachmentId: string) => {
  const { board } = await getBoardAndAccess(viewer, boardId);
  if (board.kind === "FREEFORM") {
    const res = await pool.query(
      `SELECT filename, content_type, content
       FROM task_board_card_attachments
       WHERE id = $1 AND card_id = $2`,
      [attachmentId, cardId]
    );
    return res.rows[0] ?? null;
  }
  const ticket = await getTicketDetailById(cardId);
  if (!ticket || (viewer.organizationId && ticket.organization_id !== viewer.organizationId)) {
    const err = new Error("Attachment not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const res = await pool.query(
    `SELECT filename, content_type, content
     FROM ticket_attachments
     WHERE id = $1 AND ticket_id = $2`,
    [attachmentId, cardId]
  );
  return res.rows[0] ?? null;
};

export const getBoardMembers = async (viewer: BoardViewer, boardId: string) => {
  await getBoardAndAccess(viewer, boardId);
  return getBoardMembersInternal(boardId);
};

export const addBoardMember = async (
  viewer: BoardViewer,
  boardId: string,
  input: { user_id: string; member_role?: BoardMemberRole }
) => {
  const { board, canManage } = await getBoardAndAccess(viewer, boardId);
  if (!canManage) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  const userRes = await pool.query<{ id: string; organization_id: string | null; email: string; name: string }>(
    `SELECT id, organization_id, email, name
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [input.user_id]
  );
  const user = userRes.rows[0];
  if (!user || user.organization_id !== board.organization_id) {
    const err = new Error("User not found");
    (err as any).statusCode = 404;
    throw err;
  }
  const res = await pool.query(
    `INSERT INTO task_board_members (board_id, user_id, member_role, created_by)
     VALUES ($1, $2, $3::task_board_member_role, $4)
     ON CONFLICT (board_id, user_id)
     DO UPDATE SET member_role = EXCLUDED.member_role
     RETURNING *`,
    [boardId, input.user_id, input.member_role ?? "EDITOR", viewer.userId]
  );
  await touchBoard(boardId);
  await insertNotification({
    userId: input.user_id,
    actorUserId: viewer.userId,
    audienceRole: viewer.role,
    type: "TICKET_COMMENTED",
    title: "Added to board",
    body: `You were added to the board "${board.name}".`,
    actionUrl: `/admin/boards/${boardId}`,
    metadata: { boardId },
    dedupeKey: `board-member:${boardId}:${input.user_id}:${input.member_role ?? "EDITOR"}`,
  });
  broadcastBoardUpdated(boardId, "member-added", { userId: input.user_id });
  return res.rows[0];
};

export const removeBoardMember = async (viewer: BoardViewer, boardId: string, userId: string) => {
  const { board, canManage } = await getBoardAndAccess(viewer, boardId);
  if (!canManage && userId !== viewer.userId) {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }
  if (board.owner_user_id === userId) {
    const err = new Error("The owner cannot be removed from the board");
    (err as any).statusCode = 400;
    throw err;
  }
  const res = await pool.query(`DELETE FROM task_board_members WHERE board_id = $1 AND user_id = $2`, [boardId, userId]);
  await touchBoard(boardId);
  broadcastBoardUpdated(boardId, "member-removed", { userId });
  return (res.rowCount ?? 0) > 0;
};
