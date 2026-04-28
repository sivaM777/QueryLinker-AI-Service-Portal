import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  FormControlLabel,
  FormGroup,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  BarChart as BarChartIcon,
  ClearAll as ClearAllIcon,
  DeleteOutline as DeleteIcon,
  Download as DownloadIcon,
  EditOutlined as EditIcon,
  FilterAltOutlined as FilterIcon,
  MoreHoriz as MoreHorizIcon,
  Refresh as RefreshIcon,
  SaveOutlined as SaveIcon,
  Search as SearchIcon,
  Tune as TuneIcon,
  ViewColumnOutlined as ViewColumnIcon,
} from "@mui/icons-material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, getApiErrorMessage } from "../../services/api";
import { useAuth } from "../../services/auth";
import { subscribeToMetrics } from "../../services/socket.service";
import {
  DEFAULT_TICKET_COLUMNS,
  formatTicketFilterValue,
  SmartTicketChartGroup,
  SmartTicketResponse,
  SmartTicketRow,
  TICKET_CHART_FIELDS,
  TICKET_FIELD_LABELS,
  TicketListFilter,
  TicketListFilterOperator,
  TicketSavedView,
} from "../../services/ticketProductivity";

type SmartTicketWorkspaceProps = {
  endpoint: "/tickets" | "/tickets/my";
  title: string;
  subtitle: string;
  detailPath: (ticketId: string) => string;
  createTicketPath?: string;
  createTicketLabel?: string;
  compact?: boolean;
};

type TeamLookup = {
  id: string;
  name: string;
};

type AgentLookup = {
  id: string;
  name: string;
  email: string;
};

type TicketFieldOption = {
  id: string;
  label: string;
  alias: string;
};

type ContextMenuState = {
  anchorEl: HTMLElement | null;
  field: string;
  value: string;
  row: SmartTicketRow | null;
};

type SaveViewDialogState = {
  open: boolean;
  mode: "create" | "update";
  name: string;
  scope: "PERSONAL" | "TEAM";
};

type QuickEditDialogState = {
  open: boolean;
  row: SmartTicketRow | null;
  field: "status" | "priority" | "assigned_team" | "assigned_agent" | "tags";
  value: string;
  tagsText: string;
};

type FilterDialogState = {
  open: boolean;
  field: string;
  operator: TicketListFilterOperator;
  value: string;
};

type ChartDialogState = {
  open: boolean;
  field: string;
  type: "bar" | "pie" | "stacked";
  loading: boolean;
  groups: SmartTicketChartGroup[];
};

type BulkEditState = {
  status: string;
  priority: string;
  assignedTeam: string;
  assignedAgent: string;
  tagsText: string;
};

const FALLBACK_FIELDS: TicketFieldOption[] = Object.entries(TICKET_FIELD_LABELS).map(([id, label]) => ({
  id,
  label,
  alias: id,
}));

const FILTER_OPERATORS: Array<{ value: TicketListFilterOperator; label: string }> = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
  { value: "gte", label: "is after / greater than" },
  { value: "lte", label: "is before / less than" },
];

const CHART_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f97316"];
const statusOptions = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"];
const priorityOptions = ["LOW", "MEDIUM", "HIGH"];
const typeOptions = ["INCIDENT", "SERVICE_REQUEST", "CHANGE", "PROBLEM"];
const TABLE_COLUMN_MIN_WIDTHS: Record<string, number> = {
  number: 140,
  source: 120,
  type: 170,
  subject: 320,
  requester: 260,
  requester_department: 200,
  requester_manager: 220,
  requester_location: 180,
  assigned_team_name: 220,
  assigned_agent_name: 220,
  priority: 160,
  status: 190,
  updated_at: 200,
  created_at: 200,
  tags: 220,
  creator_name: 220,
};

const formatStatusLabel = (value: string) => value.replace(/_/g, " ");
const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : "-");
const isChartableField = (field: string) => TICKET_CHART_FIELDS.includes(field);
const getColumnMinWidth = (field: string) => TABLE_COLUMN_MIN_WIDTHS[field] ?? 180;

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(url);
};

const escapeCsv = (value: unknown) => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
};

const buildCsvFromRows = (rows: SmartTicketRow[], columns: string[]) => {
  const headers = ["number", ...columns];
  const lines = [
    headers.join(","),
    ...rows.map((row) => {
      const values = headers.map((field) => {
        if (field === "number") return escapeCsv(row.display_number || row.id.slice(0, 8).toUpperCase());
        return escapeCsv(getFieldCsvValue(row, field));
      });
      return values.join(",");
    }),
  ];
  return lines.join("\n");
};

const exportChartContainerAsPng = async (element: HTMLElement, fileName: string) => {
  const svg = element.querySelector("svg");
  if (!svg) {
    throw new Error("No chart is available to export yet.");
  }

  const serializer = new XMLSerializer();
  const svgMarkup = serializer.serializeToString(svg);
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const image = new Image();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to render chart image."));
    image.src = svgUrl;
  });

  const bounds = svg.getBoundingClientRect();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1200, Math.ceil(bounds.width));
  canvas.height = Math.max(720, Math.ceil(bounds.height));
  const context = canvas.getContext("2d");
  if (!context) {
    URL.revokeObjectURL(svgUrl);
    throw new Error("Canvas export is unavailable in this browser.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(svgUrl);

  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!pngBlob) throw new Error("Unable to export chart image.");
  downloadBlob(pngBlob, fileName);
};

const getFieldDisplayValue = (row: SmartTicketRow, field: string) => {
  switch (field) {
    case "source":
      return (row.source_type || "WEB").toUpperCase();
    case "type":
      return row.type;
    case "subject":
      return row.title;
    case "requester":
      return row.requester_name ? `${row.requester_name} (${row.requester_email || "-"})` : row.requester_email || "-";
    case "requester_department":
      return row.requester_department || "-";
    case "requester_manager":
      return row.requester_manager_name || "-";
    case "requester_location":
      return row.requester_location || "-";
    case "assigned_team_name":
      return row.assigned_team_name || "Unassigned";
    case "assigned_agent_name":
      return row.assigned_agent_name || "Unassigned";
    case "creator_name":
      return row.creator_name || "-";
    case "priority":
      return row.priority;
    case "status":
      return row.status;
    case "updated":
      return formatDateTime(row.updated_at);
    case "created":
      return formatDateTime(row.created_at);
    case "category":
      return row.category || "Uncategorized";
    case "tags":
      return (row.tag_names || []).join(", ");
    default:
      return String((row as Record<string, unknown>)[field] ?? "-");
  }
};

