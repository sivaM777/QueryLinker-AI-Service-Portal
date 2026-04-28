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
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Tooltip,
  Stack,
  Grid,
  Autocomplete,
} from "@mui/material";
import { Add, Edit, Delete, ArrowUpward } from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";

type SupportLevel = 'L1' | 'L2' | 'L3';

type TeamRow = {
  id: string;
  name: string;
  support_level: SupportLevel | null;
  escalation_team_id: string | null;
  auto_escalate_minutes: number | null;
  parent_team_id: string | null;
  manager_id: string | null;
  description: string | null;
  roles_and_responsibilities: string[] | null;
  created_at: string;
  manager_name?: string | null;
  manager_email?: string | null;
};

type TeamWithEscalation = TeamRow & {
  escalation_team_name?: string;
  parent_team_name?: string;
};

type ManagerOption = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar_url?: string | null;
};

const RESPONSIBILITY_OPTIONS: Record<SupportLevel, string[]> = {
  L1: [
    "Password resets and account unlocks",
    "Ticket intake and categorization",
    "Basic workstation troubleshooting",
    "Email and collaboration support",
    "Knowledge base guidance",
    "First-contact resolution",
  ],
  L2: [
    "Advanced application troubleshooting",
    "Server and infrastructure support",
    "Network and VPN issue resolution",
    "Escalated incident handling",
    "Root cause investigation",
    "Change implementation support",
  ],
  L3: [
    "Architecture-level troubleshooting",
    "Problem management and RCA",
    "Major incident leadership",
    "Automation and platform engineering",
    "Security and compliance escalation",
    "Vendor and expert coordination",
  ],
};

