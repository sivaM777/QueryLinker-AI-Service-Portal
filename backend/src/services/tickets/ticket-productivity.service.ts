import { pool } from "../../config/db.js";
import type { NotificationAudienceRole } from "../notifications/notification.service.js";
import {
  assignTicket,
  createTicket,
  getTicketDetailById,
  updateTicketStatus,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from "./ticket.service.js";
import { setTicketTags, type TicketTagRow } from "./ticket-tags.service.js";

export type TicketCommentVisibility = "INTERNAL_NOTE" | "REQUESTER_COMMENT";

export type TicketListFilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "in"
  | "empty"
  | "not_empty"
  | "gte"
  | "lte";

export type TicketListFilter = {
  field: string;
  operator: TicketListFilterOperator;
  value?: string | string[] | null;
};

export type TicketSavedViewRow = {
  id: string;
  name: string;
  scope: "PERSONAL" | "TEAM";
  team_id: string | null;
  owner_user_id: string;
  columns: string[];
  filters: TicketListFilter[];
  sort_field: string;
  sort_order: "asc" | "desc";
  page_size: number;
  created_at: string;
  updated_at: string;
};

export type TicketTemplateRow = {
  id: string;
  name: string;
  scope: "PERSONAL" | "TEAM";
  team_id: string | null;
  description: string | null;
  title: string | null;
  body: string | null;
  ticket_type: TicketType;
  category: string | null;
  priority: TicketPriority;
  assigned_team: string | null;
  assigned_agent: string | null;
  default_tags: string[];
  created_at: string;
  updated_at: string;
};

type TicketViewer = {
  userId: string;
  role: NotificationAudienceRole;
  organizationId?: string | null;
  teamId?: string | null;
};

type SmartTicketListArgs = TicketViewer & {
  q?: string;
  type?: TicketType[];
  status?: TicketStatus[];
  priority?: TicketPriority[];
  category?: string[];
  assigned_agent?: string[];
  assigned_team?: string[];
  created_from?: string;
  created_to?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit: number;
  offset: number;
  filters?: TicketListFilter[];
  viewId?: string | null;
  fields?: string[];
  groupBy?: string | null;
  chartBy?: string | null;
};

type TicketFieldDescriptor = {
  id: string;
  label: string;
  alias: string;
  filterSql?: string;
  orderSql?: string;
  chartSql?: string;
};

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_VIEW_COLUMNS = [
  "source",
  "type",
  "subject",
  "requester",
  "assigned_team_name",
  "assigned_agent_name",
  "priority",
  "status",
  "updated",
];

const ticketFieldRegistry: Record<string, TicketFieldDescriptor> = {
  source: {
    id: "source",
    label: "Source",
    alias: "source_type",
    filterSql: "filtered.source_type",
    orderSql: "filtered.source_type",
    chartSql: "COALESCE(NULLIF(filtered.source_type, ''), 'Unspecified')",
  },
  type: {
    id: "type",
    label: "Type",
    alias: "type",
    filterSql: "filtered.type",
    orderSql: "filtered.type",
    chartSql: "COALESCE(NULLIF(filtered.type, ''), 'Unspecified')",
  },
  subject: {
    id: "subject",
    label: "Subject",
    alias: "title",
    filterSql: "filtered.title",
    orderSql: "filtered.title",
    chartSql: "COALESCE(NULLIF(filtered.title, ''), 'Untitled')",
  },
  requester: {
    id: "requester",
    label: "Requester",
    alias: "requester_email",
    filterSql: "COALESCE(filtered.requester_name, '') || ' ' || COALESCE(filtered.requester_email, '')",
    orderSql: "filtered.requester_name",
    chartSql: "COALESCE(NULLIF(filtered.requester_name, ''), filtered.requester_email, 'Unknown')",
  },
  requester_department: {
    id: "requester_department",
    label: "Requester Department",
    alias: "requester_department",
    filterSql: "filtered.requester_department",
    orderSql: "filtered.requester_department",
    chartSql: "COALESCE(NULLIF(filtered.requester_department, ''), 'Unspecified')",
  },
  requester_manager: {
    id: "requester_manager",
    label: "Requester Manager",
    alias: "requester_manager_name",
    filterSql: "filtered.requester_manager_name",
    orderSql: "filtered.requester_manager_name",
    chartSql: "COALESCE(NULLIF(filtered.requester_manager_name, ''), 'Unspecified')",
  },
  requester_location: {
    id: "requester_location",
    label: "Requester Location",
    alias: "requester_location",
    filterSql: "filtered.requester_location",
    orderSql: "filtered.requester_location",
    chartSql: "COALESCE(NULLIF(filtered.requester_location, ''), 'Unspecified')",
  },
  assigned_team_name: {
    id: "assigned_team_name",
    label: "Assigned Team",
    alias: "assigned_team_name",
    filterSql: "filtered.assigned_team_name",
    orderSql: "filtered.assigned_team_name",
    chartSql: "COALESCE(NULLIF(filtered.assigned_team_name, ''), 'Unassigned')",
  },
  assigned_agent_name: {
    id: "assigned_agent_name",
    label: "Assigned Agent",
    alias: "assigned_agent_name",
    filterSql: "filtered.assigned_agent_name",
    orderSql: "filtered.assigned_agent_name",
    chartSql: "COALESCE(NULLIF(filtered.assigned_agent_name, ''), 'Unassigned')",
  },
  creator_name: {
    id: "creator_name",
    label: "Creator",
    alias: "creator_name",
    filterSql: "filtered.creator_name",
    orderSql: "filtered.creator_name",
    chartSql: "COALESCE(NULLIF(filtered.creator_name, ''), 'Unknown')",
  },
  priority: {
    id: "priority",
    label: "Priority",
    alias: "priority",
    filterSql: "filtered.priority",
    orderSql: "filtered.priority",
    chartSql: "COALESCE(NULLIF(filtered.priority, ''), 'Unspecified')",
  },
  status: {
    id: "status",
    label: "Status",
    alias: "status",
    filterSql: "filtered.status",
    orderSql: "filtered.status",
    chartSql: "COALESCE(NULLIF(filtered.status, ''), 'Unspecified')",
  },
  updated: {
    id: "updated",
    label: "Updated",
    alias: "updated_at",
    filterSql: "filtered.updated_at",
    orderSql: "filtered.updated_at",
    chartSql: "to_char(filtered.updated_at, 'YYYY-MM-DD')",
  },
  created: {
    id: "created",
    label: "Created",
    alias: "created_at",
    filterSql: "filtered.created_at",
    orderSql: "filtered.created_at",
    chartSql: "to_char(filtered.created_at, 'YYYY-MM-DD')",
  },
  category: {
    id: "category",
    label: "Category",
    alias: "category",
    filterSql: "filtered.category",
    orderSql: "filtered.category",
    chartSql: "COALESCE(NULLIF(filtered.category, ''), 'Uncategorized')",
  },
  tags: {
    id: "tags",
    label: "Tags",
    alias: "tag_names",
    chartSql: "COALESCE((filtered.tag_names)[1], 'Untagged')",
  },
};

const getBaseTicketSelect = () => `
  SELECT
    t.id,
    t.display_number,
    t.title,
    t.description,
    t.type::text AS type,
    t.category,
    t.priority::text AS priority,
    t.status::text AS status,
    t.assigned_team,
    t.assigned_agent,
    t.created_by,
    t.organization_id,
    COALESCE(t.source_type::text, 'WEB') AS source_type,
    t.ai_confidence,
    t.created_at,
    t.updated_at,
    requester.name AS requester_name,
    requester.email AS requester_email,
    requester.department AS requester_department,
    requester.location AS requester_location,
    requester_manager.name AS requester_manager_name,
    tm.name AS assigned_team_name,
    agent.name AS assigned_agent_name,
    agent.email AS assigned_agent_email,
    requester.name AS creator_name,
    COALESCE(tags.tag_names, ARRAY[]::text[]) AS tag_names
  FROM tickets t
  JOIN users requester ON requester.id = t.created_by
  LEFT JOIN users requester_manager ON requester_manager.id = requester.manager_id
  LEFT JOIN teams tm ON tm.id = t.assigned_team
  LEFT JOIN users agent ON agent.id = t.assigned_agent
  LEFT JOIN LATERAL (
    SELECT array_remove(array_agg(tt.name ORDER BY tt.name), NULL) AS tag_names
    FROM ticket_tag_links ttl
    JOIN ticket_tags tt ON tt.id = ttl.tag_id
    WHERE ttl.ticket_id = t.id
  ) tags ON true
`;

const parseStringList = (value?: unknown) => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
};

