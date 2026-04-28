import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  ArrowForwardRounded as ArrowForwardIcon,
  AutoAwesomeRounded as TemplateIcon,
  DeleteOutlineRounded as DeleteIcon,
  ViewKanbanRounded as BoardIcon,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "../../../services/api";
import { useAuth } from "../../../services/auth";
import {
  createBoard,
  deleteBoard,
  listBoards,
  type BoardKind,
  type BoardMode,
  type BoardSummary,
  type BoardSwimlaneMode,
  type BoardVisibility,
} from "../../../services/boards";
import type { TicketSavedView } from "../../../services/ticketProductivity";

type TeamOption = {
  id: string;
  name: string;
};

type BoardPresetKey =
  | "OPS_QUEUE_STATUS"
  | "HIGH_PRIORITY_ESCALATIONS"
  | "AGENT_WORK_QUEUE"
  | "PERSONAL_FREEFORM";

type BoardFilterTab = "mine" | "shared" | "team";

const BOARD_PRESETS: Array<{
  key: BoardPresetKey;
  label: string;
  description: string;
  kind: BoardKind;
  mode: BoardMode | null;
}> = [
  {
    key: "OPS_QUEUE_STATUS",
    label: "Ops Queue by Status",
    description: "A live ticket board grouped by status for triage and resolution flow.",
    kind: "DATA_DRIVEN",
    mode: "GUIDED",
  },
  {
    key: "HIGH_PRIORITY_ESCALATIONS",
    label: "High Priority Escalations",
    description: "A focused board for high-priority work with flexible movement rules.",
    kind: "DATA_DRIVEN",
    mode: "FLEXIBLE",
  },
  {
    key: "AGENT_WORK_QUEUE",
    label: "Agent Work Queue by Assignee",
    description: "A guided board that lets managers rebalance active work by assignee.",
    kind: "DATA_DRIVEN",
    mode: "GUIDED",
  },
  {
    key: "PERSONAL_FREEFORM",
    label: "Personal Freeform Board",
    description: "A manual board for standups, reminders, and operational checklists.",
    kind: "FREEFORM",
    mode: null,
  },
];

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const createInitialForm = () => ({
  name: "",
  description: "",
  presetKey: "OPS_QUEUE_STATUS" as BoardPresetKey,
  kind: "DATA_DRIVEN" as BoardKind,
  mode: "GUIDED" as BoardMode,
  visibility: "PERSONAL" as BoardVisibility,
  savedViewId: "",
  teamId: "",
  columnField: "status",
  swimlaneMode: "NONE" as BoardSwimlaneMode,
  swimlaneField: "",
});

