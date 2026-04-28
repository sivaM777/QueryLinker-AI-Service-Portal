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

export type TicketSavedView = {
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

export type TicketTemplate = {
  id: string;
  name: string;
  scope: "PERSONAL" | "TEAM";
  team_id: string | null;
  description: string | null;
  title: string | null;
  body: string | null;
  ticket_type: "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM";
  category: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  assigned_team: string | null;
  assigned_agent: string | null;
  default_tags: string[];
  created_at: string;
  updated_at: string;
};

export type SmartTicketRow = {
  id: string;
  display_number: string | null;
  title: string;
  description: string;
  type: "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM";
  category: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  assigned_team: string | null;
  assigned_agent: string | null;
  created_by: string;
  organization_id?: string | null;
  source_type?: string | null;
  ai_confidence?: number | null;
  created_at: string;
  updated_at: string;
  requester_name?: string | null;
  requester_email?: string | null;
  requester_department?: string | null;
  requester_manager_name?: string | null;
  requester_location?: string | null;
  assigned_team_name?: string | null;
  assigned_agent_name?: string | null;
  assigned_agent_email?: string | null;
  creator_name?: string | null;
  tag_names?: string[];
};

export type SmartTicketChartGroup = {
  key: string;
  label: string;
  count: number;
};

export type SmartTicketResponse = {
  items: SmartTicketRow[];
  total: number;
  selected_fields: string[];
  active_filters: TicketListFilter[];
  available_fields: Array<{
    id: string;
    label: string;
    alias: string;
  }>;
  chart?: {
    field: string;
    groups: SmartTicketChartGroup[];
  };
};

export type TicketWatcher = {
  id: string;
  ticket_id: string;
  user_id: string;
  created_by: string | null;
  created_at: string;
  user_name: string;
  user_email: string;
  user_role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
};

export type SearchResultItem = {
  id: string;
  entity: "ticket" | "kb_article" | "canned_response" | "attachment";
  title: string;
  subtitle: string | null;
  description: string | null;
  url: string | null;
  score: number;
  metadata: Record<string, unknown>;
};

export const DEFAULT_TICKET_COLUMNS = [
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

export const TICKET_FIELD_LABELS: Record<string, string> = {
  source: "Source",
  type: "Type",
  subject: "Subject",
  requester: "Requester",
  requester_department: "Requester Department",
  requester_manager: "Requester Manager",
  requester_location: "Requester Location",
  assigned_team_name: "Assigned Team",
  assigned_agent_name: "Assigned Agent",
  creator_name: "Creator",
  priority: "Priority",
  status: "Status",
  updated: "Updated",
  created: "Created",
  category: "Category",
  tags: "Tags",
};

export const TICKET_CHART_FIELDS = [
  "category",
  "priority",
  "status",
  "assigned_team_name",
  "assigned_agent_name",
  "source",
  "requester_department",
];

export const isEditableTicketField = (field: string) =>
  ["status", "priority", "assigned_team", "assigned_agent", "tags"].includes(field);

export const formatTicketFilterValue = (filter: TicketListFilter) => {
  if (Array.isArray(filter.value)) {
    return filter.value.join(", ");
  }
  if (filter.value === null || filter.value === undefined || filter.value === "") {
    if (filter.operator === "empty") return "empty";
    if (filter.operator === "not_empty") return "not empty";
    return "";
  }
  return String(filter.value);
};