export const parseTicketListFilters = (value?: unknown): TicketListFilter[] => {
  if (!value) return [];
  try {
    if (typeof value === "string") {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as TicketListFilter[];
      return [];
    }
    if (Array.isArray(value)) {
      const parsed = value.flatMap((entry) => {
        if (typeof entry !== "string") return [];
        const nested = JSON.parse(entry);
        return Array.isArray(nested) ? nested : [nested];
      });
      return parsed as TicketListFilter[];
    }
  } catch {
    return [];
  }
  return [];
};

const normalizeColumns = (value?: unknown): string[] => {
  const columns = parseStringList(value);
  const valid = columns.filter((column) => ticketFieldRegistry[column]);
  return valid.length ? Array.from(new Set(valid)) : DEFAULT_VIEW_COLUMNS;
};

const normalizeSortField = (value?: string | null) => {
  if (!value) return "updated";
  if (ticketFieldRegistry[value]) return value;
  if (value === "updated_at") return "updated";
  if (value === "created_at") return "created";
  if (value === "assigned_team") return "assigned_team_name";
  if (value === "assigned_agent") return "assigned_agent_name";
  return "updated";
};

const normalizeSortOrder = (value?: string | null): "asc" | "desc" =>
  String(value || "desc").toLowerCase() === "asc" ? "asc" : "desc";

