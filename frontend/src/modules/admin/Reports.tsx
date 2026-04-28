import React from "react";
import {
  Box,
  Typography,
  Grid,
  Paper,
  Card,
  CardContent,
  Alert,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import {
  Assessment as ReportsIcon,
  Assignment as TicketIcon,
  Speed as SpeedIcon,
  TrendingUp as TrendIcon,
  WarningAmber as WarnIcon,
  CheckCircle as OkIcon,
} from "@mui/icons-material";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api, getApiErrorMessage, getCachedData } from "../../services/api";

type Ticket = {
  id: string;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  created_at: string;
  resolved_at: string | null;
  closed_at?: string | null;
  category: string | null;
  updated_at: string;
};

type SlaRiskResponse = {
  counts: { high: number; medium: number; low: number };
  tickets: Array<{ id: string; title: string; priority: string; status: string; sla_resolution_due_at: string | null; risk: string | null }>;
};

type Trend = {
  category: string;
  current_count: number;
  baseline_mean: number;
  spike_ratio: number;
  window_start: string;
  window_end: string;
};

type TrendsResponse = { trends: Trend[] };

const kpiCardSx = (color: string) => ({
  background: `linear-gradient(135deg, ${color}16 0%, ${color}08 100%)`,
  border: `1px solid ${color}2A`,
  height: "100%",
});

