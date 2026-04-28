import React from "react";
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  IconButton,
  Tooltip,
} from "@mui/material";
import { Add as AddIcon, Edit as EditIcon, ContentCopy as CopyIcon, Delete as DeleteIcon } from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";

type Playbook = {
  id: string;
  code: string;
  enabled: boolean;
  mode: "AUTOMATION" | "GUIDED";
  risk: "LOW" | "MEDIUM" | "HIGH";
  min_confidence: number | null;
  match_intents: string[] | null;
  match_categories: string[] | null;
  match_keywords: string[] | null;
  eligible_priorities: string[];
  approval_required: boolean;
  approval_title: string;
  approval_body: string;
  user_title: string;
  user_description: string;
  workflow_steps: any;
  updated_at: string;
};

type EditorMode = "create" | "edit";

const parseCsv = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const joinCsv = (arr: string[] | null | undefined): string => (arr && arr.length ? arr.join(", ") : "");

export const AutofixCatalog: React.FC = () => {
  const [rows, setRows] = React.useState<Playbook[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editorMode, setEditorMode] = React.useState<EditorMode>("create");
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<any>({
    code: "",
    enabled: true,
    mode: "GUIDED",
    risk: "LOW",
    match_intents: "",
    match_categories: "",
    match_keywords: "",
    min_confidence: "0.75",
    eligible_priorities: "LOW, MEDIUM",
    approval_required: true,
    approval_title: "",
    approval_body: "",
    user_title: "",
    user_description: "",
    workflow_steps: "[]",
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<Playbook[]>("/autofix/catalog");
      setRows(res.data || []);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load autofix catalog"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditorMode("create");
    setEditingId(null);
    setForm({
      code: "",
      enabled: true,
      mode: "GUIDED",
      risk: "LOW",
      match_intents: "",
      match_categories: "",
      match_keywords: "",
      min_confidence: "0.75",
      eligible_priorities: "LOW, MEDIUM",
      approval_required: true,
      approval_title: "",
      approval_body: "",
      user_title: "",
      user_description: "",
      workflow_steps: "[]",
    });
    setDialogOpen(true);
  };

  const openEdit = (p: Playbook) => {
    setEditorMode("edit");
    setEditingId(p.id);
    setForm({
      code: p.code,
      enabled: p.enabled,
      mode: p.mode,
      risk: p.risk,
      match_intents: joinCsv(p.match_intents),
      match_categories: joinCsv(p.match_categories),
      match_keywords: joinCsv(p.match_keywords),
      min_confidence: p.min_confidence == null ? "" : String(p.min_confidence),
      eligible_priorities: (p.eligible_priorities || []).join(", "),
      approval_required: p.approval_required,
      approval_title: p.approval_title,
      approval_body: p.approval_body,
      user_title: p.user_title,
      user_description: p.user_description,
      workflow_steps: JSON.stringify(p.workflow_steps ?? [], null, 2),
    });
    setDialogOpen(true);
  };

  const toggleEnabled = async (p: Playbook) => {
    try {
      await api.patch(`/autofix/catalog/${p.id}`, { enabled: !p.enabled });
      await load();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "Failed to update playbook"));
    }
  };

  const clonePlaybook = async (p: Playbook) => {
    const newCode = window.prompt("New code for cloned playbook", `${p.code}_COPY`);
    if (!newCode) return;
    try {
      await api.post(`/autofix/catalog/${p.id}/clone`, { newCode });
      await load();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "Clone failed"));
    }
  };

  const deletePlaybook = async (p: Playbook) => {
    if (!window.confirm(`Delete playbook ${p.code}?`)) return;
    try {
      await api.delete(`/autofix/catalog/${p.id}`);
      await load();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "Delete failed"));
    }
  };

  const save = async () => {
    try {
      const payload: any = {
        enabled: Boolean(form.enabled),
        mode: form.mode,
        risk: form.risk,
        match_intents: form.match_intents ? parseCsv(form.match_intents) : null,
        match_categories: form.match_categories ? parseCsv(form.match_categories) : null,
        match_keywords: form.match_keywords ? parseCsv(form.match_keywords) : null,
        min_confidence: form.min_confidence === "" ? null : Number(form.min_confidence),
        eligible_priorities: parseCsv(form.eligible_priorities),
        approval_required: Boolean(form.approval_required),
        approval_title: String(form.approval_title || ""),
        approval_body: String(form.approval_body || ""),
        user_title: String(form.user_title || ""),
        user_description: String(form.user_description || ""),
        workflow_steps: JSON.parse(String(form.workflow_steps || "[]")),
      };

      if (editorMode === "create") {
        payload.code = String(form.code || "").trim();
        await api.post("/autofix/catalog", payload);
      } else {
        if (!editingId) return;
        await api.patch(`/autofix/catalog/${editingId}`, payload);
      }

      setDialogOpen(false);
      await load();
    } catch (e: unknown) {
      alert(getApiErrorMessage(e, "Save failed"));
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          AutoFix Catalog
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          New Playbook
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && <Typography color="text.secondary">Loading...</Typography>}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Mode</TableCell>
                <TableCell>Risk</TableCell>
                <TableCell>Min Conf</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!loading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography color="text.secondary" sx={{ py: 4 }}>
                      No playbooks yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell sx={{ fontWeight: 700 }}>{p.code}</TableCell>
                  <TableCell>
                    <Chip
                      label={p.enabled ? "Enabled" : "Disabled"}
                      color={p.enabled ? "success" : "default"}
                      size="small"
                      onClick={() => void toggleEnabled(p)}
                    />
                  </TableCell>
                  <TableCell>{p.mode}</TableCell>
                  <TableCell>{p.risk}</TableCell>
                  <TableCell>{p.min_confidence == null ? "-" : p.min_confidence.toFixed(2)}</TableCell>
                  <TableCell>{new Date(p.updated_at).toLocaleString()}</TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(p)} color="primary">
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Clone">
                        <IconButton size="small" onClick={() => void clonePlaybook(p)}>
                          <CopyIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => void deletePlaybook(p)} color="error">
                          <DeleteIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editorMode === "create" ? "Create Playbook" : "Edit Playbook"}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          {editorMode === "create" ? (
            <TextField
              label="Code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              fullWidth
              helperText="Unique identifier e.g. VPN_PROFILE_REFRESH"
            />
          ) : (
            <TextField label="Code" value={form.code} fullWidth disabled />
          )}

          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Switch checked={Boolean(form.enabled)} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />}
              label="Enabled"
            />
            <TextField
              label="Mode"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}
              placeholder="AUTOMATION or GUIDED"
              sx={{ minWidth: 220 }}
            />
            <TextField
              label="Risk"
              value={form.risk}
              onChange={(e) => setForm({ ...form, risk: e.target.value })}
              placeholder="LOW / MEDIUM / HIGH"
              sx={{ minWidth: 220 }}
            />
            <TextField
              label="Min confidence"
              value={form.min_confidence}
              onChange={(e) => setForm({ ...form, min_confidence: e.target.value })}
              sx={{ minWidth: 220 }}
            />
          </Box>

          <TextField
            label="Match intents (CSV)"
            value={form.match_intents}
            onChange={(e) => setForm({ ...form, match_intents: e.target.value })}
            fullWidth
          />
          <TextField
            label="Match categories (CSV)"
            value={form.match_categories}
            onChange={(e) => setForm({ ...form, match_categories: e.target.value })}
            fullWidth
          />
          <TextField
            label="Match keywords (CSV)"
            value={form.match_keywords}
            onChange={(e) => setForm({ ...form, match_keywords: e.target.value })}
            fullWidth
          />
          <TextField
            label="Eligible priorities (CSV)"
            value={form.eligible_priorities}
            onChange={(e) => setForm({ ...form, eligible_priorities: e.target.value })}
            fullWidth
            helperText="Example: LOW, MEDIUM"
          />

          <FormControlLabel
            control={
              <Switch
                checked={Boolean(form.approval_required)}
                onChange={(e) => setForm({ ...form, approval_required: e.target.checked })}
              />
            }
            label="Approval required"
          />

          <TextField
            label="Approval title"
            value={form.approval_title}
            onChange={(e) => setForm({ ...form, approval_title: e.target.value })}
            fullWidth
          />
          <TextField
            label="Approval body"
            value={form.approval_body}
            onChange={(e) => setForm({ ...form, approval_body: e.target.value })}
            fullWidth
            multiline
            minRows={2}
          />

          <TextField
            label="User modal title"
            value={form.user_title}
            onChange={(e) => setForm({ ...form, user_title: e.target.value })}
            fullWidth
          />
          <TextField
            label="User modal description"
            value={form.user_description}
            onChange={(e) => setForm({ ...form, user_description: e.target.value })}
            fullWidth
            multiline
            minRows={2}
          />

          <TextField
            label="Workflow steps (JSON)"
            value={form.workflow_steps}
            onChange={(e) => setForm({ ...form, workflow_steps: e.target.value })}
            fullWidth
            multiline
            minRows={6}
            helperText="Array of workflow step objects"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void save()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