const buildFilterCondition = (
  field: TicketFieldDescriptor,
  filter: TicketListFilter,
  params: any[]
): string | null => {
  if (!field.filterSql) return null;

  const pushValue = (value: any) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (field.id === "tags") {
    const values = Array.isArray(filter.value)
      ? filter.value.map((entry) => String(entry).trim()).filter(Boolean)
      : [String(filter.value ?? "").trim()].filter(Boolean);

    if (filter.operator === "empty") return "cardinality(filtered.tag_names) = 0";
    if (filter.operator === "not_empty") return "cardinality(filtered.tag_names) > 0";
    if (!values.length) return null;

    const placeholder = pushValue(values.map((entry) => entry.toLowerCase()));
    if (filter.operator === "neq") {
      return `NOT EXISTS (
        SELECT 1
        FROM unnest(filtered.tag_names) AS tag_name
        WHERE lower(tag_name) = ANY(${placeholder}::text[])
      )`;
    }
    return `EXISTS (
      SELECT 1
      FROM unnest(filtered.tag_names) AS tag_name
      WHERE lower(tag_name) = ANY(${placeholder}::text[])
    )`;
  }

  switch (filter.operator) {
    case "eq": {
      const placeholder = pushValue(filter.value ?? null);
      return `${field.filterSql} IS NOT DISTINCT FROM ${placeholder}`;
    }
    case "neq": {
      const placeholder = pushValue(filter.value ?? null);
      return `${field.filterSql} IS DISTINCT FROM ${placeholder}`;
    }
    case "contains": {
      const placeholder = pushValue(`%${String(filter.value ?? "").trim()}%`);
      return `${field.filterSql} ILIKE ${placeholder}`;
    }
    case "in": {
      const values = Array.isArray(filter.value)
        ? filter.value.map((entry) => String(entry)).filter(Boolean)
        : parseStringList(filter.value);
      if (!values.length) return null;
      const placeholder = pushValue(values);
      return `${field.filterSql} = ANY(${placeholder}::text[])`;
    }
    case "empty":
      return `${field.filterSql} IS NULL OR NULLIF(BTRIM((${field.filterSql})::text), '') IS NULL`;
    case "not_empty":
      return `${field.filterSql} IS NOT NULL AND NULLIF(BTRIM((${field.filterSql})::text), '') IS NOT NULL`;
    case "gte": {
      const placeholder = pushValue(filter.value ?? null);
      return `${field.filterSql} >= ${placeholder}`;
    }
    case "lte": {
      const placeholder = pushValue(filter.value ?? null);
      return `${field.filterSql} <= ${placeholder}`;
    }
    default:
      return null;
  }
};

const buildSmartTicketWhere = async (args: SmartTicketListArgs) => {
  const params: any[] = [];
  const conditions: string[] = [];

  if (args.organizationId) {
    params.push(args.organizationId);
    conditions.push(`t.organization_id = $${params.length}`);
  }

  if (args.role === "EMPLOYEE") {
    params.push(args.userId);
    conditions.push(`t.created_by = $${params.length}`);
  }

  if (args.q) {
    params.push(`%${args.q}%`);
    conditions.push(
      `(
        COALESCE(t.display_number, '') ILIKE $${params.length}
        OR t.id::text ILIKE $${params.length}
        OR t.title ILIKE $${params.length}
        OR requester.email ILIKE $${params.length}
        OR requester.name ILIKE $${params.length}
        OR EXISTS (
          SELECT 1
          FROM ticket_tag_links sq_ttl
          JOIN ticket_tags sq_tt ON sq_tt.id = sq_ttl.tag_id
          WHERE sq_ttl.ticket_id = t.id
            AND sq_tt.name ILIKE $${params.length}
        )
      )`
    );
  }

  if (args.type?.length) {
    params.push(args.type);
    conditions.push(`t.type::text = ANY($${params.length}::text[])`);
  }
  if (args.status?.length) {
    params.push(args.status);
    conditions.push(`t.status::text = ANY($${params.length}::text[])`);
  }
  if (args.priority?.length) {
    params.push(args.priority);
    conditions.push(`t.priority::text = ANY($${params.length}::text[])`);
  }
  if (args.category?.length) {
    params.push(args.category);
    conditions.push(`t.category = ANY($${params.length}::text[])`);
  }
  if (args.assigned_agent?.length) {
    params.push(args.assigned_agent);
    conditions.push(`t.assigned_agent::text = ANY($${params.length}::text[])`);
  }
  if (args.assigned_team?.length) {
    params.push(args.assigned_team);
    conditions.push(`t.assigned_team::text = ANY($${params.length}::text[])`);
  }
  if (args.created_from) {
    params.push(args.created_from);
    conditions.push(`t.created_at >= $${params.length}`);
  }
  if (args.created_to) {
    params.push(args.created_to);
    conditions.push(`t.created_at <= $${params.length}`);
  }

  return { params, conditions };
};