export const BoardsWorkspace: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = React.useState<BoardFilterTab>("mine");
  const [boards, setBoards] = React.useState<BoardSummary[]>([]);
  const [teams, setTeams] = React.useState<TeamOption[]>([]);
  const [views, setViews] = React.useState<TicketSavedView[]>([]);
  const [openCreate, setOpenCreate] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [form, setForm] = React.useState(createInitialForm());
  const canCreateShared = user?.role === "ADMIN" || user?.role === "MANAGER";

  const loadBoards = React.useCallback(async (silent = false) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const rows = await listBoards();
      setBoards(rows);
    } catch (error) {
      setCreateError(getApiErrorMessage(error, "We couldn't load boards right now."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void loadBoards();
  }, [loadBoards]);

  const loadCreateDependencies = React.useCallback(async () => {
    try {
      const [ticketViewsResponse, teamsResponse] = await Promise.all([
        api.get<TicketSavedView[]>("/tickets/views"),
        api.get<TeamOption[]>("/teams"),
      ]);
      setViews(ticketViewsResponse.data || []);
      setTeams(teamsResponse.data || []);
    } catch {
      // Non-blocking; the form can still create boards without these helpers.
    }
  }, []);

  const handleOpenCreate = async () => {
    setForm(createInitialForm());
    setCreateError(null);
    setOpenCreate(true);
    await loadCreateDependencies();
  };

  const applyPreset = (presetKey: BoardPresetKey) => {
    const preset = BOARD_PRESETS.find((entry) => entry.key === presetKey);
    if (!preset) return;

    setForm((current) => ({
      ...current,
      presetKey,
      kind: preset.kind,
      mode: preset.mode ?? current.mode,
      columnField:
        presetKey === "AGENT_WORK_QUEUE"
          ? "assigned_agent"
          : presetKey === "OPS_QUEUE_STATUS"
            ? "status"
            : current.columnField,
      swimlaneMode: preset.kind === "FREEFORM" ? current.swimlaneMode : "NONE",
    }));
  };

  const filteredBoards = React.useMemo(() => {
    if (!user) return boards;
    if (tab === "mine") return boards.filter((board) => board.owner_user_id === user.id);
    if (tab === "shared") return boards.filter((board) => board.visibility === "SHARED");
    return boards.filter((board) => Boolean(board.team_id) && board.team_id === user.team_id);
  }, [boards, tab, user]);

  const handleCreateBoard = async () => {
    try {
      setSubmitting(true);
      setCreateError(null);
      const created = await createBoard({
        name: form.name.trim(),
        description: form.description.trim() || null,
        preset_key: form.presetKey,
        kind: form.kind,
        mode: form.kind === "DATA_DRIVEN" ? form.mode : null,
        visibility: canCreateShared ? form.visibility : "PERSONAL",
        team_id: canCreateShared && form.visibility === "SHARED" ? form.teamId || null : null,
        saved_view_id: form.savedViewId || null,
        column_field:
          form.kind === "DATA_DRIVEN" && form.mode === "GUIDED"
            ? (form.columnField as "status" | "priority" | "assigned_team" | "assigned_agent")
            : null,
        swimlane_mode: form.swimlaneMode,
        swimlane_field:
          form.swimlaneMode === "FIELD"
            ? (form.swimlaneField as "assigned_team" | "assigned_agent" | "priority" | "requester_department")
            : null,
      });
      setOpenCreate(false);
      await loadBoards(true);
      navigate(`/admin/boards/${created.id}`);
    } catch (error) {
      setCreateError(getApiErrorMessage(error, "We couldn't create the board right now."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBoard = async (board: BoardSummary) => {
    const confirmed = window.confirm(`Delete "${board.name}"? This board workspace will be removed.`);
    if (!confirmed) return;

    try {
      await deleteBoard(board.id);
      await loadBoards(true);
    } catch (error) {
      setCreateError(getApiErrorMessage(error, "We couldn't delete the board."));
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, alignItems: { xs: "flex-start", md: "center" }, flexDirection: { xs: "column", md: "row" } }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>
            Boards
          </Typography>
          <Typography color="text.secondary">
            Run live ticket boards and personal operational boards in one shared workspace.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={() => void loadBoards(true)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => void handleOpenCreate()}>
            Create Board
          </Button>
        </Stack>
      </Box>

      {createError ? <Alert severity="error">{createError}</Alert> : null}

      <Card sx={{ borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)" }}>
        <CardContent sx={{ pb: 1 }}>
          <Tabs value={tab} onChange={(_event, next) => setTab(next)} sx={{ mb: 2 }}>
            <Tab label="My Boards" value="mine" />
            <Tab label="Shared Boards" value="shared" />
            <Tab label="Team Boards" value="team" />
          </Tabs>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "repeat(2, minmax(0, 1fr))" },
              gap: 2,
            }}
          >
            {loading ? (
              <Typography color="text.secondary">Loading board workspaces...</Typography>
            ) : filteredBoards.length === 0 ? (
              <Box sx={{ p: 3, borderRadius: 3, border: "1px dashed rgba(37,99,235,0.3)", bgcolor: "rgba(37,99,235,0.04)" }}>
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                  Nothing here yet
                </Typography>
                <Typography color="text.secondary">
                  Create a freeform board for your own operational work or spin up a live ticket board to manage queues in real time.
                </Typography>
              </Box>
            ) : (
              filteredBoards.map((board) => (
                <Card
                  key={board.id}
                  sx={{
                    borderRadius: 4,
                    border: "1px solid rgba(15,23,42,0.08)",
                    boxShadow: "0 18px 48px rgba(15,23,42,0.06)",
                  }}
                >
                  <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip icon={<BoardIcon fontSize="small" />} label={board.kind === "FREEFORM" ? "Freeform" : `Ticket • ${board.mode || "Board"}`} />
                      <Chip label={board.visibility === "SHARED" ? "Shared" : "Personal"} color={board.visibility === "SHARED" ? "primary" : "default"} variant={board.visibility === "SHARED" ? "filled" : "outlined"} />
                      {board.team_name ? <Chip label={board.team_name} variant="outlined" /> : null}
                    </Stack>

                    <Box>
                      <Typography variant="h6" sx={{ fontWeight: 800, mb: 0.75 }}>
                        {board.name}
                      </Typography>
                      <Typography color="text.secondary">
                        {board.description || "No description yet. Open the board to start organizing work."}
                      </Typography>
                    </Box>

                    <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Owner
                        </Typography>
                        <Typography sx={{ fontWeight: 700 }}>{board.owner_name || "Unknown"}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Updated
                        </Typography>
                        <Typography sx={{ fontWeight: 700 }}>{formatDateTime(board.updated_at)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Columns
                        </Typography>
                        <Typography sx={{ fontWeight: 700 }}>{board.column_count ?? 0}</Typography>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={1.5}>
                      <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={() => navigate(`/admin/boards/${board.id}`)}>
                        Open Board
                      </Button>
                      {board.can_manage ? (
                        <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => void handleDeleteBoard(board)}>
                          Delete
                        </Button>
                      ) : null}
                    </Stack>
                  </CardContent>
                </Card>
              ))
            )}
          </Box>
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 4, border: "1px solid rgba(15,23,42,0.08)" }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
            Recommended board starters
          </Typography>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" } }}>
            {BOARD_PRESETS.map((preset) => (
              <Box key={preset.key} sx={{ p: 2.25, borderRadius: 3, border: "1px solid rgba(37,99,235,0.14)", bgcolor: "rgba(37,99,235,0.03)" }}>
                <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mb: 1.25 }}>
                  <TemplateIcon color="primary" />
                  <Typography sx={{ fontWeight: 800 }}>{preset.label}</Typography>
                </Stack>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                  {preset.description}
                </Typography>
                <Button variant="text" onClick={() => void handleOpenCreate().then(() => applyPreset(preset.key))}>
                  Use This Starter
                </Button>
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Dialog open={openCreate} onClose={() => !submitting && setOpenCreate(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create Board</DialogTitle>
        <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {createError ? <Alert severity="error">{createError}</Alert> : null}

          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            <TextField
              label="Board Name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Starter</InputLabel>
              <Select
                label="Starter"
                value={form.presetKey}
                onChange={(event) => applyPreset(event.target.value as BoardPresetKey)}
              >
                {BOARD_PRESETS.map((preset) => (
                  <MenuItem key={preset.key} value={preset.key}>
                    {preset.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <TextField
            label="Description"
            value={form.description}
            onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            multiline
            minRows={3}
            fullWidth
          />

          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" } }}>
            <FormControl fullWidth>
              <InputLabel>Board Type</InputLabel>
              <Select
                label="Board Type"
                value={form.kind}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    kind: event.target.value as BoardKind,
                    mode: event.target.value === "FREEFORM" ? "GUIDED" : current.mode,
                  }))
                }
              >
                <MenuItem value="FREEFORM">Freeform</MenuItem>
                <MenuItem value="DATA_DRIVEN">Ticket-backed</MenuItem>
              </Select>
            </FormControl>

            {form.kind === "DATA_DRIVEN" ? (
              <FormControl fullWidth>
                <InputLabel>Board Mode</InputLabel>
                <Select
                  label="Board Mode"
                  value={form.mode}
                  onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value as BoardMode }))}
                >
                  <MenuItem value="GUIDED">Guided</MenuItem>
                  <MenuItem value="FLEXIBLE">Flexible</MenuItem>
                </Select>
              </FormControl>
            ) : (
              <Box />
            )}

            <FormControl fullWidth disabled={!canCreateShared}>
              <InputLabel>Sharing</InputLabel>
              <Select
                label="Sharing"
                value={canCreateShared ? form.visibility : "PERSONAL"}
                onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value as BoardVisibility }))}
              >
                <MenuItem value="PERSONAL">Personal</MenuItem>
                <MenuItem value="SHARED">Shared</MenuItem>
              </Select>
            </FormControl>
          </Box>

          {form.visibility === "SHARED" && canCreateShared ? (
            <FormControl fullWidth>
              <InputLabel>Shared Team</InputLabel>
              <Select
                label="Shared Team"
                value={form.teamId}
                onChange={(event) => setForm((current) => ({ ...current, teamId: String(event.target.value || "") }))}
              >
                <MenuItem value="">Use my current team</MenuItem>
                {teams.map((team) => (
                  <MenuItem key={team.id} value={team.id}>
                    {team.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}

          {form.kind === "DATA_DRIVEN" ? (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
              <FormControl fullWidth>
                <InputLabel>Saved Ticket View</InputLabel>
                <Select
                  label="Saved Ticket View"
                  value={form.savedViewId}
                  onChange={(event) => setForm((current) => ({ ...current, savedViewId: String(event.target.value || "") }))}
                >
                  <MenuItem value="">No saved view</MenuItem>
                  {views.map((view) => (
                    <MenuItem key={view.id} value={view.id}>
                      {view.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {form.mode === "GUIDED" ? (
                <FormControl fullWidth>
                  <InputLabel>Column Field</InputLabel>
                  <Select
                    label="Column Field"
                    value={form.columnField}
                    onChange={(event) => setForm((current) => ({ ...current, columnField: String(event.target.value) }))}
                  >
                    <MenuItem value="status">Status</MenuItem>
                    <MenuItem value="priority">Priority</MenuItem>
                    <MenuItem value="assigned_team">Assigned Team</MenuItem>
                    <MenuItem value="assigned_agent">Assigned Agent</MenuItem>
                  </Select>
                </FormControl>
              ) : (
                <Box />
              )}

              <FormControl fullWidth>
                <InputLabel>Swimlanes</InputLabel>
                <Select
                  label="Swimlanes"
                  value={form.swimlaneMode}
                  onChange={(event) => setForm((current) => ({ ...current, swimlaneMode: event.target.value as BoardSwimlaneMode }))}
                >
                  <MenuItem value="NONE">None</MenuItem>
                  <MenuItem value="FIELD">Field-based</MenuItem>
                </Select>
              </FormControl>

              {form.swimlaneMode === "FIELD" ? (
                <FormControl fullWidth>
                  <InputLabel>Swimlane Field</InputLabel>
                  <Select
                    label="Swimlane Field"
                    value={form.swimlaneField}
                    onChange={(event) => setForm((current) => ({ ...current, swimlaneField: String(event.target.value) }))}
                  >
                    <MenuItem value="assigned_team">Assigned Team</MenuItem>
                    <MenuItem value="assigned_agent">Assigned Agent</MenuItem>
                    <MenuItem value="priority">Priority</MenuItem>
                    <MenuItem value="requester_department">Requester Department</MenuItem>
                  </Select>
                </FormControl>
              ) : null}
            </Box>
          ) : (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
              <FormControl fullWidth>
                <InputLabel>Swimlanes</InputLabel>
                <Select
                  label="Swimlanes"
                  value={form.swimlaneMode}
                  onChange={(event) => setForm((current) => ({ ...current, swimlaneMode: event.target.value as BoardSwimlaneMode }))}
                >
                  <MenuItem value="NONE">None</MenuItem>
                  <MenuItem value="MANUAL">Manual</MenuItem>
                </Select>
              </FormControl>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreate(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void handleCreateBoard()} disabled={submitting || !form.name.trim()}>
            {submitting ? "Creating..." : "Create Board"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default BoardsWorkspace;
