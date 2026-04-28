import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Paper,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
  TablePagination,
} from "@mui/material";
import {
  Add as AddIcon,
  Sync as SyncIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  CheckCircle as ActiveIcon,
  Cancel as InactiveIcon,
  Email as EmailIcon,
  Cloud as GLPIIcon,
  Settings as SolmanIcon,
} from "@mui/icons-material";
import { api, getApiErrorMessage } from "../../services/api";

interface Integration {
  id: string;
  system_type: "EMAIL" | "GLPI" | "SOLMAN";
  name: string;
  enabled: boolean;
  config: any;
  last_sync?: string;
  status?: string;
  last_error?: string | null;
  last_error_at?: string | null;
  last_success_at?: string | null;
  last_connect_at?: string | null;
}

  type EmailIngestionEvent = {
    id: string;
    email_source_id: string;
    message_id: string | null;
    from_email: string | null;
    subject: string | null;
    action: "CREATED" | "IGNORED" | "ERROR";
    reason: string | null;
    classifier_confidence: number | null;
    classifier_label: string | null;
    created_ticket_id: string | null;
    created_at: string;
  };
  
type GlpiIngestionEvent = {
    id: string;
    glpi_config_id: string;
    external_ticket_id: string;
    external_url: string | null;
    action: "CREATED" | "UPDATED" | "IGNORED" | "ERROR";
    reason: string | null;
    ticket_id: string | null;
    created_at: string;
    config_name: string;
  ticket_title: string | null;
};