export const Reports: React.FC = () => {
  const initialTickets = getCachedData<{ items: Ticket[]; total: number }>({
    url: "/tickets",
    params: { limit: 200, offset: 0 },
  });
  const initialSlaRisk = getCachedData<SlaRiskResponse>({ url: "/analytics/sla-risk" });
  const initialTrends = getCachedData<TrendsResponse>({ url: "/analytics/trends" });
  const initialClusters = getCachedData<{ clusters: Array<{ cluster_id: string; label: string; category: string; ticket_count: number; example_ticket_ids: string[] }> }>({
    url: "/analytics/root-causes",
  });
  const [tickets, setTickets] = React.useState<Ticket[]>(initialTickets?.items || []);
  const [slaRisk, setSlaRisk] = React.useState<SlaRiskResponse | null>(initialSlaRisk || null);
  const [trends, setTrends] = React.useState<Trend[]>(initialTrends?.trends || []);
  const [clusters, setClusters] = React.useState<
    Array<{ cluster_id: string; label: string; category: string; ticket_count: number; example_ticket_ids: string[] }>
  >(initialClusters?.clusters || []);

  const [error, setError] = React.useState("");

  React.useEffect(() => {
    (async () => {
      setError("");
      try {
        const [ticketsRes, slaRes, trendsRes, clustersRes] = await Promise.all([
          api.get<{ items: Ticket[]; total: number }>("/tickets", { params: { limit: 200, offset: 0 } }),
          api.get<SlaRiskResponse>("/analytics/sla-risk").catch(() => ({ data: null as any })),
          api.get<TrendsResponse>("/analytics/trends").catch(() => ({ data: { trends: [] } })),
          api.get<{ clusters: any[] }>("/analytics/root-causes").catch(() => ({ data: { clusters: [] } })),
        ]);

        setTickets(ticketsRes.data.items || []);
        setSlaRisk(slaRes.data || null);
        setTrends(trendsRes.data.trends || []);
        setClusters(clustersRes.data.clusters || []);
      } catch (e: unknown) {
        setError(getApiErrorMessage(e, "Failed to load reports"));
      }
    })();
  }, []);

  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "OPEN").length;
  const inProgress = tickets.filter((t) => t.status === "IN_PROGRESS" || t.status === "WAITING_FOR_CUSTOMER").length;
  const resolved = tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;
  const highPriority = tickets.filter((t) => t.priority === "HIGH").length;

  const getResolvedAt = (t: Ticket) => t.resolved_at || t.closed_at || null;

  const resolvedTickets = tickets.filter((t) => Boolean(getResolvedAt(t)));
  const avgResolutionHours =
    resolvedTickets.length > 0
      ? resolvedTickets.reduce((acc, t) => {
          const created = new Date(t.created_at).getTime();
          const resolvedAtRaw = getResolvedAt(t);
          const resolvedAt = resolvedAtRaw ? new Date(resolvedAtRaw).getTime() : created;
          return acc + Math.max(0, resolvedAt - created) / (1000 * 60 * 60);
        }, 0) / resolvedTickets.length
      : 0;

  const atRisk = (slaRisk?.counts?.high || 0) + (slaRisk?.counts?.medium || 0);

  const statusSeries = [
    { name: "Open", value: open },
    { name: "In Progress", value: inProgress },
    { name: "Resolved", value: resolved },
  ];

  const kpis = [
    { label: "Total Tickets", value: total, icon: TicketIcon, color: "#1976d2" },
    { label: "Open", value: open, icon: WarnIcon, color: "#d32f2f" },
    { label: "In Progress", value: inProgress, icon: SpeedIcon, color: "#ed6c02" },
    { label: "Resolved", value: resolved, icon: OkIcon, color: "#2e7d32" },
    { label: "High Priority", value: highPriority, icon: ReportsIcon, color: "#6a1b9a" },
    { label: "SLA At Risk", value: atRisk, icon: SpeedIcon, color: "#b71c1c" },
  ];

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Reports
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Operational analytics and AI insights
          </Typography>
        </Box>
        <Chip label="Service Desk" size="small" icon={<ReportsIcon />} />
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}


      <Grid container spacing={2.5} sx={{ mb: 2.5 }}>
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Grid item xs={12} sm={6} md={4} lg={2} key={k.label}>
              <Card sx={kpiCardSx(k.color)}>
                <CardContent sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                      {k.label}
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 800 }} noWrap>
                      {k.value}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      bgcolor: `${k.color}22`,
                      borderRadius: "50%",
                      width: 44,
                      height: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "0 0 auto",
                    }}
                  >
                    <Icon sx={{ color: k.color }} />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2.5, height: 360 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Ticket Load
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Current status distribution
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={statusSeries}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1976d2" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#1976d2" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="value" stroke="#1976d2" fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
            <Typography variant="caption" color="text.secondary">
              Avg resolution: {avgResolutionHours.toFixed(1)}h
            </Typography>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2.5, height: 360 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Trend Watch (AI)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Category spikes detected in recent time windows
            </Typography>

            {trends.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No active trends.
              </Typography>
            ) : (
              <TableContainer sx={{ maxHeight: 250 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Category</TableCell>
                      <TableCell align="right">Current</TableCell>
                      <TableCell align="right">Baseline</TableCell>
                      <TableCell align="right">Spike</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trends.slice(0, 8).map((t) => (
                      <TableRow key={t.category} hover>
                        <TableCell sx={{ fontWeight: 600 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <TrendIcon fontSize="small" color="primary" />
                            {t.category}
                          </Box>
                        </TableCell>
                        <TableCell align="right">{t.current_count}</TableCell>
                        <TableCell align="right">{t.baseline_mean.toFixed(1)}</TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            label={`${t.spike_ratio.toFixed(1)}x`}
                            color={t.spike_ratio >= 2 ? "warning" : "default"}
                            variant={t.spike_ratio >= 2 ? "filled" : "outlined"}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Root-cause Clusters (AI)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Similar incidents grouped automatically to accelerate knowledge creation
            </Typography>

            {clusters.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No clusters yet. Create a few similar tickets and the system will group them automatically.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Cluster</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell align="right">Tickets</TableCell>
                      <TableCell>Examples</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {clusters.map((c) => (
                      <TableRow key={c.cluster_id} hover>
                        <TableCell sx={{ fontWeight: 600 }}>{c.label}</TableCell>
                        <TableCell>{c.category}</TableCell>
                        <TableCell align="right">{c.ticket_count}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace" }}>
                          {(c.example_ticket_ids || []).slice(0, 3).join(", ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
