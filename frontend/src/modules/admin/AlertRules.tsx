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
} from "@mui/material";
import { Add, Edit, Delete, CheckCircle, Cancel } from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";

interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  event_type: string;
  conditions: Record<string, any>;
  channels: string[] | string; // Can be array or PostgreSQL array string format
  recipient_user_ids: string[] | null;
  recipient_team_ids: string[] | null;
  recipient_roles: string[] | null;
  recipient_emails: string[] | null;
  recipient_phones: string[] | null;
  webhook_url: string | null;
  description: string | null;
}

export const AlertRules: React.FC = () => {
  const [rules, setRules] = React.useState<AlertRule[]>([]);
  const [teams, setTeams] = React.useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = React.useState<Array<{ id: string; name: string; email: string }>>([]);
  const [, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AlertRule | null>(null);
  const [conditionsText, setConditionsText] = React.useState("{}");

  const [formData, setFormData] = React.useState({
    name: "",
    enabled: true,
    priority: 0,
    event_type: "TICKET_CREATED",
    conditions: {} as Record<string, any>,
    channels: ["EMAIL"] as string[],
    recipient_user_ids: [] as string[],
    recipient_team_ids: [] as string[],
    recipient_roles: [] as string[],
    recipient_emails: [] as string[],
    recipient_phones: [] as string[],
    webhook_url: "",
    description: "",
  });

  React.useEffect(() => {
    loadRules();
    loadTeams();
    loadUsers();
  }, []);

  const loadRules = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<AlertRule[]>("/alerts/rules");
      setRules(res.data);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load alert rules"));
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

  const loadUsers = async () => {
    try {
      const res = await api.get<Array<{ id: string; name: string; email: string }>>("/users");
      setUsers(res.data);
    } catch (e: unknown) {
      console.error("Failed to load users:", e);
    }
  };


  const handleOpen = (rule?: AlertRule) => {
    if (rule) {
      setEditing(rule);
      setFormData({
        name: rule.name,
        enabled: rule.enabled,
        priority: rule.priority,
        event_type: rule.event_type,
        conditions: rule.conditions || {},
        channels: Array.isArray(rule.channels) ? rule.channels : (rule.channels ? [rule.channels] : ["EMAIL"]),
        recipient_user_ids: rule.recipient_user_ids || [],
        recipient_team_ids: rule.recipient_team_ids || [],
        recipient_roles: Array.isArray(rule.recipient_roles) ? rule.recipient_roles : [],
        recipient_emails: Array.isArray(rule.recipient_emails) ? rule.recipient_emails : [],
        recipient_phones: Array.isArray(rule.recipient_phones) ? rule.recipient_phones : [],
        webhook_url: rule.webhook_url || "",
        description: rule.description || "",
      });
      setConditionsText(JSON.stringify(rule.conditions || {}, null, 2));
    } else {
      setEditing(null);
      setFormData({
        name: "",
        enabled: true,
        priority: 0,
        event_type: "TICKET_CREATED",
        conditions: {},
        channels: ["EMAIL"],
        recipient_user_ids: [],
        recipient_team_ids: [],
        recipient_roles: [],
        recipient_emails: [],
        recipient_phones: [],
        webhook_url: "",
        description: "",
      });
      setConditionsText("{}");
    }
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    try {
      let parsedConditions: Record<string, any> = {};
      try {
        parsedConditions = conditionsText.trim() ? JSON.parse(conditionsText) : {};
      } catch {
        setError("Conditions must be valid JSON.");
        return;
      }

      const payload = {
        ...formData,
        conditions: parsedConditions,
        recipient_user_ids: formData.recipient_user_ids.length > 0 ? formData.recipient_user_ids : null,
        recipient_team_ids: formData.recipient_team_ids.length > 0 ? formData.recipient_team_ids : null,
        recipient_roles: formData.recipient_roles.length > 0 ? formData.recipient_roles : null,
        recipient_emails: formData.recipient_emails.length > 0 ? formData.recipient_emails : null,
        recipient_phones: formData.recipient_phones.length > 0 ? formData.recipient_phones : null,
        webhook_url: formData.webhook_url || null,
      };

      if (editing) {
        await api.patch(`/alerts/rules/${editing.id}`, payload);
      } else {
        await api.post("/alerts/rules", payload);
      }

      handleClose();
      loadRules();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to save alert rule"));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this alert rule?")) return;

    try {
      await api.delete(`/alerts/rules/${id}`);
      loadRules();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to delete alert rule"));
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4">Alert Rules</Typography>
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
              <TableCell>Event Type</TableCell>
              <TableCell>Channels</TableCell>
              <TableCell>Recipients</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell>{rule.name}</TableCell>
                <TableCell>
                  <Chip label={rule.event_type.replace(/_/g, " ")} size="small" />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                    {(() => {
                      let channelsArray: string[] = [];
                      if (Array.isArray(rule.channels)) {
                        channelsArray = rule.channels;
                      } else if (typeof rule.channels === 'string') {
                        // Parse PostgreSQL array format: {EMAIL,IN_APP} or ["EMAIL","IN_APP"]
                        const str = rule.channels.trim();
                        if (str.startsWith('{') && str.endsWith('}')) {
                          channelsArray = str.slice(1, -1).split(',').map((s: string) => s.trim());
                        } else if (str.startsWith('[') && str.endsWith(']')) {
                          try {
                            channelsArray = JSON.parse(str);
                          } catch {
                            channelsArray = [];
                          }
                        }
                      } else if (rule.channels) {
                        // Fallback: try to convert to array
                        channelsArray = [String(rule.channels)];
                      }
                      return channelsArray.length > 0 ? channelsArray.map((ch) => (
                        <Chip key={ch} label={ch} size="small" />
                      )) : (
                        <Chip label="N/A" size="small" />
                      );
                    })()}
                  </Box>
                </TableCell>
                <TableCell>
                  {Array.isArray(rule.recipient_roles) && rule.recipient_roles.length > 0
                    ? `Roles: ${rule.recipient_roles.join(", ")}`
                    : Array.isArray(rule.recipient_team_ids) && rule.recipient_team_ids.length > 0
                      ? `${rule.recipient_team_ids.length} team(s)`
                      : Array.isArray(rule.recipient_user_ids) && rule.recipient_user_ids.length > 0
                        ? `${rule.recipient_user_ids.length} user(s)`
                        : Array.isArray(rule.recipient_emails) && rule.recipient_emails.length > 0
                          ? `${rule.recipient_emails.length} email(s)`
                          : Array.isArray(rule.recipient_phones) && rule.recipient_phones.length > 0
                            ? `${rule.recipient_phones.length} phone(s)`
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
        <DialogTitle>{editing ? "Edit Alert Rule" : "Create Alert Rule"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
            <TextField
              label="Rule Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              fullWidth
              required
            />

            <FormControl fullWidth>
              <InputLabel>Event Type</InputLabel>
              <Select
                value={formData.event_type}
                onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
              >
                <MenuItem value="TICKET_CREATED">Ticket Created</MenuItem>
                <MenuItem value="TICKET_ASSIGNED">Ticket Assigned</MenuItem>
                <MenuItem value="TICKET_STATUS_CHANGED">Ticket Status Changed</MenuItem>
                <MenuItem value="TICKET_RESOLVED">Ticket Resolved</MenuItem>
                <MenuItem value="TICKET_CLOSED">Ticket Closed</MenuItem>
                <MenuItem value="TICKET_COMMENTED">Ticket Commented</MenuItem>
                <MenuItem value="TICKET_ESCALATED">Ticket Escalated</MenuItem>
                <MenuItem value="SLA_FIRST_RESPONSE_BREACH">SLA First Response Breach</MenuItem>
                <MenuItem value="SLA_RESOLUTION_BREACH">SLA Resolution Breach</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Channels</InputLabel>
              <Select
                multiple
                value={formData.channels}
                onChange={(e) => setFormData({ ...formData, channels: e.target.value as string[] })}
                renderValue={(selected) => (selected as string[]).join(", ")}
              >
                <MenuItem value="EMAIL">Email</MenuItem>
                <MenuItem value="SMS">SMS</MenuItem>
                <MenuItem value="IN_APP">In-App</MenuItem>
                <MenuItem value="WEBHOOK">Webhook</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Recipient Roles</InputLabel>
              <Select
                multiple
                value={formData.recipient_roles}
                onChange={(e) => setFormData({ ...formData, recipient_roles: e.target.value as string[] })}
                renderValue={(selected) => (selected as string[]).join(", ")}
              >
                <MenuItem value="EMPLOYEE">Employee</MenuItem>
                <MenuItem value="AGENT">Agent</MenuItem>
                <MenuItem value="ADMIN">Admin</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Recipient Teams</InputLabel>
              <Select
                multiple
                value={formData.recipient_team_ids}
                onChange={(e) => setFormData({ ...formData, recipient_team_ids: e.target.value as string[] })}
                renderValue={(selected) =>
                  (selected as string[])
                    .map((id) => teams.find((t) => t.id === id)?.name || id)
                    .join(", ")
                }
              >
                {teams.map((team) => (
                  <MenuItem key={team.id} value={team.id}>
                    {team.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel>Recipient Users</InputLabel>
              <Select
                multiple
                value={formData.recipient_user_ids}
                onChange={(e) => setFormData({ ...formData, recipient_user_ids: e.target.value as string[] })}
                renderValue={(selected) =>
                  (selected as string[])
                    .map((id) => users.find((u) => u.id === id)?.email || id)
                    .join(", ")
                }
              >
                {users.map((user) => (
                  <MenuItem key={user.id} value={user.id}>
                    {user.name} ({user.email})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Conditions (JSON)"
              value={conditionsText}
              onChange={(e) => setConditionsText(e.target.value)}
              fullWidth
              multiline
              minRows={3}
              placeholder='{"priority":"HIGH","status":"OPEN"}'
              helperText="Match ticket fields using exact values or arrays. Leave {} for all tickets."
            />

            <TextField
              label="Recipient Emails (comma-separated)"
              value={formData.recipient_emails.join(", ")}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  recipient_emails: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              fullWidth
              placeholder="admin@company.com, support@company.com"
            />

            <TextField
              label="Recipient Phones (comma-separated)"
              value={formData.recipient_phones.join(", ")}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  recipient_phones: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                })
              }
              fullWidth
              placeholder="+1234567890, +0987654321"
            />

            {formData.channels.includes("WEBHOOK") && (
              <TextField
                label="Webhook URL"
                value={formData.webhook_url}
                onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })}
                fullWidth
                type="url"
              />
            )}

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
