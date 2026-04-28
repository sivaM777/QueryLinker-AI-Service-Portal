import React from "react";
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Alert,
  Paper,
  ButtonBase,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import {
  Assignment as TicketIcon,
  TrendingUp as TrendingIcon,
  Speed as SpeedIcon,
  CheckCircle as ResolvedIcon,
} from "@mui/icons-material";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { api, getApiErrorMessage } from "../../services/api";
import { subscribeToMetrics } from "../../services/socket.service";
import { useNavigate } from "react-router-dom";

type Ticket = {
  id: string;
  display_number?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  created_at: string;
  resolved_at: string | null;
  category: string | null;
};

type WorkflowMetric = {
  category: string;
  action: string;
  total_attempts: number;
  successful_resolutions: number;
  failed_resolutions: number;
  escalated_count: number;
};

type SlaRiskResponse = {
  counts: { high: number; medium: number; low: number };
  tickets: Array<{
    id: string;
    display_number?: string | null;
    title: string;
    priority: string;
    status: string;
    sla_resolution_due_at: string | null;
    risk: string | null;
  }>;
};

type Trend = {
  category: string;
  current_count: number;
  baseline_mean: number;
  spike_ratio: number;
  window_start: string;
  window_end: string;
};

type TrendsResponse = {
  trends: Trend[];
};

