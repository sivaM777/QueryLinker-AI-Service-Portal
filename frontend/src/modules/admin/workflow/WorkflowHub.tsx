import React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import LibraryBooksRoundedIcon from "@mui/icons-material/LibraryBooksRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import UploadRoundedIcon from "@mui/icons-material/UploadRounded";
import DraftsRoundedIcon from "@mui/icons-material/DraftsRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "../../../services/api";
import { useAuth } from "../../../services/auth";

type WorkflowListItem = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  triggerType: string;
  nodes?: unknown[];
  edges?: unknown[];
  createdAt?: string;
  updatedAt?: string;
};

type WorkflowTemplate = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  is_system: boolean;
  template_data?: {
    triggerType?: string;
    nodes?: unknown[];
    edges?: unknown[];
  };
};

type WorkflowDraftSummary = {
  key: string;
  workflowId: string;
  name: string;
  description: string;
  triggerType: string;
  autosavedAt: string;
  savedAt?: string | null;
};

const metricCardSx = {
  borderRadius: 4,
  border: "1px solid",
  borderColor: alpha("#94A3B8", 0.18),
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.98))",
  boxShadow: "0 20px 40px rgba(15, 23, 42, 0.06)",
};

const formatWhen = (value?: string | null) => {
  if (!value) return "Just now";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const readDraftsForUser = (userId?: string) => {
  if (typeof window === "undefined" || !userId) return [] as WorkflowDraftSummary[];

  const prefix = `workflow_studio_draft:${userId}:`;
  const drafts: WorkflowDraftSummary[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !key.startsWith(prefix)) continue;

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        selectedWorkflowId?: string;
        name?: string;
        description?: string;
        triggerType?: string;
        autosavedAt?: string;
        savedAt?: string | null;
      };

      drafts.push({
        key,
        workflowId: parsed.selectedWorkflowId || "",
        name: parsed.name || "Untitled Workflow",
        description: parsed.description || "",
        triggerType: parsed.triggerType || "manual",
        autosavedAt: parsed.autosavedAt || "",
        savedAt: parsed.savedAt || null,
      });
    } catch {
      // Ignore malformed local draft payloads.
    }
  }

  return drafts.sort((left, right) => {
    return new Date(right.autosavedAt || 0).getTime() - new Date(left.autosavedAt || 0).getTime();
  });
};