const resolveSavedView = async (args: TicketViewer & { viewId?: string | null }) => {
  if (!args.viewId) return null;
  const result = await pool.query<TicketSavedViewRow>(
    `SELECT
       id,
       name,
       scope,
       team_id,
       owner_user_id,
       columns,
       filters,
       sort_field,
       sort_order,
       page_size,
       created_at,
       updated_at
     FROM ticket_saved_views
     WHERE id = $1
       AND entity_type = 'ticket'
       AND (
         owner_user_id = $2
         OR (
           scope = 'TEAM'
           AND ($3::uuid IS NULL OR organization_id = $3)
           AND (
             team_id IS NULL
             OR team_id = $4
             OR owner_user_id = $2
           )
         )
       )
     LIMIT 1`,
    [args.viewId, args.userId, args.organizationId ?? null, args.teamId ?? null]
  );
  return result.rows[0] ?? null;
};

const mapViewRow = (row: any): TicketSavedViewRow => ({
  ...row,
  columns: Array.isArray(row.columns) ? row.columns : [],
  filters: Array.isArray(row.filters) ? row.filters : [],
});

const mapTemplateRow = (row: any): TicketTemplateRow => ({
  ...row,
  default_tags: Array.isArray(row.default_tags) ? row.default_tags : [],
});

export const getTicketSavedViews = async (viewer: TicketViewer): Promise<TicketSavedViewRow[]> => {
  const result = await pool.query(
    `SELECT
       id,
       name,
       scope,
       team_id,
       owner_user_id,
       columns,
       filters,
       sort_field,
       sort_order,
       page_size,
       created_at,
       updated_at
     FROM ticket_saved_views
     WHERE entity_type = 'ticket'
       AND (
         owner_user_id = $1
         OR (
           scope = 'TEAM'
           AND ($2::uuid IS NULL OR organization_id = $2)
           AND (
             team_id IS NULL
             OR team_id = $3
             OR $4 = 'ADMIN'
           )
         )
       )
     ORDER BY
       CASE WHEN owner_user_id = $1 THEN 0 ELSE 1 END,
       lower(name) ASC`,
    [viewer.userId, viewer.organizationId ?? null, viewer.teamId ?? null, viewer.role]
  );
  return result.rows.map(mapViewRow);
};

export const createTicketSavedView = async (
  viewer: TicketViewer,
  input: {
    name: string;
    scope?: "PERSONAL" | "TEAM";
    team_id?: string | null;
    columns?: string[];
    filters?: TicketListFilter[];
    sort_field?: string;
    sort_order?: "asc" | "desc";
    page_size?: number;
  }
): Promise<TicketSavedViewRow> => {
  const scope = input.scope === "TEAM" ? "TEAM" : "PERSONAL";
  if (scope === "TEAM" && !["ADMIN", "MANAGER"].includes(viewer.role)) {
    const err = new Error("Only admin or manager users can create shared views");
    (err as any).statusCode = 403;
    throw err;
  }

  const teamId = scope === "TEAM" ? input.team_id ?? viewer.teamId ?? null : null;
  if (scope === "TEAM" && !teamId && viewer.role !== "ADMIN") {
    const err = new Error("A team is required for shared views");
    (err as any).statusCode = 400;
    throw err;
  }

  const result = await pool.query(
    `INSERT INTO ticket_saved_views
      (organization_id, owner_user_id, team_id, entity_type, name, scope, columns, filters, sort_field, sort_order, page_size)
     VALUES
      ($1, $2, $3, 'ticket', $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
     RETURNING id, name, scope, team_id, owner_user_id, columns, filters, sort_field, sort_order, page_size, created_at, updated_at`,
    [
      viewer.organizationId ?? null,
      viewer.userId,
      teamId,
      input.name.trim(),
      scope,
      JSON.stringify(normalizeColumns(input.columns)),
      JSON.stringify(input.filters || []),
      normalizeSortField(input.sort_field),
      normalizeSortOrder(input.sort_order),
      Math.min(Math.max(input.page_size || 50, 10), 200),
    ]
  );
  return mapViewRow(result.rows[0]);
};

