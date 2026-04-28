import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Grid,
  Paper,
  Card,
  CardContent,
  Alert,
  Chip,
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
  PendingActions as OpenIcon,
  FactCheck as ResolvedIcon,
  Schedule as TimeIcon,
  Category as CategoryIcon,
} from "@mui/icons-material";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api, getApiErrorMessage, getCachedData } from "../../services/api";

type Ticket = {
  id: string;
  display_number?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  category: string | null;
  created_at: string;
  resolved_at: string | null;
  closed_at?: string | null;
  updated_at: string;
};

const kpiCardSx = (color: string) => ({
  background: `linear-gradient(135deg, ${color}16 0%, ${color}08 100%)`,
  border: `1px solid ${color}2A`,
  height: "100%",
});

export const Reports: React.FC = () => {
  const navigate = useNavigate();
  const initialTickets = getCachedData<Ticket[]>({ url: "/tickets/my" }) || [];
  const [tickets, setTickets] = React.useState<Ticket[]>(initialTickets);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const [drilldownOpen, setDrilldownOpen] = React.useState(false);
  const [drilldownTitle, setDrilldownTitle] = React.useState<string>("");
  const [drilldownRows, setDrilldownRows] = React.useState<
    Array<{ ticket_id: string; display_number?: string | null; title: string; subtitle?: string | null }>
  >([]);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await api.get<Ticket[]>("/tickets/my");
        setTickets(res.data || []);
      } catch (e: unknown) {
        setError(getApiErrorMessage(e, "Failed to load reports"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "OPEN").length;
  const inProgress = tickets.filter((t) => t.status === "IN_PROGRESS" || t.status === "WAITING_FOR_CUSTOMER").length;
  const resolved = tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;

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

  const categoryCounts = tickets.reduce<Record<string, number>>((acc, t) => {
    const k = t.category || "Uncategorized";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "-";

  const statusChart = [
    { name: "Open", value: open },
    { name: "In Progress", value: inProgress },
    { name: "Resolved", value: resolved },
  ];

  const kpis = [
    { label: "Total Tickets", value: total, icon: TicketIcon, color: "#1976d2" },
    { label: "Open", value: open, icon: OpenIcon, color: "#d32f2f" },
    { label: "In Progress", value: inProgress, icon: TimeIcon, color: "#ed6c02" },
    { label: "Resolved", value: resolved, icon: ResolvedIcon, color: "#2e7d32" },
    { label: "Avg Resolution", value: `${avgResolutionHours.toFixed(1)}h`, icon: TimeIcon, color: "#6a1b9a" },
    { label: "Top Category", value: topCategory, icon: CategoryIcon, color: "#455a64" },
  ];

  const openDrilldown = (label: string) => {
    const set = (title: string, rows: typeof drilldownRows) => {
      setDrilldownTitle(title);
      setDrilldownRows(rows);
      setDrilldownOpen(true);
    };

    const row = (t: Ticket) => ({
      ticket_id: t.id,
      display_number: t.display_number,
      title: t.status,
      subtitle: `${t.priority}${t.category ? ` • ${t.category}` : ""}`,
    });

    if (label === "Total Tickets") {
      set("All Tickets", tickets.slice(0, 200).map(row));
      return;
    }
    if (label === "Open") {
      set("Open Tickets", tickets.filter((t) => t.status === "OPEN").slice(0, 200).map(row));
      return;
    }
    if (label === "In Progress") {
      set(
        "In Progress Tickets",
        tickets
          .filter((t) => t.status === "IN_PROGRESS" || t.status === "WAITING_FOR_CUSTOMER")
          .slice(0, 200)
          .map(row)
      );
      return;
    }
    if (label === "Resolved") {
      set(
        "Resolved Tickets",
        tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").slice(0, 200).map(row)
      );
      return;
    }
    if (label === "Top Category") {
      set(
        `Top Category: ${topCategory}`,
        tickets.filter((t) => (t.category || "Uncategorized") === topCategory).slice(0, 200).map(row)
      );
      return;
    }

    set(label, []);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 2, mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Reports
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your ticket activity and outcomes
          </Typography>
        </Box>
        <Chip label="Employee view" size="small" />
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
              <ButtonBase
                onClick={() => openDrilldown(k.label)}
                sx={{
                  width: "100%",
                  textAlign: "left",
                  borderRadius: 2,
                  transition: "transform 140ms ease, box-shadow 140ms ease",
                  "&:hover": { transform: "translateY(-3px)", boxShadow: 6 },
                  "&:active": { transform: "scale(0.99)" },
                }}
              >
                <Card sx={{ ...kpiCardSx(k.color), width: "100%" }}>
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
              </ButtonBase>
            </Grid>
          );
        })}
      </Grid>

      <Dialog
        open={drilldownOpen}
        onClose={() => setDrilldownOpen(false)}
        fullWidth
        maxWidth="md"
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: "hidden",
            transform: drilldownOpen ? "translateY(0)" : "translateY(6px)",
            transition: "transform 160ms ease, opacity 160ms ease",
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>{drilldownTitle}</DialogTitle>
        <DialogContent dividers>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Ticket</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {drilldownRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} sx={{ color: "text.secondary" }}>
                      No items.
                    </TableCell>
                  </TableRow>
                ) : (
                  drilldownRows.map((r) => (
                    <TableRow
                      key={r.ticket_id}
                      hover
                      onClick={() => {
                        setDrilldownOpen(false);
                        navigate(`/app/tickets/${r.ticket_id}`);
                      }}
                      sx={{ cursor: "pointer" }}
                    >
                      <TableCell sx={{ fontWeight: 700 }}>{r.display_number || r.ticket_id.slice(0, 8)}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {r.title}
                        </Typography>
                        {r.subtitle ? (
                          <Typography variant="body2" color="text.secondary">
                            {r.subtitle}
                          </Typography>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDrilldownOpen(false)} variant="outlined">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2.5, height: 360 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Ticket Status Overview
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Current distribution of your tickets
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={statusChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#1976d2" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 2.5, height: 360 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Recent Tickets
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Latest activity on your tickets
            </Typography>
            <TableContainer sx={{ maxHeight: 250 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Priority</TableCell>
                    <TableCell>Updated</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tickets
                    .slice()
                    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                    .slice(0, 8)
                    .map((t) => (
                      <TableRow
                        key={t.id}
                        hover
                        onClick={() => navigate(`/app/tickets/${t.id}`)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell sx={{ fontWeight: 700 }}>{t.display_number || t.id.slice(0, 8)}</TableCell>
                        <TableCell>{t.status}</TableCell>
                        <TableCell>{t.priority}</TableCell>
                        <TableCell>{new Date(t.updated_at).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  {!loading && tickets.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography color="text.secondary">No tickets yet.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