export const Teams: React.FC = () => {
  const [teams, setTeams] = React.useState<TeamWithEscalation[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TeamRow | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmTeam, setConfirmTeam] = React.useState<TeamRow | null>(null);
  
  const [name, setName] = React.useState("");
  const [supportLevel, setSupportLevel] = React.useState<"L1" | "L2" | "L3" | "">("");
  const [autoEscalateMinutes, setAutoEscalateMinutes] = React.useState("");
  const [parentTeamId, setParentTeamId] = React.useState("");
  const [escalationTeamId, setEscalationTeamId] = React.useState("");
  const [managerId, setManagerId] = React.useState("");
  const [managerSearch, setManagerSearch] = React.useState("");
  const [managerOptions, setManagerOptions] = React.useState<ManagerOption[]>([]);
  const [managerLoading, setManagerLoading] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [responsibilities, setResponsibilities] = React.useState<string[]>([]);
  const [newResp, setNewResp] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const teamsRes = await api.get<TeamRow[]>("/teams");
      const rawTeams = teamsRes.data || [];
      
      const teamsWithEscalation = rawTeams.map(team => {
        const escalationTeam = rawTeams.find(t => t.id === team.escalation_team_id);
        const parentTeam = rawTeams.find(t => t.id === team.parent_team_id);
        return {
          ...team,
          escalation_team_name: escalationTeam?.name,
          parent_team_name: parentTeam?.name
        };
      });
      
      setTeams(teamsWithEscalation);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load teams"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!supportLevel) {
      setParentTeamId("");
      setEscalationTeamId("");
      return;
    }

    setParentTeamId((current) => {
      if (!current) return current;
      const parent = teams.find((team) => team.id === current);
      return parent && parent.support_level === supportLevel && !parent.parent_team_id ? current : "";
    });

    setEscalationTeamId((current) => {
      if (!current) return current;
      const team = teams.find((item) => item.id === current);
      if (!team?.support_level) return "";
      const rank = supportLevel === "L1" ? 1 : supportLevel === "L2" ? 2 : 3;
      const nextRank = team.support_level === "L1" ? 1 : team.support_level === "L2" ? 2 : 3;
      return nextRank > rank ? current : "";
    });
  }, [supportLevel, teams]);

  React.useEffect(() => {
    if (!supportLevel || editing) return;
    setAutoEscalateMinutes((current) => {
      if (current.trim()) return current;
      if (supportLevel === "L1") return "30";
      if (supportLevel === "L2") return "60";
      return "120";
    });
  }, [editing, supportLevel]);

  const loadManagerOptions = React.useCallback(async (search: string) => {
    setManagerLoading(true);
    try {
      const res = await api.get<ManagerOption[]>("/users/managers/search", {
        params: { q: search, limit: 10 },
      });
      setManagerOptions(res.data || []);
    } catch {
      setManagerOptions([]);
    } finally {
      setManagerLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      void loadManagerOptions(managerSearch.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadManagerOptions, managerSearch, open]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setSupportLevel("");
    setAutoEscalateMinutes("");
    setParentTeamId("");
    setEscalationTeamId("");
    setManagerId("");
    setManagerSearch("");
    setDescription("");
    setResponsibilities([]);
    setNewResp("");
    setOpen(true);
  };

  const openEdit = (t: TeamRow) => {
    setEditing(t);
    setName(t.name);
    setSupportLevel(t.support_level || "");
    setAutoEscalateMinutes(t.auto_escalate_minutes?.toString() || "");
    setParentTeamId(t.parent_team_id || "");
    setEscalationTeamId(t.escalation_team_id || "");
    setManagerId(t.manager_id || "");
    setManagerSearch(t.manager_name || "");
    setDescription(t.description || "");
    setResponsibilities(t.roles_and_responsibilities || []);
    setNewResp("");
    if (t.manager_id && t.manager_name && t.manager_email) {
      const existingManager: ManagerOption = {
        id: t.manager_id,
        name: t.manager_name,
        email: t.manager_email,
        role: "MANAGER",
      };
      setManagerOptions((current) => {
        if (current.some((option) => option.id === t.manager_id)) return current;
        return [existingManager, ...current];
      });
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  const save = async () => {
    setError("");
    try {
      const payload: any = {
        name: name.trim(),
        support_level: supportLevel || null,
        escalation_team_id: escalationTeamId || null,
        auto_escalate_minutes: autoEscalateMinutes ? parseInt(autoEscalateMinutes) : null,
        parent_team_id: parentTeamId || null,
        manager_id: managerId || null,
        description: description.trim() || null,
        roles_and_responsibilities: responsibilities
      };
      
      if (editing) {
        await api.patch(`/teams/${editing.id}`, payload);
      } else {
        await api.post("/teams", payload);
      }
      close();
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to save team"));
    }
  };

  const remove = async (team: TeamRow) => {
    setError("");
    try {
      await api.delete(`/teams/${team.id}`);
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to delete team"));
    }
  };

  const addResponsibility = () => {
    if (newResp.trim()) {
      const next = newResp.trim();
      if (responsibilities.includes(next)) {
        setNewResp("");
        return;
      }
      setResponsibilities([...responsibilities, next]);
      setNewResp("");
    }
  };

  const removeResponsibility = (index: number) => {
    setResponsibilities(responsibilities.filter((_, i) => i !== index));
  };

  const groupedTeams = React.useMemo(() => {
    const levels = {
      L1: teams.filter(t => t.support_level === 'L1'),
      L2: teams.filter(t => t.support_level === 'L2'),
      L3: teams.filter(t => t.support_level === 'L3'),
      Other: teams.filter(t => !t.support_level)
    };
    return levels;
  }, [teams]);

  const parentTeamOptions = React.useMemo(
    () =>
      teams.filter(
        (team) =>
          team.id !== editing?.id &&
          !team.parent_team_id &&
          (!!supportLevel ? team.support_level === supportLevel : true)
      ),
    [editing?.id, supportLevel, teams]
  );

  const escalationTeamOptions = React.useMemo(() => {
    if (!supportLevel) return [];
    const currentRank = supportLevel === "L1" ? 1 : supportLevel === "L2" ? 2 : 3;
    return teams.filter((team) => {
      if (team.id === editing?.id) return false;
      if (!team.support_level) return false;
      const teamRank = team.support_level === "L1" ? 1 : team.support_level === "L2" ? 2 : 3;
      return teamRank > currentRank;
    });
  }, [editing?.id, supportLevel, teams]);

  const responsibilityOptions = React.useMemo(
    () => (supportLevel ? RESPONSIBILITY_OPTIONS[supportLevel] : []),
    [supportLevel]
  );

  const selectedManager = React.useMemo(
    () => managerOptions.find((option) => option.id === managerId) || null,
    [managerId, managerOptions]
  );

  const renderTeamRow = (t: TeamWithEscalation, indent = 0) => (
    <React.Fragment key={t.id}>
      <TableRow>
        <TableCell sx={{ pl: indent * 4 + 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography sx={{ fontWeight: indent === 0 ? 600 : 400 }}>{t.name}</Typography>
            {t.support_level && (
              <Chip 
                label={t.support_level} 
                size="small" 
                color={t.support_level === 'L1' ? 'primary' : t.support_level === 'L2' ? 'secondary' : 'warning'}
              />
            )}
          </Stack>
          {t.description && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t.description}
            </Typography>
          )}
        </TableCell>
        <TableCell>
          {t.support_level || "-"}
        </TableCell>
        <TableCell>
          {t.auto_escalate_minutes ? `${t.auto_escalate_minutes} min` : "-"}
        </TableCell>
        <TableCell>
          {t.manager_name ? (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t.manager_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t.manager_email}
              </Typography>
            </Box>
          ) : "-"}
        </TableCell>
        <TableCell>
          {t.escalation_team_name ? (
            <Stack direction="row" alignItems="center" spacing={1}>
              <ArrowUpward fontSize="small" color="action" />
              <Typography variant="body2">{t.escalation_team_name}</Typography>
            </Stack>
          ) : "-"}
        </TableCell>
        <TableCell>{new Date(t.created_at).toLocaleString()}</TableCell>
        <TableCell align="right">
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => openEdit(t)}>
              <Edit />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" color="error" onClick={() => { setConfirmTeam(t); setConfirmOpen(true); }}>
              <Delete />
            </IconButton>
          </Tooltip>
        </TableCell>
      </TableRow>
      {teams
        .filter(sub => sub.parent_team_id === t.id)
        .map(sub => renderTeamRow(sub, indent + 1))}
    </React.Fragment>
  );

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Teams</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openCreate} sx={{ borderRadius: 2 }}>
          Add Team
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {loading && <Typography color="text.secondary">Loading...</Typography>}

      <TableContainer component={Paper} sx={{ borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
              <TableCell sx={{ fontWeight: 700 }}>Team / Sub-team</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Support Level</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Auto Escalate</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Managed By</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Escalates To</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Created</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && teams.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography color="text.secondary">No teams found.</Typography>
                </TableCell>
              </TableRow>
            )}
            
            {(['L1', 'L2', 'L3', 'Other'] as const).map(level => {
              const levelTeams = level === 'Other' ? groupedTeams.Other : groupedTeams[level as keyof typeof groupedTeams];
              if (levelTeams.length === 0) return null;
              
              return (
                <React.Fragment key={level}>
                  <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                    <TableCell colSpan={7} sx={{ py: 1 }}>
                      <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1 }}>
                        {level === 'Other' ? 'General Teams' : `${level} Support`}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  {levelTeams
                    .filter(t => !t.parent_team_id)
                    .map(t => renderTeamRow(t))}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={close} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 700 }}>{editing ? `Edit Team: ${editing.name}` : "Create Team"}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={3} sx={{ pt: 1 }}>
            <Grid item xs={12} md={6}>
              <Stack spacing={2}>
                <TextField
                  label="Team Name"
                  placeholder="e.g. L1 - Service Desk North"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                  required
                />
                
                <FormControl fullWidth>
                  <InputLabel>Support Level</InputLabel>
                  <Select
                    value={supportLevel}
                    label="Support Level"
                    onChange={(e) => setSupportLevel(e.target.value as "L1" | "L2" | "L3" | "")}
                  >
                    <MenuItem value="">None</MenuItem>
                    <MenuItem value="L1">L1 - First Line Support</MenuItem>
                    <MenuItem value="L2">L2 - Technical Support</MenuItem>
                    <MenuItem value="L3">L3 - Expert Support</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Parent Team (for sub-teams)</InputLabel>
                  <Select
                    value={parentTeamId}
                    label="Parent Team (for sub-teams)"
                    onChange={(e) => setParentTeamId(e.target.value)}
                  >
                    <MenuItem value="">None (Top Level)</MenuItem>
                    {parentTeamOptions.map(t => (
                        <MenuItem key={t.id} value={t.id}>{t.name} ({t.support_level || 'General'})</MenuItem>
                      ))}
                  </Select>
                </FormControl>

                <Autocomplete
                  options={managerOptions}
                  value={selectedManager}
                  loading={managerLoading}
                  inputValue={managerSearch}
                  onInputChange={(_, value, reason) => {
                    if (reason === "reset" && selectedManager) {
                      setManagerSearch(selectedManager.name);
                      return;
                    }
                    setManagerSearch(value);
                  }}
                  onChange={(_, value) => {
                    setManagerId(value?.id || "");
                    setManagerSearch(value?.name || "");
                  }}
                  getOptionLabel={(option) =>
                    typeof option === "string" ? option : `${option.name} (${option.email})`
                  }
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Team Manager"
                      placeholder="Type manager name or email"
                      required
                      helperText="Search the database to assign the manager who owns this team"
                    />
                  )}
                  renderOption={(props, option) => (
                    <Box component="li" {...props}>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {option.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {option.email} • {option.role}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                  fullWidth
                />

                <FormControl fullWidth disabled={!supportLevel || supportLevel === "L3"}>
                  <InputLabel>Escalates To</InputLabel>
                  <Select
                    value={escalationTeamId}
                    label="Escalates To"
                    onChange={(e) => setEscalationTeamId(e.target.value)}
                  >
                    <MenuItem value="">None</MenuItem>
                    {escalationTeamOptions.map((team) => (
                      <MenuItem key={team.id} value={team.id}>
                        {team.name} ({team.support_level})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                
                <TextField
                  label="Auto Escalate (minutes)"
                  value={autoEscalateMinutes}
                  onChange={(e) => setAutoEscalateMinutes(e.target.value)}
                  type="number"
                  helperText="Minutes after which tickets are automatically escalated"
                  InputProps={{ inputProps: { min: 5, max: 1440 } }}
                />
              </Stack>
            </Grid>

            <Grid item xs={12} md={6}>
              <Stack spacing={2}>
                <TextField
                  label="Description / Responsibilities Overview"
                  placeholder="Describe what this team does..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  fullWidth
                  multiline
                  rows={3}
                />

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Roles & Responsibilities</Typography>
                  <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                    <Autocomplete
                      size="small"
                      options={responsibilityOptions}
                      value={newResp || null}
                      onChange={(_, value) => setNewResp(value || "")}
                      inputValue={newResp}
                      onInputChange={(_, value) => setNewResp(value)}
                      openOnFocus
                      filterSelectedOptions
                      freeSolo={false}
                      fullWidth
                      disabled={!supportLevel}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={supportLevel ? "Add responsibility" : "Select support level first"}
                        />
                      )}
                    />
                    <Button variant="outlined" onClick={addResponsibility} disabled={!newResp.trim() || !supportLevel}>Add</Button>
                  </Stack>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {responsibilities.map((r, i) => (
                      <Chip
                        key={i}
                        label={r}
                        onDelete={() => removeResponsibility(i)}
                        size="small"
                        sx={{ borderRadius: 1 }}
                      />
                    ))}
                    {responsibilities.length === 0 && (
                      <Typography variant="caption" color="text.secondary">No specific responsibilities added yet.</Typography>
                    )}
                  </Box>
                </Box>
              </Stack>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={close}>Cancel</Button>
          <Button onClick={() => void save()} variant="contained" disabled={!name.trim() || !managerId} sx={{ borderRadius: 2, px: 4 }}>
            Save Team
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete Team</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete the team "{confirmTeam?.name}"?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirmOpen(false); setConfirmTeam(null); }}>Cancel</Button>
          <Button
            onClick={async () => {
              if (confirmTeam) await remove(confirmTeam);
              setConfirmOpen(false);
              setConfirmTeam(null);
            }}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
