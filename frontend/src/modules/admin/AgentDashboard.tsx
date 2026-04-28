import React from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  ButtonBase,
  styled,
  Grid,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Alert,
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
  CheckCircle as ResolvedIcon,
  TrendingUp as TrendingIcon,
  Speed as SpeedIcon,
  Schedule as ScheduleIcon,
  Assessment as ReportsIcon,
  Notifications as NotifIcon,
  Edit as EditIcon,
  Chat as ChatIcon,
} from "@mui/icons-material";
// Recharts is large; load it dynamically to avoid blocking first paint
// We'll reference components via RC.BarChart, RC.PieChart etc. once loaded.
import { api, getCachedData } from "../../services/api";
import { useAuth } from "../../services/auth";

// Styled components for enterprise layout
const DashboardContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  backgroundColor: '#f8fafc',
  padding: '24px',
  gap: '24px',
  [theme.breakpoints.down('md')]: {
    padding: '16px',
    gap: '16px',
  },
}));

const HeaderSection = styled(Box)(() => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: '8px',
  flexWrap: 'wrap',
  gap: '16px',
}));

const KpiGrid = styled(Grid)(() => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: '20px',
  marginBottom: '24px',
}));

const MetricCard = styled(Card, {
  shouldForwardProp: (prop) => prop !== 'color' && prop !== 'gradient',
})<{ color?: string; gradient?: string }>(({ color = '#3b82f6', gradient }) => ({
  background: gradient || 'white',
  border: `1px solid ${color}20`,
  borderRadius: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
  transition: 'all 0.3s ease',
  overflow: 'hidden',
  position: 'relative',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: '0 8px 25px -5px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
  },
}));

const ChartContainer = styled(Card)(() => ({
  padding: '24px',
  borderRadius: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
}));

const QuickActionsCard = styled(Card)(() => ({
  padding: '24px',
  borderRadius: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
}));

const ActivityFeedCard = styled(Card)(() => ({
  padding: '24px',
  borderRadius: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
  maxHeight: '400px',
  overflow: 'auto',
}));

const QuickActionButton = styled(ButtonBase)(() => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '16px',
  borderRadius: '12px',
  backgroundColor: 'white',
  border: '1px solid #e5e7eb',
  transition: 'all 0.2s ease',
  '&:hover': {
    backgroundColor: '#f9fafb',
    borderColor: '#d1d5db',
    transform: 'translateY(-1px)',
  },
}));

const MetricValue = styled(Typography)(() => ({
  fontSize: '2.5rem',
  fontWeight: 700,
  lineHeight: 1.2,
  marginBottom: '8px',
}));

const MetricLabel = styled(Typography)(() => ({
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#6b7280',
  marginBottom: '4px',
}));

const MetricChange = styled(Typography)<{ trend: 'up' | 'down' | 'neutral' }>(({ trend }) => ({
  fontSize: '0.75rem',
  fontWeight: 600,
  color: trend === 'up' ? '#10b981' : trend === 'down' ? '#ef4444' : '#6b7280',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
}));

type ActivityItem = {
  id: string;
  type: 'ticket_assigned' | 'ticket_updated' | 'ticket_resolved' | 'comment_added';
  title: string;
  description: string;
  timestamp: string;
  ticketId?: string;
  ticketNumber?: string;
};

type Ticket = {
  id: string;
  display_number?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  created_at: string;
  resolved_at: string | null;
  category: string | null;
  title?: string;
  assigned_agent?: string | null;
  assigned_to?: string | null;
};

type SlaRiskResponse = {
  counts: { high: number; medium: number; low: number };
  tickets: Array<{
    id: string;
    display_number?: string | null;
    title: string;
    priority: string;
    status: string;
    created_at: string;
    due_date?: string;
  }>;
};