type SolmanIngestionEvent = {
  id: string;
  solman_config_id: string;
  external_ticket_id: string | null;
  external_url: string | null;
  action: "CREATED" | "UPDATED" | "IGNORED" | "ERROR";
  reason: string | null;
  ticket_id: string | null;
  created_at: string;
  config_name?: string | null;
  ticket_title?: string | null;
};
  
  export const Integrations: React.FC = () => {
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [syncResult, setSyncResult] = useState<any>(null);
    const [syncDialogOpen, setSyncDialogOpen] = useState(false);
    const [syncDialogTitle, setSyncDialogTitle] = useState<string>("Sync Result");
    const [selectedType, setSelectedType] = useState<"EMAIL" | "GLPI" | "SOLMAN">("EMAIL");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [formData, setFormData] = useState<any>({});
    const [editingIntegration, setEditingIntegration] = useState<Integration | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmIntegration, setConfirmIntegration] = useState<Integration | null>(null);
    const [eventsOpen, setEventsOpen] = useState(false);
    const [eventsIntegration, setEventsIntegration] = useState<Integration | null>(null);
  const [events, setEvents] = useState<(EmailIngestionEvent | GlpiIngestionEvent | SolmanIngestionEvent)[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);
    const [eventsError, setEventsError] = useState("");
    const [eventsPage, setEventsPage] = useState(0);
    const [eventsLimit, setEventsLimit] = useState(25);
    const [eventsTotal, setEventsTotal] = useState(0);

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    setLoading(true);
    setError("");
    try {
      // Load email sources
      const emailRes = await api.get("/integrations/email-sources");
      const emailIntegrations = emailRes.data.map((e: any) => ({
        ...e,
        system_type: "EMAIL" as const,
        enabled: e.status === "OK",
        last_sync: e.last_success_at || e.last_checked_at || null,
      }));

      // Load GLPI configs
      const glpiRes = await api.get("/integrations/glpi/configs");
      const glpiIntegrations = glpiRes.data.map((g: any) => ({
        ...g,
        system_type: "GLPI" as const,
        last_sync: g.last_sync_at || null,
      }));

      // Load Solman configs
      const solmanRes = await api.get("/integrations/solman/configs");
      const solmanIntegrations = solmanRes.data.map((s: any) => ({
        ...s,
        system_type: "SOLMAN" as const,
        last_sync: s.last_sync_at || null,
      }));

      setIntegrations([...emailIntegrations, ...glpiIntegrations, ...solmanIntegrations]);
    } catch (e: any) {
      setError(getApiErrorMessage(e, "Failed to load integrations"));
    } finally {
      setLoading(false);
    }
  };

  const openEvents = async (integration: Integration) => {
    if (
      integration.system_type !== "EMAIL" &&
      integration.system_type !== "GLPI" &&
      integration.system_type !== "SOLMAN"
    ) {
      return;
    }
    setEventsIntegration(integration);
    setEventsPage(0);
    setEventsOpen(true);
  };

  useEffect(() => {
    const loadEvents = async () => {
      if (!eventsOpen || !eventsIntegration) return;
      setEventsLoading(true);
      setEventsError("");
      setEvents([]);
      try {
        if (eventsIntegration.system_type === "EMAIL") {
          const res = await api.get(`/integrations/email-sources/${eventsIntegration.id}/events`, {
            params: {
              limit: eventsLimit,
              offset: eventsPage * eventsLimit,
            },
          });
          setEvents(res.data.items || res.data.data);
          setEventsTotal(res.data.total || res.data.pagination?.total || 0);
        } else if (eventsIntegration.system_type === "GLPI") {
          const res = await api.get("/integrations/glpi/events", {
            params: {
              limit: eventsLimit,
              offset: eventsPage * eventsLimit,
            },
          });
          setEvents(res.data.data);
          setEventsTotal(res.data.total || res.data.pagination?.total || 0);
        } else if (eventsIntegration.system_type === "SOLMAN") {
          const res = await api.get("/integrations/solman/events", {
            params: {
              limit: eventsLimit,
              offset: eventsPage * eventsLimit,
            },
          });
          setEvents(res.data.data || []);
          setEventsTotal(res.data.total || 0);
        }
      } catch (e: any) {
        setEventsError(getApiErrorMessage(e, "Failed to load events"));
      } finally {
        setEventsLoading(false);
      }
    };
    void loadEvents();
  }, [eventsOpen, eventsIntegration, eventsPage, eventsLimit]);

  const openEditDialog = (integration: Integration) => {
    setEditingIntegration(integration);
    setSelectedType(integration.system_type);

    if (integration.system_type === "EMAIL") {
      setFormData({
        name: integration.name,
        imapHost: (integration as any).imap_host ?? "",
        imapPort: (integration as any).imap_port ?? 993,
        email: (integration as any).email_address ?? "",
        password: "",
      });
    } else if (integration.system_type === "GLPI") {
      setFormData({
        name: integration.name,
        apiUrl: (integration as any).api_url ?? "",
        appToken: "",
        userToken: "",
      });
    } else if (integration.system_type === "SOLMAN") {
      setFormData({
        name: integration.name,
        apiUrl: (integration as any).api_url ?? "",
        username: "",
        password: "",
        clientId: "",
        clientSecret: "",
        syncIntervalMinutes: (integration as any).sync_interval_minutes ?? 15,
      });
    } else {
      setFormData({});
    }

    setDialogOpen(true);
  };

  const handleUpdate = async () => {
    if (!editingIntegration) return;
    try {
      if (editingIntegration.system_type === "EMAIL") {
        const patch: any = {
          name: formData.name,
          email_address: formData.email,
          imap_host: formData.imapHost,
          imap_port: formData.imapPort || 993,
        };
        if (String(formData.password || "").trim()) {
          patch.imap_password = String(formData.password).trim();
        }
        await api.patch(`/integrations/email-sources/${editingIntegration.id}`, patch);
      } else if (editingIntegration.system_type === "GLPI") {
        const patch: any = {
          name: formData.name,
          api_url: formData.apiUrl,
        };
        if (String(formData.appToken || "").trim()) patch.app_token = String(formData.appToken).trim();
        if (String(formData.userToken || "").trim()) patch.user_token = String(formData.userToken).trim();
        await api.patch(`/integrations/glpi/configs/${editingIntegration.id}`, patch);
      } else if (editingIntegration.system_type === "SOLMAN") {
        const patch: any = {
          name: formData.name,
          api_url: formData.apiUrl,
          sync_interval_minutes: Number(formData.syncIntervalMinutes || 15),
        };
        if (String(formData.username || "").trim()) patch.username = String(formData.username).trim();
        if (String(formData.password || "").trim()) patch.password = String(formData.password).trim();
        if (String(formData.clientId || "").trim()) patch.client_id = String(formData.clientId).trim();
        if (String(formData.clientSecret || "").trim()) patch.client_secret = String(formData.clientSecret).trim();
        await api.patch(`/integrations/solman/configs/${editingIntegration.id}`, patch);
      }

      setDialogOpen(false);
      setEditingIntegration(null);
      setFormData({});
      loadIntegrations();
    } catch (e: any) {
      alert(getApiErrorMessage(e, "Update failed"));
    }
  };

  const handleSync = async (integration: Integration) => {
    try {
      if (integration.system_type === "GLPI") {
        const res = await api.post(`/integrations/glpi/sync/${integration.id}`);
        setSyncResult(res.data);
        setSyncDialogTitle("GLPI Sync Result");
        setSyncDialogOpen(true);
      } else if (integration.system_type === "EMAIL") {
        const res = await api.post(`/integrations/email-sources/${integration.id}/check`);
        setSyncResult(res.data);
        setSyncDialogTitle("Sync Result");
        setSyncDialogOpen(true);
      } else if (integration.system_type === "SOLMAN") {
        const res = await api.post(`/integrations/solman/sync/${integration.id}`);
        setSyncResult(res.data);
        setSyncDialogTitle("Solman Sync Result");
        setSyncDialogOpen(true);
      }
      loadIntegrations();
    } catch (e: any) {
      alert(getApiErrorMessage(e, "Sync failed"));
    }
  };

  const getEmailStatus = (integration: Integration) => {
    const raw = String(integration.status || "").toUpperCase();
    if (["OK", "ERROR", "DISABLED", "CONNECTED", "PENDING"].includes(raw)) return raw;

    if (integration.enabled === false) return "DISABLED";
    const lastErrorAt = integration.last_error_at ? new Date(integration.last_error_at).getTime() : null;
    const lastSuccessAt = integration.last_success_at ? new Date(integration.last_success_at).getTime() : null;
    if (lastErrorAt && (!lastSuccessAt || lastErrorAt > lastSuccessAt)) return "ERROR";
    if (lastSuccessAt) return "OK";
    if (integration.last_connect_at) return "CONNECTED";
    return "PENDING";
  };

  const getStatusChip = (integration: Integration) => {
    if (integration.system_type === "EMAIL") {
      const status = getEmailStatus(integration);
      if (status === "OK") {
        return (
          <Chip icon={<ActiveIcon />} label="Active" color="success" size="small" />
        );
      }
      if (status === "ERROR") {
        return (
          <Chip icon={<InactiveIcon />} label="Error" color="error" size="small" />
        );
      }
      if (status === "DISABLED") {
        return (
          <Chip icon={<InactiveIcon />} label="Disabled" color="default" size="small" />
        );
      }
      if (status === "CONNECTED") {
        return (
          <Chip icon={<ActiveIcon />} label="Connected" color="info" size="small" />
        );
      }
      return (
        <Chip icon={<InactiveIcon />} label="Pending" color="warning" size="small" />
      );
    }

    return (
      <Chip
        icon={integration.enabled ? <ActiveIcon /> : <InactiveIcon />}
        label={integration.enabled ? "Active" : "Inactive"}
        color={integration.enabled ? "success" : "default"}
        size="small"
      />
    );
  };

  const handleDelete = async (integration: Integration) => {
    try {
      if (integration.system_type === "EMAIL") {
        await api.delete(`/integrations/email-sources/${integration.id}`);
      } else if (integration.system_type === "GLPI") {
        await api.delete(`/integrations/glpi/configs/${integration.id}`);
      } else if (integration.system_type === "SOLMAN") {
        await api.delete(`/integrations/solman/configs/${integration.id}`);
      }
      loadIntegrations();
    } catch (e: any) {
      alert(getApiErrorMessage(e, "Delete failed"));
    }
  };

  const handleCreate = async () => {
    try {
      if (selectedType === "EMAIL") {
        const emailData = {
          name: formData.name,
          email_address: formData.email,
          imap_host: formData.imapHost,
          imap_port: formData.imapPort || 993,
          imap_secure: true,
          imap_username: formData.email,
          imap_password: formData.password,
          enabled: true,
        };
        await api.post("/integrations/email-sources", emailData);
      } else if (selectedType === "GLPI") {
        await api.post("/integrations/glpi/configs", formData);
      } else if (selectedType === "SOLMAN") {
        await api.post("/integrations/solman/configs", {
          name: formData.name,
          api_url: formData.apiUrl,
          username: formData.username || null,
          password: formData.password || null,
          client_id: formData.clientId || null,
          client_secret: formData.clientSecret || null,
          enabled: true,
          sync_interval_minutes: Number(formData.syncIntervalMinutes || 15),
        });
      }
      setDialogOpen(false);
      setFormData({});
      loadIntegrations();
    } catch (e: any) {
      alert(getApiErrorMessage(e, "Creation failed"));
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "EMAIL":
        return <EmailIcon />;
      case "GLPI":
        return <GLPIIcon />;
      case "SOLMAN":
        return <SolmanIcon />;
      default:
        return null;
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          System Integrations
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingIntegration(null);
            setFormData({});
            setDialogOpen(true);
          }}
        >
          Add Integration
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last Sync</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {integrations.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography color="text.secondary" sx={{ py: 4 }}>
                      No integrations configured. Click "Add Integration" to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {integrations.map((integration) => (
                <TableRow key={integration.id}>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      {getIcon(integration.system_type)}
                      <Typography>{integration.system_type}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>{integration.name || integration.config?.name || "Unnamed"}</TableCell>
                  <TableCell>
                    <Tooltip
                      title={
                        integration.system_type === "EMAIL"
                          ? String((integration as any).last_error || "")
                          : ""
                      }
                    >
                      <Box sx={{ display: "inline-flex" }}>{getStatusChip(integration)}</Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {integration.last_sync
                      ? new Date(integration.last_sync).toLocaleString()
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => openEditDialog(integration)}
                          color="default"
                        >
                          <EditIcon />
                        </IconButton>
                      </Tooltip>
                      {(integration.system_type === "EMAIL" || integration.system_type === "GLPI" || integration.system_type === "SOLMAN") && (
                        <Tooltip title="Ingestion Events">
                          <IconButton
                            size="small"
                            onClick={() => void openEvents(integration)}
                            color="default"
                          >
                            <VisibilityIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Sync Now">
                        <IconButton
                          size="small"
                          onClick={() => handleSync(integration)}
                          color="primary"
                        >
                          <SyncIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={() => { setConfirmIntegration(integration); setConfirmOpen(true); }}
                          color="error"
                        >
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

      <Dialog
        open={eventsOpen}
        onClose={() => {
          setEventsOpen(false);
          setEventsIntegration(null);
          setEvents([]);
          setEventsError("");
        }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          {eventsIntegration?.system_type === "GLPI"
            ? "GLPI Ingestion Events"
            : eventsIntegration?.system_type === "SOLMAN"
            ? "Solman Ingestion Events"
            : "Email Ingestion Events"}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {eventsIntegration?.name || "Email Source"}
          </Typography>

          {eventsError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {eventsError}
            </Alert>
          )}

          {eventsLoading && <Typography color="text.secondary">Loading...</Typography>}

          <Table size="small">
            <TableHead>
              <TableRow>
                {eventsIntegration?.system_type === "GLPI" || eventsIntegration?.system_type === "SOLMAN" ? (
                  <>
                    <TableCell>Ticket</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>External ID</TableCell>
                    <TableCell>Link</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell>Time</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell>Time</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>From</TableCell>
                    <TableCell>Subject</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell>Ticket</TableCell>
                  </>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {!eventsLoading && events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">No events.</Typography>
                  </TableCell>
                </TableRow>
              )}
              {events.map((ev) => {
                const isEmail = eventsIntegration?.system_type === "EMAIL";
                const isExternal =
                  eventsIntegration?.system_type === "GLPI" || eventsIntegration?.system_type === "SOLMAN";

                const emailEv = ev as EmailIngestionEvent;
                const externalEv = ev as GlpiIngestionEvent | SolmanIngestionEvent;

                const ticketId = isEmail ? emailEv.created_ticket_id : externalEv.ticket_id;

                return (
                  <TableRow key={ev.id}>
                    {isExternal ? (
                      <>
                        <TableCell>
                          {ticketId ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => window.open(`/admin/tickets/${ticketId}`, "_blank")}
                              sx={{ 
                                textTransform: 'none', 
                                textAlign: 'left', 
                                justifyContent: 'flex-start',
                                p: 0,
                                minWidth: 0,
                                '&:hover': {
                                  textDecoration: 'underline',
                                  backgroundColor: 'transparent'
                                }
                              }}
                            >
                              {externalEv.ticket_title || "View Ticket"}
                            </Button>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={ev.action}
                            size="small"
                            color={ev.action === "CREATED" ? "success" : ev.action === "ERROR" ? "error" : "default"}
                            variant={ev.action === "IGNORED" ? "outlined" : "filled"}
                          />
                        </TableCell>
                        <TableCell>{externalEv.external_ticket_id || "-"}</TableCell>
                        <TableCell>
                          {externalEv.external_url ? (
                            <a href={externalEv.external_url} target="_blank" rel="noreferrer">
                              Link
                            </a>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{ev.reason || "-"}</TableCell>
                        <TableCell>{new Date(ev.created_at).toLocaleString()}</TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>{new Date(ev.created_at).toLocaleString()}</TableCell>
                        <TableCell>
                          <Chip
                            label={ev.action}
                            size="small"
                            color={ev.action === "CREATED" ? "success" : ev.action === "ERROR" ? "error" : "default"}
                            variant={ev.action === "IGNORED" ? "outlined" : "filled"}
                          />
                        </TableCell>
                        <TableCell>{emailEv.from_email || "-"}</TableCell>
                        <TableCell>{emailEv.subject || "-"}</TableCell>
                        <TableCell>{ev.reason || "-"}</TableCell>
                        <TableCell>
                          {ticketId ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => window.open(`/admin/tickets/${ticketId}`, "_blank")}
                            >
                              View
                            </Button>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <TablePagination
            component="div"
            count={eventsTotal}
            page={eventsPage}
            onPageChange={(_e, p) => setEventsPage(p)}
            rowsPerPage={eventsLimit}
            onRowsPerPageChange={(e) => {
              setEventsLimit(parseInt(e.target.value, 10));
              setEventsPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            showFirstButton
            showLastButton
            sx={{ mt: 1, px: 0, "& .MuiTablePagination-toolbar": { px: 0 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setEventsOpen(false);
              setEventsIntegration(null);
              setEvents([]);
              setEventsError("");
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={syncDialogOpen} onClose={() => setSyncDialogOpen(false)}>
        <DialogTitle>{syncDialogTitle}</DialogTitle>
        <DialogContent>
          {syncResult && (
            <Box sx={{ mt: 1 }}>
              {syncResult.checked !== undefined ? (
                <Box>
                  <Typography sx={{ mt: 1 }}>
                    Email check completed. Checked: {syncResult.checked}, Created: {syncResult.created}, Ignored:{" "}
                    {syncResult.ignored}, Errors: {syncResult.errors?.length || 0}
                  </Typography>
                  {Array.isArray(syncResult.errors) && syncResult.errors.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      {syncResult.errors.map((er: any, idx: number) => (
                        <Alert key={idx} severity="error" sx={{ mt: 1 }}>
                          {String(er?.error || er?.message || JSON.stringify(er))}
                        </Alert>
                      ))}
                    </Box>
                  )}
                </Box>
              ) : syncResult.created !== undefined ? (
                <Box>
                  <Typography sx={{ mt: 1 }}>
                    Sync completed. Created: {syncResult.created}, Updated: {syncResult.updated}, Errors: {syncResult.errors?.length || 0}
                  </Typography>
                  {Array.isArray(syncResult.errors) && syncResult.errors.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      {syncResult.errors.map((er: any, idx: number) => (
                        <Alert key={idx} severity="error" sx={{ mt: 1 }}>
                          Ticket #{er.ticketId}: {String(er.error || er.message || JSON.stringify(er))}
                        </Alert>
                      ))}
                    </Box>
                  )}
                </Box>
              ) : (
                <Typography>Sync completed successfully.</Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSyncDialogOpen(false)} variant="contained">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingIntegration ? "Edit Integration" : "Add Integration"}</DialogTitle>
        <DialogContent>
          <Tabs
            value={selectedType}
            onChange={(_, v) => {
              if (editingIntegration) return;
              setSelectedType(v);
            }}
            sx={{ mb: 3 }}
          >
            <Tab label="Email" value="EMAIL" icon={<EmailIcon />} iconPosition="start" />
            <Tab label="GLPI" value="GLPI" icon={<GLPIIcon />} iconPosition="start" />
            <Tab label="Solman" value="SOLMAN" icon={<SolmanIcon />} iconPosition="start" />
          </Tabs>

          {selectedType === "EMAIL" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                label="Name"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                fullWidth
              />
              <TextField
                label="IMAP Host"
                value={formData.imapHost || ""}
                onChange={(e) => setFormData({ ...formData, imapHost: e.target.value })}
                fullWidth
              />
              <TextField
                label="IMAP Port"
                type="number"
                value={formData.imapPort || ""}
                onChange={(e) => setFormData({ ...formData, imapPort: parseInt(e.target.value) })}
                fullWidth
              />
              <TextField
                label="Email"
                type="email"
                value={formData.email || ""}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                fullWidth
              />
              <TextField
                label={editingIntegration ? "Password (leave blank to keep unchanged)" : "Password"}
                type="password"
                value={formData.password || ""}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                fullWidth
              />
            </Box>
          )}

          {selectedType === "GLPI" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                label="Name"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                fullWidth
              />
              <TextField
                label="API URL"
                value={formData.apiUrl || ""}
                onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                fullWidth
                placeholder="https://glpi.example.com/apirest.php"
              />
              <TextField
                label="App Token"
                value={formData.appToken || ""}
                onChange={(e) => setFormData({ ...formData, appToken: e.target.value })}
                fullWidth
              />
              <TextField
                label="User Token"
                value={formData.userToken || ""}
                onChange={(e) => setFormData({ ...formData, userToken: e.target.value })}
                fullWidth
              />
            </Box>
          )}

          {selectedType === "SOLMAN" && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                label="Name"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                fullWidth
              />
              <TextField
                label="API URL"
                value={formData.apiUrl || ""}
                onChange={(e) => setFormData({ ...formData, apiUrl: e.target.value })}
                fullWidth
                placeholder="https://solman.example.com/api"
              />
              <TextField
                label="Username"
                value={formData.username || ""}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={formData.password || ""}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                fullWidth
              />
              <TextField
                label="Client ID"
                value={formData.clientId || ""}
                onChange={(e) => setFormData({ ...formData, clientId: e.target.value })}
                fullWidth
              />
              <TextField
                label="Client Secret"
                type="password"
                value={formData.clientSecret || ""}
                onChange={(e) => setFormData({ ...formData, clientSecret: e.target.value })}
                fullWidth
              />
              <TextField
                label="Sync Interval (minutes)"
                type="number"
                value={formData.syncIntervalMinutes || 15}
                onChange={(e) => setFormData({ ...formData, syncIntervalMinutes: parseInt(e.target.value, 10) || 15 })}
                fullWidth
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDialogOpen(false);
              setEditingIntegration(null);
              setFormData({});
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={editingIntegration ? handleUpdate : handleCreate}
            variant="contained"
          >
            {editingIntegration ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete Integration</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the {confirmIntegration?.system_type} integration "
            {confirmIntegration?.name || confirmIntegration?.config?.name || "this integration"}"?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirmOpen(false); setConfirmIntegration(null); }}>Cancel</Button>
          <Button
            onClick={async () => {
              if (confirmIntegration) await handleDelete(confirmIntegration);
              setConfirmOpen(false);
              setConfirmIntegration(null);
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
