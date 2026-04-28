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
  Alert,
  Chip,
  Stack,
  Divider,
  Autocomplete,
  FormHelperText,
} from "@mui/material";
import { Add, Edit, Delete } from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";
import { UserAvatar } from "../../components/UserAvatar";
import { useAuth } from "../../services/auth";

type UserRole = "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  team_id: string | null;
  manager_id?: string | null;
  phone: string | null;
  department: string | null;
  location: string | null;
  bio: string | null;
  avatar_url: string | null;
  availability_status: "ONLINE" | "BUSY" | "OFFLINE" | "ON_BREAK" | "AWAY" | null;
  max_concurrent_tickets: number | null;
  certifications: string[] | null;
  hire_date: string | null;
  created_at: string;
};

type TeamRow = {
  id: string;
  name: string;
  created_at: string;
};

type ManagerOption = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  team_id: string | null;
  manager_id?: string | null;
  avatar_url?: string | null;
};

export const Users: React.FC = () => {
  const { user } = useAuth();
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [teams, setTeams] = React.useState<TeamRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmUser, setConfirmUser] = React.useState<UserRow | null>(null);
  const [managerOptions, setManagerOptions] = React.useState<ManagerOption[]>([]);
  const [managerSearch, setManagerSearch] = React.useState("");
  const [managerLoading, setManagerLoading] = React.useState(false);
  const [dialogError, setDialogError] = React.useState("");

  const [form, setForm] = React.useState({
    name: "",
    email: "",
    role: "EMPLOYEE" as UserRole,
    team_id: "",
    manager_id: "",
    password: "",
    phone: "",
    department: "",
    location: "",
    bio: "",
    avatar_url: "",
    availability_status: "ONLINE" as "ONLINE" | "BUSY" | "OFFLINE" | "ON_BREAK" | "AWAY",
    max_concurrent_tickets: 5,
    certifications: [] as string[],
    hire_date: "",
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [uRes, tRes] = await Promise.all([
        api.get<UserRow[]>("/users"),
        api.get<TeamRow[]>("/teams"),
      ]);
      setUsers(uRes.data || []);
      setTeams(tRes.data || []);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load users"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 30000);
    return () => window.clearInterval(interval);
  }, [load]);

  const isManagerViewer = user?.role === "MANAGER";
  const roleOptions = React.useMemo(
    () => (isManagerViewer ? (["AGENT"] as UserRole[]) : (["EMPLOYEE", "AGENT", "MANAGER", "ADMIN"] as UserRole[])),
    [isManagerViewer]
  );
  const needsManager = form.role === "EMPLOYEE" || form.role === "AGENT";
  const needsTeam = form.role === "AGENT" || form.role === "MANAGER";

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

  React.useEffect(() => {
    if (!open) return;
    if (isManagerViewer) {
      setForm((prev) => ({ ...prev, role: "AGENT", manager_id: user?.id || "" }));
      setManagerSearch(user?.name || "");
    }
  }, [isManagerViewer, open, user?.id, user?.name]);

  React.useEffect(() => {
    setForm((prev) => {
      let next = prev;
      if (!needsManager && prev.manager_id) {
        next = { ...next, manager_id: "" };
      }
      if (!needsTeam && prev.team_id) {
        next = { ...next, team_id: "" };
      }
      return next;
    });
    if (!needsManager) {
      setManagerSearch("");
    }
  }, [needsManager, needsTeam]);

  const teamName = (teamId: string | null) => {
    if (!teamId) return "-";
    return teams.find((t) => t.id === teamId)?.name ?? "-";
  };

  const openCreate = () => {
    setEditing(null);
    setDialogError("");
    setForm({ 
      name: "", 
      email: "", 
      role: isManagerViewer ? ("AGENT" as UserRole) : ("EMPLOYEE" as UserRole), 
      team_id: "", 
      manager_id: isManagerViewer ? user?.id || "" : "", 
      password: "",
      phone: "",
      department: "",
      location: "",
      bio: "",
      avatar_url: "",
      availability_status: "ONLINE" as "ONLINE" | "BUSY" | "OFFLINE" | "ON_BREAK" | "AWAY",
      max_concurrent_tickets: 5,
      certifications: [] as string[],
      hire_date: "",
    });
    setManagerSearch(isManagerViewer ? user?.name || "" : "");
    setOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setDialogError("");
    setForm({
      name: u.name,
      email: u.email,
      role: u.role,
      team_id: u.team_id ?? "",
      manager_id: u.manager_id ?? "",
      password: "",
      phone: u.phone ?? "",
      department: u.department ?? "",
      location: u.location ?? "",
      bio: u.bio ?? "",
      avatar_url: u.avatar_url ?? "",
      availability_status: u.availability_status ?? "ONLINE",
      max_concurrent_tickets: u.max_concurrent_tickets ?? 5,
      certifications: u.certifications ?? [],
      hire_date: u.hire_date ?? "",
    });
    setManagerSearch("");
    if (u.manager_id) {
      const existingManager = users.find((candidate) => candidate.id === u.manager_id);
      if (existingManager) {
        setManagerOptions((current) => {
          if (current.some((option) => option.id === existingManager.id)) return current;
          return [existingManager, ...current];
        });
        setManagerSearch(existingManager.name);
      }
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setManagerSearch("");
    setDialogError("");
  };

  const save = async () => {
    setError("");
    setDialogError("");
    try {
      if (editing) {
        const payload: Record<string, unknown> = {};
        if (form.name.trim() && form.name.trim() !== editing.name) payload.name = form.name.trim();
        if (form.email.trim() && form.email.trim() !== editing.email) payload.email = form.email.trim();
        if (form.role !== editing.role) payload.role = form.role;
        if (form.team_id !== (editing.team_id ?? "")) payload.team_id = form.team_id || null;
        if ((form.manager_id || "") !== (editing.manager_id ?? "")) payload.manager_id = form.manager_id || null;
        if (form.password.trim()) payload.password = form.password.trim();
        if (form.phone !== (editing.phone ?? "")) payload.phone = form.phone || null;
        if (form.department !== (editing.department ?? "")) payload.department = form.department || null;
        if (form.location !== (editing.location ?? "")) payload.location = form.location || null;
        if (form.bio !== (editing.bio ?? "")) payload.bio = form.bio || null;
        if (form.avatar_url !== (editing.avatar_url ?? "")) payload.avatar_url = form.avatar_url || null;
        if (form.availability_status !== (editing.availability_status ?? "ONLINE")) payload.availability_status = form.availability_status;
        if (form.max_concurrent_tickets !== (editing.max_concurrent_tickets ?? 5)) payload.max_concurrent_tickets = form.max_concurrent_tickets;
        if (JSON.stringify(form.certifications) !== JSON.stringify(editing.certifications ?? [])) payload.certifications = form.certifications;
        if (form.hire_date !== (editing.hire_date ?? "")) payload.hire_date = form.hire_date || null;
        
        await api.patch(`/users/${editing.id}`, payload);
      } else {
        await api.post("/users", {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          team_id: form.team_id || null,
          manager_id: form.manager_id || null,
          password: form.password.trim() || "changeme123",
          phone: form.phone || null,
          department: form.department || null,
          location: form.location || null,
          bio: form.bio || null,
          avatar_url: form.avatar_url || null,
          availability_status: form.availability_status,
          max_concurrent_tickets: form.max_concurrent_tickets,
          certifications: form.certifications,
          hire_date: form.hire_date || null,
        });
      }

      close();
      await load();
    } catch (e: unknown) {
      setDialogError(getApiErrorMessage(e, "Failed to save user"));
    }
  };

  const remove = async (user: UserRow) => {
    setError("");
    try {
      await api.delete(`/users/${user.id}`);
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to delete user"));
    }
  };

  const selectedManager = React.useMemo(
    () => managerOptions.find((option) => option.id === form.manager_id) || null,
    [form.manager_id, managerOptions]
  );

  const formIsValid =
    !!form.name.trim() &&
    !!form.email.trim() &&
    !!form.role &&
    (!!editing || !!form.password.trim()) &&
    (!needsManager || !!form.manager_id) &&
    (!needsTeam || !!form.team_id);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3 }}>
        <Typography variant="h4">Users</Typography>
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
          Add User
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {loading && <Typography color="text.secondary">Loading...</Typography>}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Team</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Location</TableCell>
              <TableCell>Phone</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!loading && users.length === 0 && (
              <TableRow>
                <TableCell colSpan={9}>
                  <Typography color="text.secondary">No users found.</Typography>
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <UserAvatar size={32} user={u} />
                    <Typography>{u.name}</Typography>
                  </Box>
                </TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Chip label={u.role} color="primary" size="small" />
                </TableCell>
                <TableCell>{teamName(u.team_id)}</TableCell>
                <TableCell>{u.department || "-"}</TableCell>
                <TableCell>{u.location || "-"}</TableCell>
                <TableCell>{u.phone || "-"}</TableCell>
                <TableCell>
                  <Chip 
                    label={u.availability_status || "OFFLINE"} 
                    color={u.availability_status === "ONLINE" ? "success" : u.availability_status === "BUSY" ? "warning" : "default"}
                    size="small" 
                  />
                </TableCell>
                <TableCell>{new Date(u.created_at).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => openEdit(u)}>
                    <Edit />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => { setConfirmUser(u); setConfirmOpen(true); }}>
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? "Edit User" : "Create User"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 2 }}>
            {dialogError && (
              <Alert severity="error" onClose={() => setDialogError("")}>
                {dialogError}
              </Alert>
            )}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Required
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Name, email, role, and password for new users. Manager/team only when the selected role needs them.
              </Typography>
            </Box>
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              fullWidth
              required
            />
            <TextField
              label="Email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              fullWidth
              required
            />
            <FormControl fullWidth>
              <InputLabel>Role</InputLabel>
              <Select
                value={form.role}
                label="Role"
                onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as UserRole }))}
                disabled={isManagerViewer}
              >
                {roleOptions.map((role) => (
                  <MenuItem key={role} value={role}>
                    {role}
                  </MenuItem>
                ))}
              </Select>
              {isManagerViewer && (
                <FormHelperText>Managers can create agent users only.</FormHelperText>
              )}
            </FormControl>

            {needsManager && (
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
                  setForm((prev) => ({ ...prev, manager_id: value?.id || "" }));
                  setManagerSearch(value?.name || "");
                }}
                getOptionLabel={(option) =>
                  typeof option === "string" ? option : `${option.name} (${option.email})`
                }
                isOptionEqualToValue={(option, value) => option.id === value.id}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Manager"
                    placeholder="Type manager name or email"
                    required={needsManager}
                    helperText={form.role === "EMPLOYEE" ? "Employees should be linked to a manager." : "Agents should be assigned to the manager who owns their work."}
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
            )}

            {needsTeam && (
              <FormControl fullWidth required={needsTeam}>
                <InputLabel>Team</InputLabel>
                <Select
                  value={form.team_id}
                  label="Team"
                  onChange={(e) => setForm((p) => ({ ...p, team_id: e.target.value }))}
                >
                  <MenuItem value="">None</MenuItem>
                  {teams.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </Select>
                <FormHelperText>
                  {form.role === "AGENT" ? "Agents should belong to a support team." : "Managers can be attached to the team they supervise."}
                </FormHelperText>
              </FormControl>
            )}

            <TextField
              label={editing ? "New Password (optional)" : "Password"}
              type="password"
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              fullWidth
              required={!editing}
              helperText={editing ? "Leave blank to keep the current password." : "Minimum 6 characters."}
            />

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Optional Profile Details
              </Typography>
              <Typography variant="caption" color="text.secondary">
                These fields enrich the profile but are not required to create the user.
              </Typography>
            </Box>

            <TextField
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Department"
              value={form.department}
              onChange={(e) => setForm((p) => ({ ...p, department: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Location"
              value={form.location}
              onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Bio"
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              multiline
              rows={3}
              fullWidth
            />
            <TextField
              label="Avatar URL"
              value={form.avatar_url}
              onChange={(e) => setForm((p) => ({ ...p, avatar_url: e.target.value }))}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Availability Status</InputLabel>
              <Select
                value={form.availability_status}
                label="Availability Status"
                onChange={(e) => setForm((p) => ({ ...p, availability_status: e.target.value as any }))}
              >
                <MenuItem value="ONLINE">ONLINE</MenuItem>
                <MenuItem value="BUSY">BUSY</MenuItem>
                <MenuItem value="OFFLINE">OFFLINE</MenuItem>
                <MenuItem value="ON_BREAK">ON_BREAK</MenuItem>
                <MenuItem value="AWAY">AWAY</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Max Concurrent Tickets"
              type="number"
              value={form.max_concurrent_tickets.toString()}
              onChange={(e) => setForm((p) => ({ ...p, max_concurrent_tickets: parseInt(e.target.value) || 5 }))}
              fullWidth
            />
            <TextField
              label="Certifications (comma-separated)"
              value={form.certifications.join(", ")}
              onChange={(e) => setForm((p) => ({ ...p, certifications: e.target.value.split(",").map(s => s.trim()).filter(s => s) }))}
              helperText="Enter certifications separated by commas"
              fullWidth
            />
            <TextField
              label="Hire Date"
              type="date"
              value={form.hire_date}
              onChange={(e) => setForm((p) => ({ ...p, hire_date: e.target.value }))}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button
            onClick={() => void save()}
            variant="contained"
            disabled={!formIsValid}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete User</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete the user "{confirmUser?.name}"?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirmOpen(false); setConfirmUser(null); }}>Cancel</Button>
          <Button
            onClick={async () => {
              if (confirmUser) await remove(confirmUser);
              setConfirmOpen(false);
              setConfirmUser(null);
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