type EmailStats = Array<{ date: string; count: number }>;

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [metrics, setMetrics] = React.useState<WorkflowMetric[]>([]);
  const [slaRisk, setSlaRisk] = React.useState<SlaRiskResponse | null>(null);
  const [trends, setTrends] = React.useState<Trend[]>([]);
  const [emailStats, setEmailStats] = React.useState<EmailStats>([]);

  const [drilldownOpen, setDrilldownOpen] = React.useState(false);
  const [drilldownTitle, setDrilldownTitle] = React.useState<string>("");
  const [drilldownRows, setDrilldownRows] = React.useState<
    Array<{ ticket_id: string; display_number?: string | null; title?: string | null; subtitle?: string | null }>
  >([]);

  const loadData = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [ticketsRes, metricsRes, slaRes, trendsRes, emailRes] = await Promise.all([
        api.get<{ items: Ticket[]; total: number }>("/tickets", { params: { limit: 200, offset: 0 } }),
        api.get<{ metrics: WorkflowMetric[] }>("/workflows/metrics"),
        api.get<SlaRiskResponse>("/analytics/sla-risk").catch(() => ({ data: null as any })),
        api.get<TrendsResponse>("/analytics/trends").catch(() => ({ data: { trends: [] } })),
        api.get<EmailStats>("/analytics/integrations/email/tickets").catch(() => ({ data: [] })),
      ]);
      setTickets(ticketsRes.data.items || []);
      setMetrics(metricsRes.data.metrics || []);
      setSlaRisk(slaRes.data || null);
      setTrends(trendsRes.data.trends || []);
      setEmailStats(emailRes.data || []);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load dashboard metrics"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
    const unsubscribe = subscribeToMetrics("dashboard", () => {
      void loadData(true);
    });
    return () => {
      unsubscribe();
    };
  }, [loadData]);

  const total = tickets.length;
  const open = tickets.filter((t: Ticket) => t.status === "OPEN").length;
  const inProgress = tickets.filter((t: Ticket) => t.status === "IN_PROGRESS" || t.status === "WAITING_FOR_CUSTOMER").length;
  const resolved = tickets.filter((t: Ticket) => t.status === "RESOLVED" || t.status === "CLOSED").length;
  const highPriority = tickets.filter((t: Ticket) => t.priority === "HIGH").length;
  const atRisk = (slaRisk?.counts?.high || 0) + (slaRisk?.counts?.medium || 0);

  // Auto-resolution success (overall)
  const autoMetrics = metrics.find((m) => m.action === "auto_resolution");
  const autoResolveSuccessRate =
    autoMetrics && autoMetrics.total_attempts > 0
      ? (autoMetrics.successful_resolutions / autoMetrics.total_attempts) * 100
      : 0;

  // Calculate average resolution time (in hours)
  const resolvedTickets = tickets.filter((t: Ticket) => t.resolved_at);
  const avgResolutionTime = resolvedTickets.length > 0
    ? resolvedTickets.reduce((acc, t) => {
        if (t.resolved_at && t.created_at) {
          const created = new Date(t.created_at).getTime();
          const resolved = new Date(t.resolved_at).getTime();
          return acc + (resolved - created) / (1000 * 60 * 60); // Convert to hours
        }
        return acc;
      }, 0) / resolvedTickets.length
    : 0;

  // Category distribution
  const categoryCounts: Record<string, number> = {};
  tickets.forEach((t: Ticket) => {
    const cat = t.category || "Uncategorized";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const categoryData = Object.entries(categoryCounts).map(([name, value]) => ({ name, value }));

  // Status distribution
  const statusData = [
    { name: "Open", value: open },
    { name: "In Progress", value: inProgress },
    { name: "Resolved", value: resolved },
  ];

  const ticketLabel = (id: string, display?: string | null) => {
    return display || `#${id.slice(0, 8)}`;
  };

  const openDrilldown = (label: string) => {
    if (label === "SLA At Risk") {
      const rows = (slaRisk?.tickets || []).map((t) => ({
        ticket_id: t.id,
        display_number: t.display_number,
        title: t.title,
        subtitle: `Risk: ${String(t.risk || "").toUpperCase()} • ${t.priority} • ${t.status}`,
      }));
      setDrilldownTitle("SLA Risk Queue");
      setDrilldownRows(rows);
      setDrilldownOpen(true);
      return;
    }

    if (label === "Open Tickets") {
      const rows = tickets
        .filter((t) => t.status === "OPEN")
        .map((t) => ({
          ticket_id: t.id,
          display_number: t.display_number,
          title: null,
          subtitle: `${t.status} • ${t.priority}`,
        }));
      setDrilldownTitle("Open Tickets");
      setDrilldownRows(rows);
      setDrilldownOpen(true);
      return;
    }

    if (label === "Resolved") {
      const rows = tickets
        .filter((t) => t.status === "RESOLVED" || t.status === "CLOSED")
        .map((t) => ({
          ticket_id: t.id,
          display_number: t.display_number,
          title: null,
          subtitle: `${t.status} • ${t.priority}`,
        }));
      setDrilldownTitle("Resolved / Closed");
      setDrilldownRows(rows);
      setDrilldownOpen(true);
      return;
    }

    if (label === "High Priority") {
      const rows = tickets
        .filter((t) => t.priority === "HIGH")
        .map((t) => ({
          ticket_id: t.id,
          display_number: t.display_number,
          title: null,
          subtitle: `${t.status} • HIGH`,
        }));
      setDrilldownTitle("High Priority Tickets");
      setDrilldownRows(rows);
      setDrilldownOpen(true);
      return;
    }

    if (label === "Total Tickets") {
      const rows = tickets.map((t) => ({
        ticket_id: t.id,
        display_number: t.display_number,
        title: null,
        subtitle: `${t.status} • ${t.priority}`,
      }));
      setDrilldownTitle("All Tickets");
      setDrilldownRows(rows);
      setDrilldownOpen(true);
      return;
    }
  };

  // Priority distribution
  const priorityData = [
    { name: "High", value: highPriority },
    { name: "Medium", value: tickets.filter((t: Ticket) => t.priority === "MEDIUM").length },
    { name: "Low", value: tickets.filter((t: Ticket) => t.priority === "LOW").length },
  ];

  const kpiCards = [
    {
      label: "Total Tickets",
      value: total,
      icon: TicketIcon,
      color: "#1976d2",
    },
    {
      label: "Open Tickets",
      value: open,
      icon: TicketIcon,
      color: "#d32f2f",
    },
    {
      label: "Resolved",
      value: resolved,
      icon: ResolvedIcon,
      color: "#2e7d32",
    },
    {
      label: "Avg Resolution",
      value: `${avgResolutionTime.toFixed(1)}h`,
      icon: SpeedIcon,
      color: "#ed6c02",
    },
    {
      label: "High Priority",
      value: highPriority,
      icon: TrendingIcon,
      color: "#d32f2f",
    },
    {
      label: "AI Auto-Resolve",
      value: `${autoResolveSuccessRate.toFixed(0)}%`,
      icon: ResolvedIcon,
      color: "#6a1b9a",
    },
    {
      label: "SLA At Risk",
      value: atRisk,
      icon: SpeedIcon,
      color: "#b71c1c",
    },
  ];

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, mb: 4 }}>
        Admin Dashboard
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && <Typography color="text.secondary">Loading...</Typography>}

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Grid item xs={12} sm={6} md={4} lg={2.4} key={kpi.label}>
              <ButtonBase onClick={() => openDrilldown(kpi.label)} sx={{ width: "100%", textAlign: "left", borderRadius: 2 }}>
                <Card
                  sx={{
                    width: "100%",
                    borderRadius: 2,
                    background: `linear-gradient(135deg, ${kpi.color}15 0%, ${kpi.color}05 100%)`,
                    border: `1px solid ${kpi.color}30`,
                    transition: "transform 160ms ease, box-shadow 160ms ease",
                    "&:hover": {
                      transform: "translateY(-3px)",
                      boxShadow: 6,
                    },
                    "&:active": {
                      transform: "translateY(0px) scale(0.99)",
                    },
                  }}
                >
                  <CardContent>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <Box>
                        <Typography color="textSecondary" gutterBottom variant="body2" sx={{ fontWeight: 500 }}>
                          {kpi.label}
                        </Typography>
                        <Typography variant="h4" sx={{ fontWeight: 700, color: kpi.color }}>
                          {kpi.value}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          width: 56,
                          height: 56,
                          borderRadius: "50%",
                          bgcolor: `${kpi.color}20`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon sx={{ fontSize: 28, color: kpi.color }} />
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </ButtonBase>
            </Grid>
          );
        })}
      </Grid>

      <Dialog open={drilldownOpen} onClose={() => setDrilldownOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>{drilldownTitle}</DialogTitle>
        <DialogContent dividers>
          {drilldownRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No items.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Ticket</TableCell>
                    <TableCell>Details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {drilldownRows.map((r) => (
                    <TableRow
                      key={r.ticket_id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => {
                        setDrilldownOpen(false);
                        navigate(`/admin/tickets/${r.ticket_id}`);
                      }}
                    >
                      <TableCell sx={{ fontWeight: 800, color: "primary.main" }}>
                        {ticketLabel(r.ticket_id, r.display_number)}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {r.title || r.subtitle || ""}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDrilldownOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Charts */}
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              Current Trends
            </Typography>
            {trends.length === 0 ? (
              <Typography color="text.secondary">No spikes detected (last 24h).</Typography>
            ) : (
              <Grid container spacing={2}>
                {trends.slice(0, 6).map((t) => (
                  <Grid item xs={12} sm={6} md={4} key={`${t.category}-${t.window_end}`}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {t.category}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {t.current_count} in last hour • {t.spike_ratio}x baseline
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            )}
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              Tickets by Status
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#1976d2" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              Tickets by Priority
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={priorityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#ed6c02" />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        {categoryData.length > 0 && (
          <Grid item xs={12}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                Tickets by Category (AI Classification)
              </Typography>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={150} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#667eea" />
                </BarChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        )}

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              Email Integration Tickets (Last 30 Days)
            </Typography>
            {emailStats.length === 0 ? (
              <Typography color="text.secondary">No email tickets yet.</Typography>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={emailStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#4caf50" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