export const WorkflowHub: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const authTolerantConfig = React.useMemo(() => ({ skipAuthRedirect: true } as any), []);
  const [tab, setTab] = React.useState<"history" | "templates" | "drafts">("history");
  const [menuAnchor, setMenuAnchor] = React.useState<null | HTMLElement>(null);
  const [workflows, setWorkflows] = React.useState<WorkflowListItem[]>([]);
  const [templates, setTemplates] = React.useState<WorkflowTemplate[]>([]);
  const [drafts, setDrafts] = React.useState<WorkflowDraftSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [toast, setToast] = React.useState<{ severity: "success" | "info" | "warning" | "error"; message: string } | null>(null);

  const refreshDrafts = React.useCallback(() => {
    setDrafts(readDraftsForUser(user?.id));
  }, [user?.id]);

  const refreshData = React.useCallback(async () => {
    if (!user || (user.role !== "ADMIN" && user.role !== "MANAGER")) return;

    setIsLoading(true);
    try {
      const [workflowRes, templateRes] = await Promise.all([
        api.get<any>("/workflows/visual", { params: { limit: 200 }, ...authTolerantConfig }),
        api.get<any>("/workflows/templates", authTolerantConfig),
      ]);

      setWorkflows(Array.isArray(workflowRes.data?.data) ? workflowRes.data.data : []);
      setTemplates(Array.isArray(templateRes.data?.data) ? templateRes.data.data : []);
      refreshDrafts();
    } catch (error) {
      setToast({
        severity: "error",
        message: getApiErrorMessage(error, "Failed to load workflow workspace"),
      });
    } finally {
      setIsLoading(false);
    }
  }, [authTolerantConfig, refreshDrafts, user]);

  React.useEffect(() => {
    void refreshData();
  }, [refreshData]);

  React.useEffect(() => {
    const onFocus = () => refreshDrafts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshDrafts]);

  const latestDraft = drafts[0] || null;

  const navigateToStudio = React.useCallback(
    (search: string) => {
      navigate(`/admin/workflow/studio${search}`);
      setMenuAnchor(null);
    },
    [navigate]
  );

  const handleCreateMenu = (mode: "new" | "import" | "draft") => {
    if (mode === "draft") {
      if (!latestDraft) {
        setToast({
          severity: "warning",
          message: "No saved draft was found yet, so we opened a fresh workflow instead.",
        });
        navigateToStudio("?mode=new");
        return;
      }

      const search = latestDraft.workflowId
        ? `?mode=draft&workflowId=${encodeURIComponent(latestDraft.workflowId)}`
        : "?mode=draft";
      navigateToStudio(search);
      return;
    }

    navigateToStudio(`?mode=${mode}`);
  };

  return (
    <Box sx={{ display: "grid", gap: 3, pb: 3 }}>
      <Paper
        elevation={0}
        sx={{
          ...metricCardSx,
          p: { xs: 2.5, md: 3 },
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 15% 15%, rgba(37,99,235,0.12), transparent 32%), radial-gradient(circle at 88% 12%, rgba(16,185,129,0.10), transparent 28%)",
            pointerEvents: "none",
          }}
        />

        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", lg: "center" }}
          sx={{ position: "relative", zIndex: 1 }}
        >
          <Box sx={{ maxWidth: 760 }}>
            <Typography variant="overline" sx={{ color: "primary.main", fontWeight: 800, letterSpacing: "0.12em" }}>
              Workflow Workspace
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: "-0.04em", mt: 0.5 }}>
              Keep the workflow library clean, then open the editor only when you need to build.
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1.25, maxWidth: 640 }}>
              This page is now your calmer workflow hub. Review saved workflows, inspect reusable templates, and reopen drafts without carrying the full canvas around all the time.
            </Typography>
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ alignSelf: { xs: "stretch", lg: "flex-start" } }}>
            <Button
              variant="contained"
              startIcon={<AddRoundedIcon />}
              onClick={(event) => setMenuAnchor(event.currentTarget)}
              sx={{ borderRadius: 999, px: 2.4, py: 1.15, fontWeight: 800 }}
            >
              Create Workflow
            </Button>
            <Button
              variant="outlined"
              startIcon={<AutorenewRoundedIcon />}
              onClick={() => void refreshData()}
              sx={{ borderRadius: 999, px: 2.2, py: 1.15, fontWeight: 800 }}
            >
              Refresh Library
            </Button>
          </Stack>
        </Stack>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mt: 2.5, position: "relative", zIndex: 1 }}>
          <Card variant="outlined" sx={{ ...metricCardSx, flex: 1 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Saved workflows
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5 }}>
                {workflows.length}
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ ...metricCardSx, flex: 1 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Templates ready
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5 }}>
                {templates.length}
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" sx={{ ...metricCardSx, flex: 1 }}>
            <CardContent>
              <Typography variant="body2" color="text.secondary">
                Drafts on this device
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5 }}>
                {drafts.length}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                {latestDraft ? `Latest draft saved ${formatWhen(latestDraft.autosavedAt)}` : "No local draft detected yet"}
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ ...metricCardSx, p: 1.25 }}>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          sx={{
            px: 1,
            ".MuiTabs-indicator": { height: 3, borderRadius: 999 },
          }}
        >
          <Tab icon={<HistoryRoundedIcon />} iconPosition="start" label="History" value="history" />
          <Tab icon={<LibraryBooksRoundedIcon />} iconPosition="start" label="Templates" value="templates" />
          <Tab icon={<DraftsRoundedIcon />} iconPosition="start" label="Drafts" value="drafts" />
        </Tabs>

        <Divider sx={{ mt: 1, mb: 2 }} />

        {tab === "history" && (
          <Box sx={{ display: "grid", gap: 1.5 }}>
            {workflows.length === 0 && !isLoading ? (
              <Alert severity="info">No saved workflows are available yet. Use the create menu to start the first one.</Alert>
            ) : (
              workflows.map((workflow) => (
                <Card key={workflow.id} variant="outlined" sx={{ borderRadius: 3 }}>
                  <CardContent>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={2}
                      justifyContent="space-between"
                      alignItems={{ xs: "flex-start", md: "center" }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="h6" sx={{ fontWeight: 800 }}>
                            {workflow.name}
                          </Typography>
                          <Chip
                            size="small"
                            label={workflow.enabled ? "Active" : "Paused"}
                            sx={{
                              fontWeight: 700,
                              background: workflow.enabled ? alpha("#10B981", 0.14) : alpha("#F59E0B", 0.16),
                              color: workflow.enabled ? "#047857" : "#B45309",
                            }}
                          />
                          <Chip size="small" variant="outlined" label={workflow.triggerType || "manual"} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 820 }}>
                          {workflow.description || "No description added yet."}
                        </Typography>
                        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                          <Typography variant="caption" color="text.secondary">
                            Updated {formatWhen(workflow.updatedAt || workflow.createdAt)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {(workflow.nodes || []).length} nodes
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {(workflow.edges || []).length} connections
                          </Typography>
                        </Stack>
                      </Box>

                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Button
                          variant="outlined"
                          endIcon={<ArrowForwardRoundedIcon />}
                          onClick={() => navigate(`/admin/workflow/studio?workflowId=${encodeURIComponent(workflow.id)}`)}
                          sx={{ borderRadius: 999, fontWeight: 800 }}
                        >
                          Open Editor
                        </Button>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              ))
            )}
          </Box>
        )}

        {tab === "templates" && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" }, gap: 1.5 }}>
            {templates.length === 0 && !isLoading ? (
              <Alert severity="info">No templates are available right now.</Alert>
            ) : (
              templates.map((template) => (
                <Card key={template.id} variant="outlined" sx={{ borderRadius: 3, height: "100%" }}>
                  <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        {template.name}
                      </Typography>
                      <Chip
                        size="small"
                        label={template.is_system ? "System template" : "Custom template"}
                        sx={{
                          fontWeight: 700,
                          background: template.is_system ? alpha("#2563EB", 0.12) : alpha("#10B981", 0.14),
                          color: template.is_system ? "#1D4ED8" : "#047857",
                        }}
                      />
                      <Chip size="small" variant="outlined" label={template.category || "Uncategorized"} />
                    </Stack>

                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, flexGrow: 1 }}>
                      {template.description || "Reusable starter flow for common service desk operations."}
                    </Typography>

                    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                      <Typography variant="caption" color="text.secondary">
                        Trigger {template.template_data?.triggerType || "manual"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(template.template_data?.nodes || []).length} nodes
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {(template.template_data?.edges || []).length} connections
                      </Typography>
                    </Stack>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2 }}>
                      <Button
                        variant="contained"
                        startIcon={<AutoAwesomeRoundedIcon />}
                        onClick={() =>
                          navigate(
                            `/admin/workflow/studio?mode=template&templateId=${encodeURIComponent(template.id)}`
                          )
                        }
                        sx={{ borderRadius: 999, fontWeight: 800 }}
                      >
                        Use Template
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              ))
            )}
          </Box>
        )}

        {tab === "drafts" && (
          <Box sx={{ display: "grid", gap: 1.5 }}>
            {drafts.length === 0 ? (
              <Alert severity="info">No local drafts are waiting on this browser yet.</Alert>
            ) : (
              drafts.map((draft) => (
                <Card key={draft.key} variant="outlined" sx={{ borderRadius: 3 }}>
                  <CardContent>
                    <Stack
                      direction={{ xs: "column", md: "row" }}
                      spacing={2}
                      justifyContent="space-between"
                      alignItems={{ xs: "flex-start", md: "center" }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="h6" sx={{ fontWeight: 800 }}>
                            {draft.name}
                          </Typography>
                          <Chip size="small" variant="outlined" label={draft.triggerType || "manual"} />
                          {draft.workflowId && <Chip size="small" label="Saved workflow draft" />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                          {draft.description || "No description captured yet."}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                          Auto-saved {formatWhen(draft.autosavedAt)}
                        </Typography>
                      </Box>

                      <Button
                        variant="outlined"
                        endIcon={<OpenInNewRoundedIcon />}
                        onClick={() => {
                          const search = draft.workflowId
                            ? `?mode=draft&workflowId=${encodeURIComponent(draft.workflowId)}`
                            : "?mode=draft";
                          navigate(`/admin/workflow/studio${search}`);
                        }}
                        sx={{ borderRadius: 999, fontWeight: 800 }}
                      >
                        Continue Draft
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              ))
            )}
          </Box>
        )}
      </Paper>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        PaperProps={{
          sx: {
            borderRadius: 3,
            minWidth: 220,
            mt: 1,
            boxShadow: "0 24px 60px rgba(15, 23, 42, 0.18)",
          },
        }}
      >
        <MenuItem onClick={() => handleCreateMenu("new")}>
          <AddRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          New
        </MenuItem>
        <MenuItem onClick={() => handleCreateMenu("import")}>
          <UploadRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Import
        </MenuItem>
        <MenuItem onClick={() => handleCreateMenu("draft")}>
          <DraftsRoundedIcon fontSize="small" sx={{ mr: 1.25 }} />
          Draft
        </MenuItem>
      </Menu>

      <Snackbar open={Boolean(toast)} autoHideDuration={4200} onClose={() => setToast(null)}>
        <Alert severity={toast?.severity || "info"} onClose={() => setToast(null)} sx={{ width: "100%" }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default WorkflowHub;