const getFieldCsvValue = (row: SmartTicketRow, field: string) => {
    if (field === "tags") return (row.tag_names || []).join("; ");
  return getFieldDisplayValue(row, field);
};

const getStatusChipColor = (status: SmartTicketRow["status"]) => {
  switch (status) {
    case "OPEN":
      return "error";
    case "IN_PROGRESS":
      return "info";
    case "WAITING_FOR_CUSTOMER":
      return "warning";
    case "RESOLVED":
      return "success";
    default:
      return "default";
  }
};

const getPriorityChipColor = (priority: SmartTicketRow["priority"]) => {
  switch (priority) {
    case "HIGH":
      return "error";
    case "MEDIUM":
      return "warning";
    default:
      return "success";
  }
};

const normalizeFieldValueForFilter = (field: string, row: SmartTicketRow): string => {
  switch (field) {
    case "source":
      return row.source_type || "WEB";
    case "type":
      return row.type;
    case "subject":
      return row.title;
    case "requester":
      return row.requester_email || row.requester_name || "";
    case "requester_department":
      return row.requester_department || "";
    case "requester_manager":
      return row.requester_manager_name || "";
    case "requester_location":
      return row.requester_location || "";
    case "assigned_team_name":
      return row.assigned_team_name || "";
    case "assigned_agent_name":
      return row.assigned_agent_name || "";
    case "creator_name":
      return row.creator_name || "";
    case "priority":
      return row.priority;
    case "status":
      return row.status;
    case "category":
      return row.category || "";
    case "tags":
      return (row.tag_names || []).join(", ");
    default:
      return String((row as Record<string, unknown>)[field] ?? "");
  }
};

const buildFilterChipKey = (filter: TicketListFilter, index: number) =>
  `${filter.field}-${filter.operator}-${formatTicketFilterValue(filter)}-${index}`;