export const updateTicketSavedView = async (
  viewer: TicketViewer,
  viewId: string,
  input: {
    name?: string;
    scope?: "PERSONAL" | "TEAM";
    team_id?: string | null;
    columns?: string[];
    filters?: TicketListFilter[];
    sort_field?: string;
    sort_order?: "asc" | "desc";
    page_size?: number;
  }
): Promise<TicketSavedViewRow> => {
  const existing = await resolveSavedView({ ...viewer, viewId });
  if (!existing) {
    const err = new Error("Saved view not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (existing.owner_user_id !== viewer.userId) {
    const err = new Error("You can only update your own saved views");
    (err as any).statusCode = 403;
    throw err;
  }

  const scope = input.scope ?? existing.scope;
  if (scope === "TEAM" && !["ADMIN", "MANAGER"].includes(viewer.role)) {
    const err = new Error("Only admin or manager users can create shared views");
    (err as any).statusCode = 403;
    throw err;
  }

  const teamId = scope === "TEAM" ? input.team_id ?? existing.team_id ?? viewer.teamId ?? null : null;
  const result = await pool.query(
    `UPDATE ticket_saved_views
     SET name = $3,
         scope = $4,
         team_id = $5,
         columns = $6::jsonb,
         filters = $7::jsonb,
         sort_field = $8,
         sort_order = $9,
         page_size = $10,
         updated_at = now()
     WHERE id = $1
       AND owner_user_id = $2
     RETURNING id, name, scope, team_id, owner_user_id, columns, filters, sort_field, sort_order, page_size, created_at, updated_at`,
    [
      viewId,
      viewer.userId,
      input.name?.trim() || existing.name,
      scope,
      teamId,
      JSON.stringify(normalizeColumns(input.columns ?? existing.columns)),
      JSON.stringify(input.filters ?? existing.filters),
      normalizeSortField(input.sort_field ?? existing.sort_field),
      normalizeSortOrder(input.sort_order ?? existing.sort_order),
      Math.min(Math.max(input.page_size ?? existing.page_size, 10), 200),
    ]
  );
  return mapViewRow(result.rows[0]);
};

export const deleteTicketSavedView = async (viewer: TicketViewer, viewId: string) => {
  const result = await pool.query(
    `DELETE FROM ticket_saved_views
     WHERE id = $1
       AND owner_user_id = $2`,
    [viewId, viewer.userId]
  );
  return (result.rowCount ?? 0) > 0;
};

export const getTicketTemplates = async (viewer: TicketViewer): Promise<TicketTemplateRow[]> => {
  const result = await pool.query(
    `SELECT
       id,
       name,
       scope,
       team_id,
       description,
       title,
       body,
       ticket_type::text AS ticket_type,
       category,
       priority::text AS priority,
       assigned_team,
       assigned_agent,
       default_tags,
       created_at,
       updated_at
     FROM ticket_templates
     WHERE owner_user_id = $1
        OR (
          scope = 'TEAM'
          AND ($2::uuid IS NULL OR organization_id = $2)
          AND (
            team_id IS NULL
            OR team_id = $3
            OR $4 = 'ADMIN'
          )
        )
     ORDER BY CASE WHEN owner_user_id = $1 THEN 0 ELSE 1 END, lower(name) ASC`,
    [viewer.userId, viewer.organizationId ?? null, viewer.teamId ?? null, viewer.role]
  );
  return result.rows.map(mapTemplateRow);
};

export const createTicketTemplate = async (
  viewer: TicketViewer,
  input: {
    name: string;
    scope?: "PERSONAL" | "TEAM";
    team_id?: string | null;
    description?: string | null;
    title?: string | null;
    body?: string | null;
    ticket_type?: TicketType;
    category?: string | null;
    priority?: TicketPriority;
    assigned_team?: string | null;
    assigned_agent?: string | null;
    default_tags?: string[];
  }
): Promise<TicketTemplateRow> => {
  const scope = input.scope === "TEAM" ? "TEAM" : "PERSONAL";
  if (scope === "TEAM" && !["ADMIN", "MANAGER"].includes(viewer.role)) {
    const err = new Error("Only admin or manager users can create shared templates");
    (err as any).statusCode = 403;
    throw err;
  }
  const teamId = scope === "TEAM" ? input.team_id ?? viewer.teamId ?? null : null;

  const result = await pool.query(
    `INSERT INTO ticket_templates
      (organization_id, owner_user_id, team_id, name, scope, description, title, body, ticket_type, category, priority, assigned_team, assigned_agent, default_tags)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9::ticket_type, $10, $11::ticket_priority, $12, $13, $14::text[])
     RETURNING id, name, scope, team_id, description, title, body, ticket_type::text AS ticket_type, category, priority::text AS priority, assigned_team, assigned_agent, default_tags, created_at, updated_at`,
    [
      viewer.organizationId ?? null,
      viewer.userId,
      teamId,
      input.name.trim(),
      scope,
      input.description ?? null,
      input.title ?? null,
      input.body ?? null,
      input.ticket_type ?? "INCIDENT",
      input.category ?? null,
      input.priority ?? "MEDIUM",
      input.assigned_team ?? null,
      input.assigned_agent ?? null,
      (input.default_tags || []).map((tag) => tag.trim()).filter(Boolean),
    ]
  );
  return mapTemplateRow(result.rows[0]);
};

export const updateTicketTemplate = async (
  viewer: TicketViewer,
  templateId: string,
  input: Partial<{
    name: string;
    scope: "PERSONAL" | "TEAM";
    team_id: string | null;
    description: string | null;
    title: string | null;
    body: string | null;
    ticket_type: TicketType;
    category: string | null;
    priority: TicketPriority;
    assigned_team: string | null;
    assigned_agent: string | null;
    default_tags: string[];
  }>
): Promise<TicketTemplateRow> => {
  const existingRes = await pool.query(
    `SELECT *
     FROM ticket_templates
     WHERE id = $1
       AND owner_user_id = $2
     LIMIT 1`,
    [templateId, viewer.userId]
  );
  const existing = existingRes.rows[0] ?? null;
  if (!existing) {
    const err = new Error("Template not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const scope = input.scope ?? existing.scope;
  const teamId = scope === "TEAM" ? input.team_id ?? existing.team_id ?? viewer.teamId ?? null : null;
  const result = await pool.query(
    `UPDATE ticket_templates
     SET name = $3,
         scope = $4,
         team_id = $5,
         description = $6,
         title = $7,
         body = $8,
         ticket_type = $9::ticket_type,
         category = $10,
         priority = $11::ticket_priority,
         assigned_team = $12,
         assigned_agent = $13,
         default_tags = $14::text[],
         updated_at = now()
     WHERE id = $1
       AND owner_user_id = $2
     RETURNING id, name, scope, team_id, description, title, body, ticket_type::text AS ticket_type, category, priority::text AS priority, assigned_team, assigned_agent, default_tags, created_at, updated_at`,
    [
      templateId,
      viewer.userId,
      input.name?.trim() || existing.name,
      scope,
      teamId,
      input.description ?? existing.description,
      input.title ?? existing.title,
      input.body ?? existing.body,
      input.ticket_type ?? existing.ticket_type,
      input.category ?? existing.category,
      input.priority ?? existing.priority,
      input.assigned_team ?? existing.assigned_team,
      input.assigned_agent ?? existing.assigned_agent,
      input.default_tags ?? existing.default_tags ?? [],
    ]
  );
  return mapTemplateRow(result.rows[0]);
};

export const deleteTicketTemplate = async (viewer: TicketViewer, templateId: string) => {
  const result = await pool.query(
    `DELETE FROM ticket_templates
     WHERE id = $1
       AND owner_user_id = $2`,
    [templateId, viewer.userId]
  );
  return (result.rowCount ?? 0) > 0;
};

const updateTicketPriority = async (args: {
  ticketId: string;
  priority: TicketPriority;
  performedBy: string;
}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentRes = await client.query<{ priority: TicketPriority }>(
      `SELECT priority FROM tickets WHERE id = $1`,
      [args.ticketId]
    );
    const current = currentRes.rows[0];
    if (!current) {
      const err = new Error("Ticket not found");
      (err as any).statusCode = 404;
      throw err;
    }

    await client.query(
      `UPDATE tickets
       SET priority = $2::ticket_priority, updated_at = now()
       WHERE id = $1`,
      [args.ticketId, args.priority]
    );
    await client.query(
      `INSERT INTO ticket_events (ticket_id, action, old_value, new_value, performed_by)
       VALUES ($1, 'STATUS_CHANGED', $2::jsonb, $3::jsonb, $4)`,
      [
        args.ticketId,
        JSON.stringify({ priority: current.priority }),
        JSON.stringify({ priority: args.priority }),
        args.performedBy,
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const buildSmartTicketListQuery = async (args: SmartTicketListArgs) => {
  const savedView = await resolveSavedView({ ...args, viewId: args.viewId });
  const mergedFilters = [...(savedView?.filters || []), ...(args.filters || [])];
  const sortField = normalizeSortField(args.sort || savedView?.sort_field || "updated");
  const sortOrder = normalizeSortOrder(args.order || savedView?.sort_order || "desc");
  const columns = normalizeColumns(args.fields?.length ? args.fields : savedView?.columns);

  const { params, conditions } = await buildSmartTicketWhere(args);
  const baseQuery = getBaseTicketSelect();
  const baseWhere = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const cte = `WITH filtered AS (${baseQuery} ${baseWhere})`;

  const filterConditions = mergedFilters
    .map((filter) => {
      const descriptor = ticketFieldRegistry[filter.field];
      if (!descriptor) return null;
      return buildFilterCondition(descriptor, filter, params);
    })
    .filter(Boolean);

  const postFilterWhere = filterConditions.length
    ? `WHERE ${filterConditions.join(" AND ")}`
    : "";

  return {
    cte,
    params,
    whereSql: postFilterWhere,
    sortField,
    sortOrder,
    columns,
    mergedFilters,
    savedView,
  };
};

export const querySmartTickets = async (args: SmartTicketListArgs) => {
  const { cte, params, whereSql, sortField, sortOrder, columns, mergedFilters, savedView } = await buildSmartTicketListQuery(
    args
  );
  const sortExpression = ticketFieldRegistry[sortField]?.orderSql || "filtered.updated_at";
  const limit = Math.min(Math.max(args.limit || savedView?.page_size || 50, 1), 200);
  const offset = Math.max(args.offset || 0, 0);

  const listParams = [...params, limit, offset];
  const itemsQuery = `
    ${cte}
    SELECT *
    FROM filtered
    ${whereSql}
    ORDER BY ${sortExpression} ${sortOrder}, filtered.created_at DESC, filtered.id DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const countQuery = `
    ${cte}
    SELECT COUNT(*)::int AS total
    FROM filtered
    ${whereSql}
  `;

  const [itemsRes, countRes] = await Promise.all([
    pool.query(itemsQuery, listParams),
    pool.query<{ total: number }>(countQuery, params),
  ]);

  const response: Record<string, unknown> = {
    items: itemsRes.rows,
    total: Number(countRes.rows[0]?.total || 0),
    selected_fields: columns,
    active_filters: mergedFilters,
    available_fields: Object.values(ticketFieldRegistry).map(({ id, label, alias }) => ({ id, label, alias })),
  };

  const chartField = args.chartBy || args.groupBy || null;
  if (chartField && ticketFieldRegistry[chartField]?.chartSql) {
    const descriptor = ticketFieldRegistry[chartField];
    const chartQuery = `
      ${cte}
      SELECT ${descriptor.chartSql} AS bucket, COUNT(*)::int AS count
      FROM filtered
      ${whereSql}
      GROUP BY bucket
      ORDER BY count DESC, bucket ASC
      LIMIT 25
    `;
    const chartRes = await pool.query<{ bucket: string; count: number }>(chartQuery, params);
    response.chart = {
      field: chartField,
      groups: chartRes.rows.map((row) => ({
        key: row.bucket,
        label: row.bucket,
        count: Number(row.count || 0),
      })),
    };
  }

  return response;
};

export const getSmartTicketById = async (viewer: TicketViewer, ticketId: string) => {
  const { params, conditions } = await buildSmartTicketWhere({
    ...viewer,
    limit: 1,
    offset: 0,
  });
  params.push(ticketId);
  conditions.push(`t.id = $${params.length}`);
  const baseWhere = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `${getBaseTicketSelect()} ${baseWhere} LIMIT 1`,
    params
  );
  return result.rows[0] ?? null;
};

export const inlineUpdateTicketField = async (args: TicketViewer & {
  ticketId: string;
  field: "status" | "priority" | "assigned_team" | "assigned_agent" | "tags";
  value: unknown;
  companionAssignedTeam?: string | null;
  companionAssignedAgent?: string | null;
}) => {
  const ticket = await getTicketDetailById(args.ticketId);
  if (!ticket) {
    const err = new Error("Ticket not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (args.organizationId && ticket.organization_id !== args.organizationId) {
    const err = new Error("Ticket not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (args.role === "EMPLOYEE") {
    const err = new Error("Forbidden");
    (err as any).statusCode = 403;
    throw err;
  }

  switch (args.field) {
    case "status":
      await updateTicketStatus({
        ticketId: args.ticketId,
        newStatus: String(args.value) as TicketStatus,
        performedBy: args.userId,
      });
      break;
    case "priority":
      await updateTicketPriority({
        ticketId: args.ticketId,
        priority: String(args.value) as TicketPriority,
        performedBy: args.userId,
      });
      break;
    case "assigned_team":
    case "assigned_agent":
      await assignTicket({
        ticketId: args.ticketId,
        assignedTeam:
          args.field === "assigned_team"
            ? (String(args.value || "") || null)
            : args.companionAssignedTeam ?? ticket.assigned_team,
        assignedAgent:
          args.field === "assigned_agent"
            ? (String(args.value || "") || null)
            : args.companionAssignedAgent ?? ticket.assigned_agent,
        performedBy: args.userId,
      });
      break;
    case "tags":
      await setTicketTags({
        ticketId: args.ticketId,
        organizationId: args.organizationId ?? null,
        tagNames: Array.isArray(args.value) ? (args.value as string[]) : parseStringList(args.value),
        createdBy: args.userId,
      });
      break;
    default:
      break;
  }

  const updated = await getTicketDetailById(args.ticketId);
  return updated;
};

export const bulkUpdateTickets = async (args: TicketViewer & {
  ticketIds: string[];
  status?: TicketStatus;
  priority?: TicketPriority;
  assigned_team?: string | null;
  assigned_agent?: string | null;
  tags?: string[];
}) => {
  const ids = Array.from(new Set(args.ticketIds || [])).filter(Boolean);
  const updatedIds: string[] = [];

  for (const ticketId of ids) {
    if (args.status) {
      await inlineUpdateTicketField({
        ...args,
        ticketId,
        field: "status",
        value: args.status,
      });
    }
    if (args.priority) {
      await inlineUpdateTicketField({
        ...args,
        ticketId,
        field: "priority",
        value: args.priority,
      });
    }
    if (args.assigned_team !== undefined || args.assigned_agent !== undefined) {
      await assignTicket({
        ticketId,
        assignedTeam: args.assigned_team ?? null,
        assignedAgent: args.assigned_agent ?? null,
        performedBy: args.userId,
      });
    }
    if (args.tags) {
      await setTicketTags({
        ticketId,
        organizationId: args.organizationId ?? null,
        tagNames: args.tags,
        createdBy: args.userId,
      });
    }
    updatedIds.push(ticketId);
  }

  return { updated: updatedIds.length, ids: updatedIds };
};

export const createContextualTicket = async (args: TicketViewer & {
  sourceTicketId: string;
  targetType: "PROBLEM" | "CHANGE";
}) => {
  const source = await getTicketDetailById(args.sourceTicketId);
  if (!source) {
    const err = new Error("Source ticket not found");
    (err as any).statusCode = 404;
    throw err;
  }
  if (args.organizationId && source.organization_id !== args.organizationId) {
    const err = new Error("Source ticket not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const relationshipType = args.targetType === "PROBLEM" ? "CAUSE_OF" : "RESOLVED_BY_CHANGE";
  if (args.targetType === "PROBLEM" && source.type !== "INCIDENT") {
    const err = new Error("Only incidents can generate problem records");
    (err as any).statusCode = 400;
    throw err;
  }
  if (args.targetType === "CHANGE" && source.type !== "PROBLEM") {
    const err = new Error("Only problems can generate change records");
    (err as any).statusCode = 400;
    throw err;
  }

  const titlePrefix = args.targetType === "PROBLEM" ? "Problem Investigation" : "Change Request";
  const created = await createTicket({
    title: `${titlePrefix}: ${source.title}`,
    description: source.description,
    createdBy: args.userId,
    performedBy: args.userId,
    type: args.targetType,
    priority: source.priority as TicketPriority,
    category: source.category ?? null,
    sourceType: "WEB",
    integrationMetadata: {
      created_from_ticket_id: args.sourceTicketId,
      created_from_ticket_type: source.type,
      contextual_action: relationshipType,
    },
  });

  if (source.assigned_team || source.assigned_agent) {
    await assignTicket({
      ticketId: created.id,
      assignedTeam: source.assigned_team,
      assignedAgent: source.assigned_agent,
      performedBy: args.userId,
    });
  }

  await pool.query(
    `INSERT INTO ticket_relationships
      (source_ticket_id, target_ticket_id, relationship_type, notes, created_by)
     VALUES
      ($1, $2, $3::ticket_relationship_type, $4, $5)
     ON CONFLICT (source_ticket_id, target_ticket_id, relationship_type)
     DO NOTHING`,
    [
      args.sourceTicketId,
      created.id,
      relationshipType,
      args.targetType === "PROBLEM"
        ? "Created from incident for root-cause tracking"
        : "Created from problem for controlled remediation",
      args.userId,
    ]
  );

  if (source.tag_names?.length) {
    await setTicketTags({
      ticketId: created.id,
      organizationId: args.organizationId ?? null,
      tagNames: source.tag_names,
      createdBy: args.userId,
    });
  }

  return created;
};

export const getTicketAvailableFields = () =>
  Object.values(ticketFieldRegistry).map(({ id, label, alias }) => ({ id, label, alias }));

export const getTicketProductivityDefaults = () => ({
  defaultColumns: DEFAULT_VIEW_COLUMNS,
  availableFields: getTicketAvailableFields(),
});
