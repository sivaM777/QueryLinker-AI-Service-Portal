import React from "react";
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  Switch,
  FormControlLabel,
} from "@mui/material";
import { Add, Edit, Delete, CheckCircle, Cancel } from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";

interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  category_filter: string[] | null;
  priority_filter: string[] | null;
  keyword_filter: string[] | null;
  urgency_keywords: string[] | null;
  assigned_team_id: string | null;
  assigned_agent_id: string | null;
  auto_priority: string | null;
  description: string | null;
}

export const RoutingRules: React.FC = () => {
  const [rules, setRules] = React.useState<RoutingRule[]>([]);
  const [teams, setTeams] = React.useState<Array<{ id: string; name: string }>>([]);
  const [agents, setAgents] = React.useState<Array<{ id: string; name: string; email: string }>>([]);
  const [, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RoutingRule | null>(null);

  const [formData, setFormData] = React.useState({
    name: "",
    priority: 0,
    enabled: true,
    category_filter: [] as string[],
    priority_filter: [] as string[],
    keyword_filter: [] as string[],
    urgency_keywords: [] as string[],
    assigned_team_id: "",
    assigned_agent_id: "",
    auto_priority: "",
    description: "",
  });

  React.useEffect(() => {
    loadRules();
    loadTeams();
    loadAgents();
  }, []);

  const loadRules = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<RoutingRule[]>("/routing/rules");
      setRules(res.data);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load routing rules"));
    } finally {
      setLoading(false);
    }
  };

  const loadTeams = async () => {
    try {
      const res = await api.get<Array<{ id: string; name: string }>>("/teams");
      setTeams(res.data);
    } catch (e: unknown) {
      console.error("Failed to load teams:", e);
    }
  };

  const loadAgents = async () => {
    try {
      const res = await api.get<Array<{ id: string; name: string; email: string }>>("/users");
      const agentsData = res.data.filter((u: any) => u.role === "AGENT" || u.role === "ADMIN");
      setAgents(agentsData);
    } catch (e: unknown) {
      console.error("Failed to load agents:", e);
    }
  };

  const handleOpen = (rule?: RoutingRule) => {
    if (rule) {
      setEditing(rule);
      setFormData({
        name: rule.name,
        priority: rule.priority,
        enabled: rule.enabled,
        category_filter: rule.category_filter || [],
        priority_filter: rule.priority_filter || [],
        keyword_filter: rule.keyword_filter || [],
        urgency_keywords: rule.urgency_keywords || [],
        assigned_team_id: rule.assigned_team_id || "",
        assigned_agent_id: rule.assigned_agent_id || "",
        auto_priority: rule.auto_priority || "",
        description: rule.description || "",
      });
    } else {
      setEditing(null);
      setFormData({
        name: "",
        priority: 0,
        enabled: true,
        category_filter: [],
        priority_filter: [],
        keyword_filter: [],
        urgency_keywords: [],
        assigned_team_id: "",
        assigned_agent_id: "",
        auto_priority: "",
        description: "",
      });
    }
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    try {
      const payload = {
        ...formData,
        category_filter: formData.category_filter.length > 0 ? formData.category_filter : null,
        priority_filter: formData.priority_filter.length > 0 ? formData.priority_filter : null,
        keyword_filter: formData.keyword_filter.length > 0 ? formData.keyword_filter : null,
        urgency_keywords: formData.urgency_keywords.length > 0 ? formData.urgency_keywords : null,
        assigned_team_id: formData.assigned_team_id || null,
        assigned_agent_id: formData.assigned_agent_id || null,
        auto_priority: formData.auto_priority || null,
      };

      if (editing) {
        await api.patch(`/routing/rules/${editing.id}`, payload);
      } else {
        await api.post("/routing/rules", payload);
      }

      handleClose();
      loadRules();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to save routing rule"));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this routing rule?")) return;

    try {
      await api.delete(`/routing/rules/${id}`);
      loadRules();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to delete routing rule"));
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Routing Rules</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={() => handleOpen()}>
          Add Rule
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Category Filter</TableCell>
              <TableCell>Assigned To</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{rule.name}</TableCell>
                <TableCell>{rule.priority}</TableCell>
                <TableCell>
                  {rule.category_filter && rule.category_filter.length > 0 ? (
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {rule.category_filter.map((cat) => (
                        <Chip key={cat} label={cat} size="small" />
                      ))}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Any
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {rule.assigned_team_id
                    ? teams.find((t) => t.id === rule.assigned_team_id)?.name || "Unknown Team"
                    : rule.assigned_agent_id
                      ? agents.find((a) => a.id === rule.assigned_agent_id)?.name || "Unknown Agent"
                      : "None"}
                </TableCell>
                <TableCell>
                  {rule.enabled ? (
                    <Chip icon={<CheckCircle />} label="Enabled" color="success" size="small" />
                  ) : (
                    <Chip icon={<Cancel />} label="Disabled" color="default" size="small" />
                  )}
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => handleOpen(rule)}>
                    <Edit />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDelete(rule.id)} color="error">
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>{editing ? "Edit Routing Rule" : "Create Routing Rule"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
            <TextField
              label="Rule Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
            />

            <TextField
              label="Priority"
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
              fullWidth
              helperText="Higher priority rules are evaluated first"
            />

            <FormControlLabel
              control={
                <Switch
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                />
              }
              label="Enabled"
            />

            <TextField
              label="Category Filter (comma-separated)"
              value={formData.category_filter.join(", ")}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  category_filter: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              fullWidth
              placeholder="Network, Software, Hardware"
              helperText="Leave empty to match any category"
            />

            <FormControl fullWidth>
              <InputLabel>Priority Filter</InputLabel>
              <Select
                multiple
                value={formData.priority_filter}
                onChange={(e) => setFormData({ ...formData, priority_filter: e.target.value as string[] })}
                renderValue={(selected) => (selected as string[]).join(", ")}
              >
                <MenuItem value="LOW">Low</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="HIGH">High</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Keyword Filter (comma-separated)"
              value={formData.keyword_filter.join(", ")}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  keyword_filter: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              fullWidth
              placeholder="urgent, critical, down"
            />

            <TextField
              label="Urgency Keywords (comma-separated)"
              value={formData.urgency_keywords.join(", ")}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  urgency_keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              fullWidth
              placeholder="critical, outage, escalation"
              helperText="Used for urgency detection when no rule matches."
            />

            <FormControl fullWidth>
              <InputLabel>Assign to Team</InputLabel>
              <Select
                value={formData.assigned_team_id}
                onChange={(e) => setFormData({ ...formData, assigned_team_id: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                {teams.map((team) => (
                  <MenuItem key={team.id} value={team.id}>
                    {team.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Assign to Agent</InputLabel>
              <Select
                value={formData.assigned_agent_id}
                onChange={(e) => setFormData({ ...formData, assigned_agent_id: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                {agents.map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agent.name} ({agent.email})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Auto Priority</InputLabel>
              <Select
                value={formData.auto_priority}
                onChange={(e) => setFormData({ ...formData, auto_priority: e.target.value })}
              >
                <MenuItem value="">None</MenuItem>
                <MenuItem value="LOW">Low</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="HIGH">High</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              fullWidth
              multiline
              rows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