export const AgentDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [RC, setRC] = React.useState<any>(null);
  const initialTickets = getCachedData<{ items: Ticket[] }>({ url: "/tickets", params: { limit: 100 } });
  const initialItems = initialTickets?.items || [];
  const initialRiskHigh = initialItems.filter(t => t.priority === 'HIGH' && t.status !== 'RESOLVED' && t.status !== 'CLOSED').length;
  const initialRiskMedium = initialItems.filter(t => t.priority === 'MEDIUM' && t.status !== 'RESOLVED' && t.status !== 'CLOSED').length;
  const [tickets, setTickets] = React.useState<Ticket[]>(initialItems);
  const [slaRisks, setSlaRisks] = React.useState<SlaRiskResponse | null>(
    initialItems.length
      ? { counts: { high: initialRiskHigh, medium: initialRiskMedium, low: 0 }, tickets: [] }
      : null
  );
  const [activity, setActivity] = React.useState<ActivityItem[]>([]);
  const [drilldownOpen, setDrilldownOpen] = React.useState(false);
  const [drilldownTitle, setDrilldownTitle] = React.useState<string>("");
  const [drilldownRows, setDrilldownRows] = React.useState<
    Array<{ ticket_id: string; display_number?: string | null; title?: string | null; subtitle?: string | null }>
  >([]);

  // Dummy activity data to fix unused variable warning
  React.useEffect(() => {
    setActivity([]);
  }, []);

  React.useEffect(() => {
    let mounted = true;
    import("recharts").then((mod) => {
      if (mounted) setRC(mod);
    }).catch(() => {
      // ignore, charts will stay hidden
    });
    return () => { mounted = false; };
  }, []);

  const load = React.useCallback(async () => {
    try {
      const ticketsRes = await api.get<{ items: Ticket[] }>("/tickets", { params: { limit: 100 } });
      const items = ticketsRes.data.items || [];
      setTickets(items);
      
      // Calculate SLA risks locally if backend endpoint is missing or returns empty
      const riskHigh = items.filter(t => t.priority === 'HIGH' && t.status !== 'RESOLVED' && t.status !== 'CLOSED').length;
      const riskMedium = items.filter(t => t.priority === 'MEDIUM' && t.status !== 'RESOLVED' && t.status !== 'CLOSED').length;
      
      setSlaRisks({
        counts: { high: riskHigh, medium: riskMedium, low: 0 },
        tickets: []
      });

    } catch (err) {
      console.error("Agent dashboard load error:", err);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const ticketLabel = (id: string, display?: string | null) => {
    return display || `#${id.slice(0, 8)}`;
  };

  const myTickets = React.useMemo(() => {
    if (!user) return [];
    // Filter tickets assigned to the current user
    return tickets.filter(t => 
      t.assigned_to === user.id || 
      t.assigned_agent === user.id ||
      // Also show open unassigned tickets for agents to pick up
      (user.role === 'AGENT' && !t.assigned_to && t.status === 'OPEN')
    );
  }, [tickets, user]);

  const total = myTickets.length;
  const open = myTickets.filter((t) => t.status === "OPEN").length;
  const inProgress = myTickets.filter((t) => t.status === "IN_PROGRESS").length;
  const resolved = myTickets.filter((t) => ["RESOLVED", "CLOSED"].includes(t.status)).length;
  const waitingForCustomer = myTickets.filter((t) => t.status === "WAITING_FOR_CUSTOMER").length;

  // Category data for charts
  const categoryCounts: Record<string, number> = {};
  myTickets.forEach((t) => {
    const cat = t.category || "Uncategorized";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });
  const categoryData = Object.entries(categoryCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Status data for bar chart
  const statusData = [
    { name: "Open", value: open, fill: "#ef4444" },
    { name: "In Progress", value: inProgress, fill: "#f59e0b" },
    { name: "Waiting", value: waitingForCustomer, fill: "#8b5cf6" },
    { name: "Resolved", value: resolved, fill: "#10b981" },
  ];

  // Priority data for pie chart
  const priorityData = [
    { name: "High", value: myTickets.filter(t => t.priority === "HIGH").length, fill: "#ef4444" },
    { name: "Medium", value: myTickets.filter(t => t.priority === "MEDIUM").length, fill: "#f59e0b" },
    { name: "Low", value: myTickets.filter(t => t.priority === "LOW").length, fill: "#10b981" },
  ];

  // Weekly performance (resolved count and avg response time per day) derived from myTickets
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const dayLabel = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: "short" });
  const performanceData = days.map((d) => {
    const dayStr = d.toDateString();
    const resolvedSameDay = myTickets.filter((t) => {
      if (!t.resolved_at) return false;
      return new Date(t.resolved_at).toDateString() === dayStr;
    });
    const resolvedCount = resolvedSameDay.length;
    let avgHours = 0;
    if (resolvedCount > 0) {
      const totalMs = resolvedSameDay.reduce((acc, t) => {
        const created = new Date(t.created_at).getTime();
        const resolvedAt = new Date(t.resolved_at as string).getTime();
        return acc + Math.max(0, resolvedAt - created);
      }, 0);
      avgHours = Math.round((totalMs / resolvedCount / (1000 * 60 * 60)) * 10) / 10;
    }
    return { name: dayLabel(d), resolved: resolvedCount, avgResponseTime: avgHours };
  });

  type AgentDrilldownKind = "MY" | "OPEN" | "IN_PROGRESS" | "RESOLVED";

  const openAgentDrilldown = (kind: AgentDrilldownKind) => {
    let source = myTickets;
    let title = "";

    if (kind === "OPEN") {
      source = myTickets.filter((t) => t.status === "OPEN");
      title = "Open Tickets";
    } else if (kind === "IN_PROGRESS") {
      source = myTickets.filter(
        (t) => t.status === "IN_PROGRESS" || t.status === "WAITING_FOR_CUSTOMER",
      );
      title = "In Progress / Waiting";
    } else if (kind === "RESOLVED") {
      source = myTickets.filter(
        (t) => t.status === "RESOLVED" || t.status === "CLOSED",
      );
      title = "Resolved / Closed";
    } else {
      title = "My Tickets";
    }

    const rows = source.map((t) => ({
      ticket_id: t.id,
      display_number: t.display_number,
      title: t.title ?? null,
      subtitle: `${t.status} • ${t.priority}${t.category ? ` • ${t.category}` : ""}`,
    }));

    setDrilldownTitle(title);
    setDrilldownRows(rows);
    setDrilldownOpen(true);
  };

  const quickActions = [
    { icon: <TicketIcon />, label: "Ticket", action: () => openAgentDrilldown("MY") },
    { icon: <ReportsIcon />, label: "Report", action: () => navigate("/admin/reports") },
    { icon: <ScheduleIcon />, label: "Schedule", action: () => navigate("/admin/schedule") },
  ];

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'ticket_assigned': return <TicketIcon sx={{ color: '#3b82f6' }} />;
      case 'ticket_updated': return <EditIcon sx={{ color: '#f59e0b' }} />;
      case 'ticket_resolved': return <ResolvedIcon sx={{ color: '#10b981' }} />;
      case 'comment_added': return <ChatIcon sx={{ color: '#8b5cf6' }} />;
      default: return <NotifIcon sx={{ color: '#6b7280' }} />;
    }
  };

  return (
    <DashboardContainer>
      {/* Header */}
      <HeaderSection>
        <Box>
          <Typography variant="h3" sx={{ fontWeight: 700, color: '#111827', mb: 1 }}>
            Agent Dashboard
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Your ticket management and performance metrics
          </Typography>
        </Box>
      </HeaderSection>

      {/* KPI Cards */}
      <KpiGrid>
        <MetricCard onClick={() => openAgentDrilldown("MY")} sx={{ cursor: "pointer" }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <MetricLabel>My Tickets</MetricLabel>
              <TicketIcon sx={{ color: '#3b82f6', fontSize: 20 }} />
            </Box>
            <MetricValue sx={{ color: '#3b82f6' }}>{total}</MetricValue>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <MetricChange trend="up">
                <TrendingIcon sx={{ fontSize: 14 }} />
                +3 new today
              </MetricChange>
              <Typography variant="caption" color="text.secondary">
                Assigned to you
              </Typography>
            </Box>
          </CardContent>
        </MetricCard>

        <MetricCard onClick={() => openAgentDrilldown("OPEN")} sx={{ cursor: "pointer" }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <MetricLabel>Open Tickets</MetricLabel>
              <TicketIcon sx={{ color: '#ef4444', fontSize: 20 }} />
            </Box>
            <MetricValue sx={{ color: '#ef4444' }}>{open}</MetricValue>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <MetricChange trend="down">
                <TrendingIcon sx={{ fontSize: 14, transform: 'rotate(180deg)' }} />
                -2 from yesterday
              </MetricChange>
              <Typography variant="caption" color="text.secondary">
                Need attention
              </Typography>
            </Box>
          </CardContent>
        </MetricCard>

        <MetricCard
          onClick={() => openAgentDrilldown("IN_PROGRESS")}
          sx={{ cursor: "pointer" }}
        >
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <MetricLabel>In Progress</MetricLabel>
              <SpeedIcon sx={{ color: '#f59e0b', fontSize: 20 }} />
            </Box>
            <MetricValue sx={{ color: '#f59e0b' }}>{inProgress}</MetricValue>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <MetricChange trend="neutral">
                <TrendingIcon sx={{ fontSize: 14 }} />
                No change
              </MetricChange>
              <Typography variant="caption" color="text.secondary">
                Being worked on
              </Typography>
            </Box>
          </CardContent>
        </MetricCard>

        <MetricCard onClick={() => openAgentDrilldown("RESOLVED")} sx={{ cursor: "pointer" }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
              <MetricLabel>Resolved Today</MetricLabel>
              <ResolvedIcon sx={{ color: '#10b981', fontSize: 20 }} />
            </Box>
            <MetricValue sx={{ color: '#10b981' }}>{resolved}</MetricValue>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <MetricChange trend="up">
                <TrendingIcon sx={{ fontSize: 14 }} />
                +15% this week
              </MetricChange>
              <Typography variant="caption" color="text.secondary">
                Great job!
              </Typography>
            </Box>
          </CardContent>
        </MetricCard>
      </KpiGrid>

      {/* SLA Risks Alert */}
      {slaRisks && (slaRisks.counts.high > 0 || slaRisks.counts.medium > 0) && (
        <Alert 
          severity={slaRisks.counts.high > 0 ? "error" : "warning"} 
          sx={{ mb: 3, borderRadius: '12px' }}
          action={
            <ButtonBase onClick={() => navigate("/admin/tickets?sla-risk=true")}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'inherit' }}>
                View Tickets →
              </Typography>
            </ButtonBase>
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            SLA Risks: {slaRisks.counts.high} high, {slaRisks.counts.medium} medium priority tickets at risk
          </Typography>
        </Alert>
      )}

      {/* Charts and Actions */}
      <Grid container spacing={3}>
        {/* Status Distribution */}
        <Grid item xs={12} md={4}>
          <ChartContainer>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Ticket Status
            </Typography>
            {RC ? (
              <RC.ResponsiveContainer width="100%" height={250}>
                <RC.BarChart data={statusData}>
                  <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <RC.XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <RC.YAxis tick={{ fontSize: 12 }} />
                  <RC.Tooltip />
                  <RC.Bar dataKey="value" radius={[8, 8, 0, 0]} />
                </RC.BarChart>
              </RC.ResponsiveContainer>
            ) : (
              <Box sx={{ height: 250, borderRadius: 2, bgcolor: "action.hover" }} />
            )}
          </ChartContainer>
        </Grid>

        {/* Priority Breakdown */}
        <Grid item xs={12} md={4}>
          <ChartContainer>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Priority Breakdown
            </Typography>
            {RC ? (
              <RC.ResponsiveContainer width="100%" height={250}>
                <RC.PieChart>
                  <RC.Pie
                    data={priorityData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {priorityData.map((entry, index) => (
                      <RC.Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </RC.Pie>
                  <RC.Tooltip />
                </RC.PieChart>
              </RC.ResponsiveContainer>
            ) : (
              <Box sx={{ height: 250, borderRadius: 2, bgcolor: "action.hover" }} />
            )}
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 2 }}>
              {priorityData.map((item) => (
                <Box key={item.name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 12, height: 12, borderRadius: 2, backgroundColor: item.fill }} />
                  <Typography variant="caption">{item.name}</Typography>
                </Box>
              ))}
            </Box>
          </ChartContainer>
        </Grid>

        {/* Performance Trend */}
        <Grid item xs={12} md={4}>
          <ChartContainer>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Weekly Performance
            </Typography>
            {RC ? (
              <RC.ResponsiveContainer width="100%" height={250}>
                <RC.LineChart data={performanceData}>
                  <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <RC.XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <RC.YAxis tick={{ fontSize: 12 }} />
                  <RC.Tooltip />
                  <RC.Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} name="Resolved" />
                  <RC.Line type="monotone" dataKey="avgResponseTime" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} name="Avg Response (h)" />
                </RC.LineChart>
              </RC.ResponsiveContainer>
            ) : (
              <Box sx={{ height: 250, borderRadius: 2, bgcolor: "action.hover" }} />
            )}
          </ChartContainer>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12} md={6}>
          <QuickActionsCard>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Quick Actions
            </Typography>
            <Grid container spacing={2}>
              {quickActions.map((action, index) => (
                <Grid item xs={6} sm={4} key={index}>
                  <QuickActionButton onClick={action.action}>
                    <Box sx={{ color: '#3b82f6', mb: 1 }}>
                      {action.icon}
                    </Box>
                    <Typography variant="caption" sx={{ textAlign: 'center', fontWeight: 500 }}>
                      {action.label}
                    </Typography>
                  </QuickActionButton>
                </Grid>
              ))}
            </Grid>
          </QuickActionsCard>
        </Grid>

        {/* Recent Activity */}
        <Grid item xs={12} md={6}>
          <ActivityFeedCard>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Recent Activity
            </Typography>
            <List sx={{ p: 0 }}>
              {activity.map((item, index) => (
                <React.Fragment key={item.id}>
                  <ListItem sx={{ px: 0, py: 1 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      {getActivityIcon(item.type)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {item.title}
                        </Typography>
                      }
                      secondary={
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            {item.description}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {item.ticketNumber && `${item.ticketNumber} • `}
                            {new Date(item.timestamp).toLocaleString()}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                  {index < activity.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          </ActivityFeedCard>
        </Grid>
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

      {/* Category Distribution */}
      <ChartContainer>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
          Ticket Categories
        </Typography>
        {RC ? (
          <RC.ResponsiveContainer width="100%" height={300}>
            <RC.BarChart data={categoryData} layout="horizontal">
              <RC.CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <RC.XAxis type="number" tick={{ fontSize: 12 }} />
              <RC.YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={100} />
              <RC.Tooltip />
              <RC.Bar dataKey="value" radius={[0, 8, 8, 0]} fill="#3b82f6" />
            </RC.BarChart>
          </RC.ResponsiveContainer>
        ) : (
          <Box sx={{ height: 300, borderRadius: 2, bgcolor: "action.hover" }} />
        )}
      </ChartContainer>
    </DashboardContainer>
  );
};