export const SmartTicketWorkspace: React.FC<SmartTicketWorkspaceProps> = ({
  endpoint,
  title,
  subtitle,
  detailPath,
  createTicketPath,
  createTicketLabel,
  compact = false,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const allowMutations = user?.role !== "EMPLOYEE";
  const canShareViews = user?.role === "ADMIN" || user?.role === "MANAGER";

  const [rows, setRows] = React.useState<SmartTicketRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  const [availableFields, setAvailableFields] = React.useState<TicketFieldOption[]>(FALLBACK_FIELDS);
  const [savedViews, setSavedViews] = React.useState<TicketSavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = React.useState<string>("");
  const [selectedViewDirty, setSelectedViewDirty] = React.useState(false);

  const [searchInput, setSearchInput] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("All");
  const [typeFilter, setTypeFilter] = React.useState("All");
  const [filters, setFilters] = React.useState<TicketListFilter[]>([]);
  const [columns, setColumns] = React.useState<string[]>(DEFAULT_TICKET_COLUMNS);
  const [sortField, setSortField] = React.useState("updated");
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(0);
  const [limit, setLimit] = React.useState(25);

  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [teams, setTeams] = React.useState<TeamLookup[]>([]);
  const [agents, setAgents] = React.useState<AgentLookup[]>([]);

  const [columnMenuAnchor, setColumnMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState>({
    anchorEl: null,
    field: "",
    value: "",
    row: null,
  });
  const [filterDialog, setFilterDialog] = React.useState<FilterDialogState>({
    open: false,
    field: "status",
    operator: "eq",
    value: "",
  });
  const [saveViewDialog, setSaveViewDialog] = React.useState<SaveViewDialogState>({
    open: false,
    mode: "create",
    name: "",
    scope: "PERSONAL",
  });
  const [quickEditDialog, setQuickEditDialog] = React.useState<QuickEditDialogState>({
    open: false,
    row: null,
    field: "status",
    value: "",
    tagsText: "",
  });
  const [chartDialog, setChartDialog] = React.useState<ChartDialogState>({
    open: false,
    field: "status",
    type: "bar",
    loading: false,
    groups: [],
  });
  const [bulkEdit, setBulkEdit] = React.useState<BulkEditState>({
    status: "",
    priority: "",
    assignedTeam: "",
    assignedAgent: "",
    tagsText: "",
  });

  const chartContainerRef = React.useRef<HTMLDivElement | null>(null);
  const previousViewSignatureRef = React.useRef("");
  const viewStorageKey = `ticket_workspace_view:${endpoint}:${user?.id || "anon"}`;

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => setSearchTerm(searchInput.trim()), 250);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const loadViews = React.useCallback(async () => {
    try {
      const [defaultsRes, viewsRes] = await Promise.all([
        api.get<{ availableFields: TicketFieldOption[]; defaultColumns: string[] }>("/tickets/productivity/defaults"),
        api.get<TicketSavedView[]>("/tickets/views"),
      ]);
      setAvailableFields(defaultsRes.data.availableFields?.length ? defaultsRes.data.availableFields : FALLBACK_FIELDS);
      setSavedViews(viewsRes.data || []);
      if (defaultsRes.data.defaultColumns?.length) {
        setColumns((current) => (current.length ? current : defaultsRes.data.defaultColumns));
      }
    } catch (loadError) {
      setAvailableFields(FALLBACK_FIELDS);
      setSavedViews([]);
      setError(getApiErrorMessage(loadError, "Failed to load saved ticket views."));
    }
  }, []);

  const loadLookups = React.useCallback(async () => {
    if (!allowMutations) return;
    try {
      const [teamsRes, agentsRes] = await Promise.all([
        api.get<TeamLookup[]>("/teams"),
        api.get<AgentLookup[]>("/users", { params: { role: "AGENT" } }),
      ]);
      setTeams(teamsRes.data || []);
      setAgents(agentsRes.data || []);
    } catch {
      setTeams([]);
      setAgents([]);
    }
  }, [allowMutations]);

  React.useEffect(() => {
    void loadViews();
    void loadLookups();
  }, [loadLookups, loadViews]);

  React.useEffect(() => {
    if (!savedViews.length) return;
    const storedViewId = window.localStorage.getItem(viewStorageKey);
    if (!storedViewId) return;
    const storedView = savedViews.find((view) => view.id === storedViewId);
    if (!storedView) return;
    applySavedView(storedView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedViews.length]);

  function applySavedView(view: TicketSavedView) {
    setSelectedViewId(view.id);
    setColumns(view.columns?.length ? view.columns : DEFAULT_TICKET_COLUMNS);
    setFilters(view.filters || []);
    setSortField(view.sort_field || "updated");
    setSortOrder(view.sort_order || "desc");
    setLimit(view.page_size || 25);
    setPage(0);
    setSelectedViewDirty(false);
    previousViewSignatureRef.current = JSON.stringify({
      columns: view.columns || DEFAULT_TICKET_COLUMNS,
      filters: view.filters || [],
      sort_field: view.sort_field || "updated",
      sort_order: view.sort_order || "desc",
      page_size: view.page_size || 25,
    });
    window.localStorage.setItem(viewStorageKey, view.id);
  }

  const currentViewSignature = React.useMemo(
    () =>
      JSON.stringify({
        columns,
        filters,
        sort_field: sortField,
        sort_order: sortOrder,
        page_size: limit,
      }),
    [columns, filters, limit, sortField, sortOrder]
  );

  React.useEffect(() => {
    if (!selectedViewId) {
      setSelectedViewDirty(false);
      return;
    }
    setSelectedViewDirty(previousViewSignatureRef.current !== "" && previousViewSignatureRef.current !== currentViewSignature);
  }, [currentViewSignature, selectedViewId]);

  const buildListParams = React.useCallback(
    (override: Partial<{ chartBy: string | null; limit: number; offset: number }> = {}) => {
      const params: Record<string, unknown> = {
        q: searchTerm || undefined,
        sort: sortField,
        order: sortOrder,
        limit: override.limit ?? limit,
        offset: override.offset ?? page * limit,
        fields: columns.join(","),
        filters: JSON.stringify(filters),
      };

      if (statusFilter !== "All") params.status = statusFilter;
      if (typeFilter !== "All") params.type = typeFilter;
      if (override.chartBy) params.chart_by = override.chartBy;

      return params;
    },
    [columns, filters, limit, page, searchTerm, sortField, sortOrder, statusFilter, typeFilter]
  );

  const loadTickets = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError("");
      try {
        const response = await api.get<SmartTicketResponse>(endpoint, { params: buildListParams() });
        setRows(response.data.items || []);
        setTotal(response.data.total || 0);
        if (response.data.available_fields?.length) {
          setAvailableFields(response.data.available_fields);
        }
      } catch (loadError) {
        setError(getApiErrorMessage(loadError, "Failed to load tickets."));
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [buildListParams, endpoint]
  );

  React.useEffect(() => {
    void loadTickets();
    const unsubscribe = subscribeToMetrics("dashboard", () => {
      void loadTickets({ silent: true });
    });
    return () => unsubscribe();
  }, [loadTickets]);

  const openChart = React.useCallback(
    async (field: string, type: "bar" | "pie" | "stacked" = "bar") => {
      setChartDialog({ open: true, field, type, loading: true, groups: [] });
      try {
        const response = await api.get<SmartTicketResponse>(endpoint, {
          params: buildListParams({ chartBy: field, limit: 1, offset: 0 }),
        });
        setChartDialog({
          open: true,
          field,
          type,
          loading: false,
          groups: response.data.chart?.groups || [],
        });
      } catch (chartError) {
        setChartDialog((current) => ({ ...current, loading: false, groups: [] }));
        setError(getApiErrorMessage(chartError, "Failed to build the chart from the current list."));
      }
    },
    [buildListParams, endpoint]
  );

  const handleInlineUpdate = React.useCallback(
    async (
      row: SmartTicketRow,
      field: "status" | "priority" | "assigned_team" | "assigned_agent" | "tags",
      value: string | string[],
      extras?: { assigned_team?: string | null; assigned_agent?: string | null }
    ) => {
      const previousRows = rows;
      const normalizedTags = Array.isArray(value)
        ? value
        : field === "tags"
          ? value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
          : value;

      setRows((current) =>
        current.map((item) => {
          if (item.id !== row.id) return item;
          if (field === "tags") {
            return { ...item, tag_names: Array.isArray(normalizedTags) ? normalizedTags : [] };
          }
          if (field === "assigned_team") {
            const team = teams.find((entry) => entry.id === normalizedTags);
            return {
              ...item,
              assigned_team: String(normalizedTags || "") || null,
              assigned_team_name: team?.name || "Unassigned",
            };
          }
          if (field === "assigned_agent") {
            const agent = agents.find((entry) => entry.id === normalizedTags);
            return {
              ...item,
              assigned_agent: String(normalizedTags || "") || null,
              assigned_agent_name: agent?.name || "Unassigned",
            };
          }
          return {
            ...item,
            [field]: normalizedTags,
          } as SmartTicketRow;
        })
      );

      try {
        const response = await api.patch<SmartTicketRow>(`/tickets/${row.id}/inline`, {
          field,
          value: normalizedTags,
          assigned_team: extras?.assigned_team ?? row.assigned_team ?? null,
          assigned_agent: extras?.assigned_agent ?? row.assigned_agent ?? null,
        });
        setRows((current) => current.map((item) => (item.id === row.id ? { ...item, ...response.data } : item)));
        setSuccess("Ticket updated.");
      } catch (updateError) {
        setRows(previousRows);
        setError(getApiErrorMessage(updateError, "Failed to update the ticket."));
      }
    },
    [agents, rows, teams]
  );

  const handleBulkApply = async () => {
    if (!selectedIds.length) return;
    const body: Record<string, unknown> = { ticket_ids: selectedIds };
    if (bulkEdit.status) body.status = bulkEdit.status;
    if (bulkEdit.priority) body.priority = bulkEdit.priority;
    if (bulkEdit.assignedTeam) body.assigned_team = bulkEdit.assignedTeam === "__clear__" ? null : bulkEdit.assignedTeam;
    if (bulkEdit.assignedAgent) body.assigned_agent = bulkEdit.assignedAgent === "__clear__" ? null : bulkEdit.assignedAgent;
    if (bulkEdit.tagsText.trim()) {
      body.tags = bulkEdit.tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    }

    if (Object.keys(body).length === 1) {
      setError("Choose at least one bulk update value first.");
      return;
    }

    try {
      await api.post("/tickets/bulk-update", body);
      setSelectedIds([]);
      setBulkEdit({
        status: "",
        priority: "",
        assignedTeam: "",
        assignedAgent: "",
        tagsText: "",
      });
      setSuccess("Bulk update applied.");
      await loadTickets({ silent: true });
    } catch (bulkError) {
      setError(getApiErrorMessage(bulkError, "Failed to apply the bulk update."));
    }
  };

  const handleExportCsv = async () => {
    try {
      const exportedRows: SmartTicketRow[] = [];
      const pageSize = 200;
      const response = await api.get<SmartTicketResponse>(endpoint, {
        params: buildListParams({ limit: pageSize, offset: 0 }),
      });
      exportedRows.push(...(response.data.items || []));

      const totalRows = response.data.total || exportedRows.length;
      let offset = pageSize;
      while (offset < totalRows) {
        const pageResponse = await api.get<SmartTicketResponse>(endpoint, {
          params: buildListParams({ limit: pageSize, offset }),
        });
        exportedRows.push(...(pageResponse.data.items || []));
        offset += pageSize;
      }

      const csv = buildCsvFromRows(exportedRows, columns);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "ticket-list-export.csv");
    } catch (exportError) {
      setError(getApiErrorMessage(exportError, "Failed to export the current list."));
    }
  };

  const handleContextMenuAction = async (action: "show" | "exclude" | "filter" | "chart" | "quick-edit") => {
    if (!contextMenu.row || !contextMenu.field) return;

    if (action === "chart") {
      void openChart(contextMenu.field);
      setContextMenu({ anchorEl: null, field: "", value: "", row: null });
      return;
    }

    if (action === "quick-edit") {
      const editableField =
        contextMenu.field === "assigned_team_name"
          ? "assigned_team"
          : contextMenu.field === "assigned_agent_name"
            ? "assigned_agent"
            : contextMenu.field === "tags"
              ? "tags"
              : contextMenu.field === "status" || contextMenu.field === "priority"
                ? contextMenu.field
                : null;

      if (!editableField || !allowMutations) return;

      setQuickEditDialog({
        open: true,
        row: contextMenu.row,
        field: editableField,
        value:
          editableField === "assigned_team"
            ? contextMenu.row.assigned_team || ""
            : editableField === "assigned_agent"
              ? contextMenu.row.assigned_agent || ""
              : editableField === "tags"
                ? ""
                : String((contextMenu.row as Record<string, unknown>)[editableField] ?? ""),
        tagsText: (contextMenu.row.tag_names || []).join(", "),
      });
      setContextMenu({ anchorEl: null, field: "", value: "", row: null });
      return;
    }

    const filterField = contextMenu.field;
    const nextFilter: TicketListFilter = {
      field: filterField,
      operator: action === "exclude" ? "neq" : filterField === "subject" ? "contains" : "eq",
      value:
        filterField === "tags"
          ? (contextMenu.row.tag_names || [])
          : normalizeFieldValueForFilter(filterField, contextMenu.row),
    };

    setFilters((current) => [...current, nextFilter]);
    setPage(0);
    setContextMenu({ anchorEl: null, field: "", value: "", row: null });
  };

  const selectedView = React.useMemo(
    () => savedViews.find((view) => view.id === selectedViewId) || null,
    [savedViews, selectedViewId]
  );

  const openSaveViewDialog = (mode: "create" | "update") => {
    setSaveViewDialog({
      open: true,
      mode,
      name: mode === "update" && selectedView ? selectedView.name : "",
      scope:
        mode === "update" && selectedView
          ? selectedView.scope
          : canShareViews
            ? "TEAM"
            : "PERSONAL",
    });
  };

  const persistView = async () => {
    const payload = {
      name: saveViewDialog.name.trim(),
      scope: saveViewDialog.scope,
      columns,
      filters,
      sort_field: sortField,
      sort_order: sortOrder,
      page_size: limit,
    };

    if (!payload.name) {
      setError("A view name is required.");
      return;
    }

    try {
      const response =
        saveViewDialog.mode === "update" && selectedView
          ? await api.patch<TicketSavedView>(`/tickets/views/${selectedView.id}`, payload)
          : await api.post<TicketSavedView>("/tickets/views", payload);

      await loadViews();
      applySavedView(response.data);
      setSaveViewDialog((current) => ({ ...current, open: false }));
      setSuccess(saveViewDialog.mode === "update" ? "Saved view updated." : "Saved view created.");
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, "Failed to save the current view."));
    }
  };

  const deleteSelectedView = async () => {
    if (!selectedView) return;
    try {
      await api.delete(`/tickets/views/${selectedView.id}`);
      setSelectedViewId("");
      window.localStorage.removeItem(viewStorageKey);
      previousViewSignatureRef.current = "";
      await loadViews();
      setSuccess("Saved view deleted.");
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError, "Failed to delete the saved view."));
    }
  };

  const openCellMenu = (
    event: React.MouseEvent<HTMLElement>,
    field: string,
    row: SmartTicketRow
  ) => {
    event.stopPropagation();
    setContextMenu({
      anchorEl: event.currentTarget,
      field,
      value: normalizeFieldValueForFilter(field, row),
      row,
    });
  };

  const renderCellContent = (row: SmartTicketRow, field: string) => {
    if (allowMutations && field === "status") {
      return (
        <FormControl size="small" fullWidth>
          <Select
            value={row.status}
            onChange={(event) =>
              void handleInlineUpdate(row, "status", event.target.value)
            }
          >
            {statusOptions.map((status) => (
              <MenuItem key={status} value={status}>
                {formatStatusLabel(status)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (allowMutations && field === "priority") {
      return (
        <FormControl size="small" fullWidth>
          <Select
            value={row.priority}
            onChange={(event) =>
              void handleInlineUpdate(row, "priority", event.target.value)
            }
          >
            {priorityOptions.map((priority) => (
              <MenuItem key={priority} value={priority}>
                {priority}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (allowMutations && field === "assigned_team_name") {
      return (
        <FormControl size="small" fullWidth>
          <Select
            value={row.assigned_team || ""}
            displayEmpty
            onChange={(event) =>
              void handleInlineUpdate(row, "assigned_team", event.target.value, {
                assigned_agent: row.assigned_agent,
              })
            }
          >
            <MenuItem value="">Unassigned</MenuItem>
            {teams.map((team) => (
              <MenuItem key={team.id} value={team.id}>
                {team.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (allowMutations && field === "assigned_agent_name") {
      return (
        <FormControl size="small" fullWidth>
          <Select
            value={row.assigned_agent || ""}
            displayEmpty
            onChange={(event) =>
              void handleInlineUpdate(row, "assigned_agent", event.target.value, {
                assigned_team: row.assigned_team,
              })
            }
          >
            <MenuItem value="">Unassigned</MenuItem>
            {agents.map((agent) => (
              <MenuItem key={agent.id} value={agent.id}>
                {agent.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }

    if (field === "status") {
      return (
        <Chip
          label={formatStatusLabel(row.status)}
          size="small"
          color={getStatusChipColor(row.status)}
          onClick={(event) => openCellMenu(event, field, row)}
        />
      );
    }

    if (field === "priority") {
      return (
        <Chip
          label={row.priority}
          size="small"
          color={getPriorityChipColor(row.priority)}
          variant="outlined"
          onClick={(event) => openCellMenu(event, field, row)}
        />
      );
    }

    if (field === "source") {
      return (
        <Chip
          label={(row.source_type || "WEB").toUpperCase()}
          size="small"
          variant="outlined"
          onClick={(event) => openCellMenu(event, field, row)}
        />
      );
    }

    if (field === "tags") {
      const tags = row.tag_names || [];
      return (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
          {tags.length > 0 ? (
            tags.map((tag) => (
              <Chip
                key={`${row.id}-${tag}`}
                label={tag}
                size="small"
                onClick={(event) => openCellMenu(event, field, row)}
              />
            ))
          ) : (
            <Chip label="No tags" size="small" variant="outlined" onClick={(event) => openCellMenu(event, field, row)} />
          )}
          {allowMutations && (
            <Tooltip title="Edit tags">
              <IconButton
                size="small"
                onClick={() =>
                  setQuickEditDialog({
                    open: true,
                    row,
                    field: "tags",
                    value: "",
                    tagsText: tags.join(", "),
                  })
                }
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      );
    }

    return (
      <Button
        variant="text"
        color="inherit"
        sx={{
          px: 0,
          justifyContent: "flex-start",
          minWidth: 0,
          textTransform: "none",
          fontWeight: field === "subject" ? 600 : 500,
          color: "text.primary",
        }}
        onClick={(event) => openCellMenu(event, field, row)}
      >
        {getFieldDisplayValue(row, field)}
      </Button>
    );
  };

  const breadcrumbChips = React.useMemo(() => {
    const chips: Array<{ key: string; label: string; onDelete: () => void }> = [];
    if (searchTerm) {
      chips.push({
        key: "search",
        label: `Search: ${searchTerm}`,
        onDelete: () => {
          setSearchInput("");
          setSearchTerm("");
          setPage(0);
        },
      });
    }
    if (statusFilter !== "All") {
      chips.push({
        key: "status",
        label: `Status: ${formatStatusLabel(statusFilter)}`,
        onDelete: () => {
          setStatusFilter("All");
          setPage(0);
        },
      });
    }
    if (typeFilter !== "All") {
      chips.push({
        key: "type",
        label: `Type: ${formatStatusLabel(typeFilter)}`,
        onDelete: () => {
          setTypeFilter("All");
          setPage(0);
        },
      });
    }
    filters.forEach((filter, index) => {
      chips.push({
        key: buildFilterChipKey(filter, index),
        label: `${TICKET_FIELD_LABELS[filter.field] || filter.field} ${FILTER_OPERATORS.find((entry) => entry.value === filter.operator)?.label || filter.operator} ${formatTicketFilterValue(filter)}`.trim(),
        onDelete: () => {
          setFilters((current) => current.filter((_, itemIndex) => itemIndex !== index));
          setPage(0);
        },
      });
    });
    return chips;
  }, [filters, searchTerm, statusFilter, typeFilter]);

  const tableMinWidth = React.useMemo(() => {
    const selectionColumnWidth = allowMutations ? 64 : 0;
    const numberColumnWidth = getColumnMinWidth("number");
    const actionsColumnWidth = 104;
    return (
      selectionColumnWidth +
      numberColumnWidth +
      actionsColumnWidth +
      columns.reduce((total, column) => total + getColumnMinWidth(column), 0)
    );
  }, [allowMutations, columns]);

  return (
    <Box>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", lg: "center" }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant={compact ? "h5" : "h4"} sx={{ fontWeight: 700 }} gutterBottom>
            {title}
          </Typography>
          <Typography color="text.secondary">{subtitle}</Typography>
        </Box>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
          {createTicketPath && createTicketLabel ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate(createTicketPath)}
            >
              {createTicketLabel}
            </Button>
          ) : null}
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void loadTickets()}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      {success ? (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess("")}>
          {success}
        </Alert>
      ) : null}

      <Paper sx={{ p: 2.5, mb: 2.5, borderRadius: 3 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", xl: "row" }} spacing={2} alignItems={{ xs: "stretch", xl: "center" }}>
            <TextField
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(0);
              }}
              placeholder="Search tickets, requesters, or tags..."
              size="small"
              sx={{ minWidth: { xs: "100%", xl: 320 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />

            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Views</InputLabel>
              <Select
                label="Views"
                value={selectedViewId}
                onChange={(event: SelectChangeEvent<string>) => {
                  const nextId = event.target.value;
                  if (!nextId) {
                    setSelectedViewId("");
                    window.localStorage.removeItem(viewStorageKey);
                    previousViewSignatureRef.current = "";
                    return;
                  }
                  const view = savedViews.find((entry) => entry.id === nextId);
                  if (view) applySavedView(view);
                }}
              >
                <MenuItem value="">Live View</MenuItem>
                {savedViews.map((view) => (
                  <MenuItem key={view.id} value={view.id}>
                    {view.name} {view.scope === "TEAM" ? "(Shared)" : "(Personal)"}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant={selectedViewId && !selectedViewDirty ? "outlined" : "contained"}
              startIcon={<SaveIcon />}
              onClick={() => openSaveViewDialog(selectedViewId ? "update" : "create")}
            >
              {selectedViewId ? (selectedViewDirty ? "Save Changes" : "Save View") : "Save View"}
            </Button>

            <Button
              variant="outlined"
              startIcon={<DeleteIcon />}
              disabled={!selectedView || selectedView.owner_user_id !== user?.id}
              onClick={() => void deleteSelectedView()}
            >
              Delete View
            </Button>

            <Button variant="outlined" startIcon={<ViewColumnIcon />} onClick={(event) => setColumnMenuAnchor(event.currentTarget)}>
              Columns
            </Button>

            <Button variant="outlined" startIcon={<FilterIcon />} onClick={() => setFilterDialog((current) => ({ ...current, open: true }))}>
              Add Filter
            </Button>

            <Button
              variant="outlined"
              startIcon={<BarChartIcon />}
              onClick={() => void openChart("status")}
            >
              Chart
            </Button>

            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => void handleExportCsv()}>
              Export
            </Button>
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={statusFilter}
                onChange={(event: SelectChangeEvent<string>) => {
                  setStatusFilter(event.target.value);
                  setPage(0);
                }}
              >
                <MenuItem value="All">All Statuses</MenuItem>
                {statusOptions.map((status) => (
                  <MenuItem key={status} value={status}>
                    {formatStatusLabel(status)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Type</InputLabel>
              <Select
                label="Type"
                value={typeFilter}
                onChange={(event: SelectChangeEvent<string>) => {
                  setTypeFilter(event.target.value);
                  setPage(0);
                }}
              >
                <MenuItem value="All">All Types</MenuItem>
                {typeOptions.map((type) => (
                  <MenuItem key={type} value={type}>
                    {formatStatusLabel(type)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Sort By</InputLabel>
              <Select
                label="Sort By"
                value={sortField}
                onChange={(event: SelectChangeEvent<string>) => {
                  setSortField(event.target.value);
                  setPage(0);
                }}
              >
                {availableFields.map((field) => (
                  <MenuItem key={field.id} value={field.id}>
                    {field.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Order</InputLabel>
              <Select
                label="Order"
                value={sortOrder}
                onChange={(event: SelectChangeEvent<"asc" | "desc">) => {
                  setSortOrder(event.target.value as "asc" | "desc");
                  setPage(0);
                }}
              >
                <MenuItem value="desc">Newest First</MenuItem>
                <MenuItem value="asc">Oldest First</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          {breadcrumbChips.length ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              {breadcrumbChips.map((chip) => (
                <Chip key={chip.key} label={chip.label} onDelete={chip.onDelete} />
              ))}
              <Button
                variant="text"
                size="small"
                startIcon={<ClearAllIcon />}
                onClick={() => {
                  setSearchInput("");
                  setSearchTerm("");
                  setStatusFilter("All");
                  setTypeFilter("All");
                  setFilters([]);
                  setPage(0);
                }}
              >
                Reset
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      {allowMutations && selectedIds.length ? (
        <Paper sx={{ p: 2, mb: 2, borderRadius: 3, border: "1px solid", borderColor: "primary.light" }}>
          <Stack direction={{ xs: "column", xl: "row" }} spacing={2} alignItems={{ xs: "stretch", xl: "center" }}>
            <Typography sx={{ fontWeight: 700 }}>{selectedIds.length} ticket(s) selected</Typography>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={bulkEdit.status}
                onChange={(event) => setBulkEdit((current) => ({ ...current, status: event.target.value }))}
              >
                <MenuItem value="">Leave as-is</MenuItem>
                {statusOptions.map((status) => (
                  <MenuItem key={status} value={status}>
                    {formatStatusLabel(status)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Priority</InputLabel>
              <Select
                label="Priority"
                value={bulkEdit.priority}
                onChange={(event) => setBulkEdit((current) => ({ ...current, priority: event.target.value }))}
              >
                <MenuItem value="">Leave as-is</MenuItem>
                {priorityOptions.map((priority) => (
                  <MenuItem key={priority} value={priority}>
                    {priority}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Assigned Team</InputLabel>
              <Select
                label="Assigned Team"
                value={bulkEdit.assignedTeam}
                onChange={(event) => setBulkEdit((current) => ({ ...current, assignedTeam: event.target.value }))}
              >
                <MenuItem value="">Leave as-is</MenuItem>
                <MenuItem value="__clear__">Clear assignment</MenuItem>
                {teams.map((team) => (
                  <MenuItem key={team.id} value={team.id}>
                    {team.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Assigned Agent</InputLabel>
              <Select
                label="Assigned Agent"
                value={bulkEdit.assignedAgent}
                onChange={(event) => setBulkEdit((current) => ({ ...current, assignedAgent: event.target.value }))}
              >
                <MenuItem value="">Leave as-is</MenuItem>
                <MenuItem value="__clear__">Clear assignment</MenuItem>
                {agents.map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              label="Tags"
              placeholder="vip, hardware, onboarding"
              value={bulkEdit.tagsText}
              onChange={(event) => setBulkEdit((current) => ({ ...current, tagsText: event.target.value }))}
              sx={{ minWidth: 240 }}
            />
            <Button
              variant="contained"
              startIcon={<TuneIcon />}
              onClick={() =>
                void handleBulkApply()
              }
            >
              Apply
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <Paper sx={{ borderRadius: 3, width: "100%", maxWidth: "100%", overflow: "hidden" }}>
        <TableContainer
          component={Box}
          sx={{
            width: "100%",
            maxWidth: "100%",
            overflowX: "auto",
            overflowY: "hidden",
            "&::-webkit-scrollbar": {
              height: 10,
            },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: "rgba(15, 23, 42, 0.2)",
              borderRadius: 999,
            },
          }}
        >
        <Table sx={{ minWidth: tableMinWidth, width: "max-content", tableLayout: "auto" }}>
          <TableHead>
            <TableRow>
              {allowMutations ? (
                <TableCell padding="checkbox" sx={{ minWidth: 64 }}>
                  <Checkbox
                    checked={rows.length > 0 && selectedIds.length === rows.length}
                    indeterminate={selectedIds.length > 0 && selectedIds.length < rows.length}
                    onChange={(event) =>
                      setSelectedIds(event.target.checked ? rows.map((row) => row.id) : [])
                    }
                  />
                </TableCell>
              ) : null}
              <TableCell sx={{ fontWeight: 700, minWidth: getColumnMinWidth("number"), whiteSpace: "nowrap" }}>
                Number
              </TableCell>
              {columns.map((column) => (
                <TableCell
                  key={column}
                  sx={{
                    fontWeight: 700,
                    minWidth: getColumnMinWidth(column),
                    whiteSpace: column === "subject" || column === "requester" ? "normal" : "nowrap",
                  }}
                >
                  {TICKET_FIELD_LABELS[column] || column}
                </TableCell>
              ))}
              <TableCell align="right" sx={{ fontWeight: 700, minWidth: 104, whiteSpace: "nowrap" }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (allowMutations ? 3 : 2)}>
                  <Box sx={{ py: 6, textAlign: "center" }}>
                    <Typography variant="h6" gutterBottom>
                      No tickets match the current view
                    </Typography>
                    <Typography color="text.secondary">
                      Adjust the filters, switch views, or create a new ticket to get started.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow hover key={row.id}>
                {allowMutations ? (
                  <TableCell padding="checkbox" sx={{ minWidth: 64 }}>
                    <Checkbox
                      checked={selectedIds.includes(row.id)}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, row.id]
                            : current.filter((ticketId) => ticketId !== row.id)
                        )
                      }
                    />
                  </TableCell>
                ) : null}
                <TableCell sx={{ minWidth: getColumnMinWidth("number"), whiteSpace: "nowrap" }}>
                  <Button
                    variant="text"
                    sx={{ px: 0, minWidth: 0, textTransform: "none", fontWeight: 700 }}
                    onClick={() => navigate(detailPath(row.id))}
                  >
                    {row.display_number || row.id.slice(0, 8).toUpperCase()}
                  </Button>
                </TableCell>
                {columns.map((column) => (
                  <TableCell
                    key={`${row.id}-${column}`}
                    sx={{
                      minWidth: getColumnMinWidth(column),
                      verticalAlign: "top",
                    }}
                  >
                    {renderCellContent(row, column)}
                  </TableCell>
                ))}
                <TableCell align="right" sx={{ minWidth: 104, whiteSpace: "nowrap" }}>
                  <Tooltip title="Open field actions">
                    <IconButton onClick={(event) => openCellMenu(event, "subject", row)}>
                      <MoreHorizIcon />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, nextPage) => setPage(nextPage)}
          rowsPerPage={limit}
          onRowsPerPageChange={(event) => {
            setLimit(parseInt(event.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>

      <Menu anchorEl={columnMenuAnchor} open={Boolean(columnMenuAnchor)} onClose={() => setColumnMenuAnchor(null)}>
        <Box sx={{ px: 2, py: 1.5, minWidth: 260 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Visible Columns
          </Typography>
          <FormGroup>
            {availableFields.map((field) => (
              <FormControlLabel
                key={field.id}
                control={
                  <Checkbox
                    size="small"
                    checked={columns.includes(field.id)}
                    onChange={(event) => {
                      setColumns((current) => {
                        if (event.target.checked) {
                          return current.includes(field.id) ? current : [...current, field.id];
                        }
                        const next = current.filter((entry) => entry !== field.id);
                        return next.length ? next : current;
                      });
                    }}
                  />
                }
                label={field.label}
              />
            ))}
          </FormGroup>
        </Box>
      </Menu>

      <Menu
        anchorEl={contextMenu.anchorEl}
        open={Boolean(contextMenu.anchorEl)}
        onClose={() => setContextMenu({ anchorEl: null, field: "", value: "", row: null })}
      >
        <MenuItem onClick={() => void handleContextMenuAction("show")}>Show Similar</MenuItem>
        <MenuItem onClick={() => void handleContextMenuAction("exclude")}>Exclude</MenuItem>
        <MenuItem onClick={() => void handleContextMenuAction("filter")}>Filter by This</MenuItem>
        <MenuItem
          disabled={!isChartableField(contextMenu.field)}
          onClick={() => void handleContextMenuAction("chart")}
        >
          Chart This Field
        </MenuItem>
        <MenuItem
          disabled={
            !allowMutations ||
            !["status", "priority", "assigned_team_name", "assigned_agent_name", "tags"].includes(contextMenu.field)
          }
          onClick={() => void handleContextMenuAction("quick-edit")}
        >
          Quick Edit
        </MenuItem>
      </Menu>

      <Dialog open={filterDialog.open} onClose={() => setFilterDialog((current) => ({ ...current, open: false }))} maxWidth="sm" fullWidth>
        <DialogTitle>Add Filter</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Field</InputLabel>
              <Select
                label="Field"
                value={filterDialog.field}
                onChange={(event) => setFilterDialog((current) => ({ ...current, field: event.target.value }))}
              >
                {availableFields.map((field) => (
                  <MenuItem key={field.id} value={field.id}>
                    {field.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Operator</InputLabel>
              <Select
                label="Operator"
                value={filterDialog.operator}
                onChange={(event) =>
                  setFilterDialog((current) => ({
                    ...current,
                    operator: event.target.value as TicketListFilterOperator,
                  }))
                }
              >
                {FILTER_OPERATORS.map((operator) => (
                  <MenuItem key={operator.value} value={operator.value}>
                    {operator.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {!["empty", "not_empty"].includes(filterDialog.operator) ? (
              <TextField
                label={filterDialog.operator === "in" ? "Values (comma separated)" : "Value"}
                value={filterDialog.value}
                onChange={(event) => setFilterDialog((current) => ({ ...current, value: event.target.value }))}
                fullWidth
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFilterDialog((current) => ({ ...current, open: false }))}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              const nextFilter: TicketListFilter = {
                field: filterDialog.field,
                operator: filterDialog.operator,
                value:
                  filterDialog.operator === "in"
                    ? filterDialog.value
                        .split(",")
                        .map((entry) => entry.trim())
                        .filter(Boolean)
                    : filterDialog.operator === "empty" || filterDialog.operator === "not_empty"
                      ? null
                      : filterDialog.value.trim(),
              };
              setFilters((current) => [...current, nextFilter]);
              setPage(0);
              setFilterDialog((current) => ({ ...current, open: false, value: "" }));
            }}
          >
            Add Filter
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={saveViewDialog.open} onClose={() => setSaveViewDialog((current) => ({ ...current, open: false }))} maxWidth="sm" fullWidth>
        <DialogTitle>{saveViewDialog.mode === "update" ? "Save View Changes" : "Save Current View"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="View Name"
              value={saveViewDialog.name}
              onChange={(event) => setSaveViewDialog((current) => ({ ...current, name: event.target.value }))}
              fullWidth
            />
            <FormControl fullWidth disabled={!canShareViews}>
              <InputLabel>Scope</InputLabel>
              <Select
                label="Scope"
                value={saveViewDialog.scope}
                onChange={(event) =>
                  setSaveViewDialog((current) => ({
                    ...current,
                    scope: event.target.value as "PERSONAL" | "TEAM",
                  }))
                }
              >
                <MenuItem value="PERSONAL">Personal</MenuItem>
                <MenuItem value="TEAM">Shared with Team</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveViewDialog((current) => ({ ...current, open: false }))}>Cancel</Button>
          <Button variant="contained" onClick={() => void persistView()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={quickEditDialog.open} onClose={() => setQuickEditDialog((current) => ({ ...current, open: false }))} maxWidth="sm" fullWidth>
        <DialogTitle>Quick Edit</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="subtitle2">
              {quickEditDialog.row?.display_number || quickEditDialog.row?.id.slice(0, 8).toUpperCase() || "Ticket"}
            </Typography>
            {quickEditDialog.field === "status" ? (
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={quickEditDialog.value}
                  onChange={(event) =>
                    setQuickEditDialog((current) => ({ ...current, value: event.target.value }))
                  }
                >
                  {statusOptions.map((status) => (
                    <MenuItem key={status} value={status}>
                      {formatStatusLabel(status)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {quickEditDialog.field === "priority" ? (
              <FormControl fullWidth>
                <InputLabel>Priority</InputLabel>
                <Select
                  label="Priority"
                  value={quickEditDialog.value}
                  onChange={(event) =>
                    setQuickEditDialog((current) => ({ ...current, value: event.target.value }))
                  }
                >
                  {priorityOptions.map((priority) => (
                    <MenuItem key={priority} value={priority}>
                      {priority}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {quickEditDialog.field === "assigned_team" ? (
              <FormControl fullWidth>
                <InputLabel>Assigned Team</InputLabel>
                <Select
                  label="Assigned Team"
                  value={quickEditDialog.value}
                  onChange={(event) =>
                    setQuickEditDialog((current) => ({ ...current, value: event.target.value }))
                  }
                >
                  <MenuItem value="">Unassigned</MenuItem>
                  {teams.map((team) => (
                    <MenuItem key={team.id} value={team.id}>
                      {team.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {quickEditDialog.field === "assigned_agent" ? (
              <FormControl fullWidth>
                <InputLabel>Assigned Agent</InputLabel>
                <Select
                  label="Assigned Agent"
                  value={quickEditDialog.value}
                  onChange={(event) =>
                    setQuickEditDialog((current) => ({ ...current, value: event.target.value }))
                  }
                >
                  <MenuItem value="">Unassigned</MenuItem>
                  {agents.map((agent) => (
                    <MenuItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {quickEditDialog.field === "tags" ? (
              <TextField
                label="Tags"
                placeholder="vip, urgent, onboarding"
                value={quickEditDialog.tagsText}
                onChange={(event) =>
                  setQuickEditDialog((current) => ({ ...current, tagsText: event.target.value }))
                }
                fullWidth
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuickEditDialog((current) => ({ ...current, open: false }))}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (!quickEditDialog.row) return;
              void handleInlineUpdate(
                quickEditDialog.row,
                quickEditDialog.field,
                quickEditDialog.field === "tags"
                  ? quickEditDialog.tagsText
                  : quickEditDialog.value,
                {
                  assigned_team:
                    quickEditDialog.field === "assigned_team"
                      ? quickEditDialog.value || null
                      : quickEditDialog.row.assigned_team || null,
                  assigned_agent:
                    quickEditDialog.field === "assigned_agent"
                      ? quickEditDialog.value || null
                      : quickEditDialog.row.assigned_agent || null,
                }
              );
              setQuickEditDialog((current) => ({ ...current, open: false }));
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer anchor="right" open={chartDialog.open} onClose={() => setChartDialog((current) => ({ ...current, open: false }))}>
        <Box sx={{ width: { xs: "100vw", sm: 520 }, p: 3 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Chart
              </Typography>
              <Typography color="text.secondary">
                Visualize the currently filtered ticket list.
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() =>
                chartContainerRef.current
                  ? void exportChartContainerAsPng(chartContainerRef.current, "ticket-chart.png").catch((chartError) =>
                      setError(getApiErrorMessage(chartError, "Failed to export the chart image."))
                    )
                  : undefined
              }
            >
              PNG
            </Button>
          </Stack>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Field</InputLabel>
              <Select
                label="Field"
                value={chartDialog.field}
                onChange={(event) => void openChart(event.target.value, chartDialog.type)}
              >
                {availableFields
                  .filter((field) => isChartableField(field.id))
                  .map((field) => (
                    <MenuItem key={field.id} value={field.id}>
                      {field.label}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select
                label="Type"
                value={chartDialog.type}
                onChange={(event) =>
                  setChartDialog((current) => ({
                    ...current,
                    type: event.target.value as "bar" | "pie" | "stacked",
                  }))
                }
              >
                <MenuItem value="bar">Bar</MenuItem>
                <MenuItem value="pie">Pie</MenuItem>
                <MenuItem value="stacked">Stacked Bar</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <Paper ref={chartContainerRef} sx={{ p: 2, borderRadius: 3 }}>
            {chartDialog.loading ? (
              <Typography color="text.secondary">Building chart...</Typography>
            ) : chartDialog.groups.length === 0 ? (
              <Typography color="text.secondary">There is no data to chart for the current filters.</Typography>
            ) : (
              <Box sx={{ height: 420 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {chartDialog.type === "pie" ? (
                    <PieChart>
                      <Pie
                        data={chartDialog.groups}
                        dataKey="count"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        outerRadius={140}
                        label
                      >
                        {chartDialog.groups.map((group, index) => (
                          <Cell key={group.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend />
                      <RechartsTooltip />
                    </PieChart>
                  ) : (
                    <BarChart data={chartDialog.groups}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" interval={0} angle={chartDialog.type === "stacked" ? -20 : 0} textAnchor="end" height={70} />
                      <YAxis allowDecimals={false} />
                      <RechartsTooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#2563eb" name="Tickets" stackId={chartDialog.type === "stacked" ? "a" : undefined} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </Box>
            )}
          </Paper>
          {chartDialog.groups.length ? (
            <List dense sx={{ mt: 2 }}>
              {chartDialog.groups.map((group, index) => (
                <ListItem key={group.key} disableGutters secondaryAction={<Typography sx={{ fontWeight: 700 }}>{group.count}</Typography>}>
                  <Stack direction="row" spacing={1.25} alignItems="center">
                    <Avatar
                      variant="rounded"
                      sx={{
                        width: 18,
                        height: 18,
                        bgcolor: CHART_COLORS[index % CHART_COLORS.length],
                      }}
                    />
                    <ListItemText primary={group.label} />
                  </Stack>
                </ListItem>
              ))}
            </List>
          ) : null}
        </Box>
      </Drawer>
    </Box>
  );
};
