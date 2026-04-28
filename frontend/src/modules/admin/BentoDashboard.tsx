import React from "react";
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
  Speed as SpeedIcon,
  CheckCircle as ResolvedIcon,
  TrendingUp as TrendingIcon,
  People as PeopleIcon,
  Assessment as ReportsIcon,
  Notifications as NotifIcon,
  SystemUpdate as SystemUpdateIcon,
  Schedule as ScheduleIcon,
} from "@mui/icons-material";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { api, getCachedData } from "../../services/api";
import { useNavigate } from "react-router-dom";

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
  type: 'ticket_created' | 'ticket_resolved' | 'user_login' | 'system_update';
  title: string;
  description: string;
  timestamp: string;
  user?: string;
  icon?: React.ReactNode;
};

type Ticket = {
  id: string;
  display_number?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  created_at: string;
  resolved_at: string | null;
  category: string | null;
};

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const initialTickets = getCachedData<{ items?: Ticket[]; tickets?: Ticket[] }>({ url: "/tickets" });
  const initialItems = initialTickets?.items ?? initialTickets?.tickets ?? [];
  const [tickets, setTickets] = React.useState<Ticket[]>(initialItems);
  const [activity, setActivity] = React.useState<ActivityItem[]>([]);
  const [drilldownOpen, setDrilldownOpen] = React.useState(false);
  const [drilldownTitle, setDrilldownTitle] = React.useState<string>("");
  const [drilldownRows, setDrilldownRows] = React.useState<
    Array<{ ticket_id: string; display_number?: string | null; title?: string | null; subtitle?: string | null }>
  >([]);

  const load = React.useCallback(async () => {
    try {
      const ticketsRes = await api.get<{ items?: Ticket[]; tickets?: Ticket[] }>("/tickets");
      const items = ticketsRes.data?.items ?? ticketsRes.data?.tickets ?? [];
      setTickets(items);
      // setLastUpdatedAt(new Date());

      // Mock activity data - replace with real API call
      setActivity([
        {
          id: '1',
          type: 'ticket_created',
          title: 'New ticket created',
          description: 'User reported login issue',
          timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          user: 'John Doe',
        },
        {
          id: '2',
          type: 'ticket_resolved',
          title: 'Ticket resolved',
          description: 'Email configuration issue fixed',
          timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
          user: 'Jane Smith',
        },
        {
          id: '3',
          type: 'system_update',
          title: 'System updated',
          description: 'Security patches applied',
          timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
      ]);
    } catch (err) {
      console.error("Dashboard load error:", err);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [load]);

  // Calculate stats
  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "OPEN").length;
  const inProgress = tickets.filter((t) => t.status === "IN_PROGRESS").length;
  const resolved = tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length;

  // Category data for pie chart
  const categoryCounts: Record<string, number> = {};
  tickets.forEach((t) => {
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
    { name: "Resolved", value: resolved, fill: "#10b981" },
  ];

  // Priority data for pie chart
  const priorityData = [
    { name: "High", value: tickets.filter(t => t.priority === "HIGH").length, fill: "#ef4444" },
    { name: "Medium", value: tickets.filter(t => t.priority === "MEDIUM").length, fill: "#f59e0b" },
    { name: "Low", value: tickets.filter(t => t.priority === "LOW").length, fill: "#10b981" },
  ];

  // Live weekly trend data derived from API tickets
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const dayLabel = (d: Date) =>
    d.toLocaleDateString(undefined, { weekday: "short" });
  const trendData = days.map((d) => {
    const dayStr = d.toDateString();
    const createdCount = tickets.filter((t) => {
      const c = new Date(t.created_at).toDateString();
      return c === dayStr;
    }).length;
    const resolvedCount = tickets.filter((t) => {
      if (!t.resolved_at) return false;
      const r = new Date(t.resolved_at).toDateString();
      return r === dayStr;
    }).length;
    return { name: dayLabel(d), tickets: createdCount, resolved: resolvedCount };
  });

  const quickActions = [
    { icon: <TicketIcon />, label: "Ticket", action: () => navigate("/admin/tickets") },
    { icon: <ReportsIcon />, label: "Report", action: () => navigate("/admin/reports") },
    { icon: <ScheduleIcon />, label: "Schedule", action: () => navigate("/admin/schedule") },
  ];

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'ticket_created': return <TicketIcon sx={{ color: '#3b82f6' }} />;
      case 'ticket_resolved': return <ResolvedIcon sx={{ color: '#10b981' }} />;
      case 'user_login': return <PeopleIcon sx={{ color: '#8b5cf6' }} />;
      case 'system_update': return <SystemUpdateIcon sx={{ color: '#f59e0b' }} />;
      default: return <NotifIcon sx={{ color: '#6b7280' }} />;
    }
  };

  const ticketLabel = (id: string, display?: string | null) => {
    return display || `#${id.slice(0, 8)}`;
  };

  const openDrilldown = (label: string) => {
    let rows: Array<{ ticket_id: string; display_number?: string | null; title?: string | null; subtitle?: string | null }> = [];
    if (label === "Total Tickets") {
      rows = tickets.map((t) => ({
        ticket_id: t.id,
        display_number: t.display_number,
        title: t.category,
        subtitle: `${t.status} • ${t.priority}`,
      }));
      setDrilldownTitle("All Tickets");
    } else if (label === "Open Tickets") {
      rows = tickets
        .filter((t) => t.status === "OPEN")
        .map((t) => ({
          ticket_id: t.id,
          display_number: t.display_number,
          title: t.category,
          subtitle: `${t.status} • ${t.priority}`,
        }));
      setDrilldownTitle("Open Tickets");
    } else if (label === "In Progress") {
      rows = tickets
        .filter((t) => t.status === "IN_PROGRESS" || t.status === "WAITING_FOR_CUSTOMER")
        .map((t) => ({
          ticket_id: t.id,
          display_number: t.display_number,
          title: t.category,
          subtitle: `${t.status} • ${t.priority}`,
        }));
      setDrilldownTitle("In Progress / Waiting");
    } else if (label === "Resolved") {
      rows = tickets
        .filter((t) => t.status === "RESOLVED" || t.status === "CLOSED")
        .map((t) => ({
          ticket_id: t.id,
          display_number: t.display_number,
          title: t.category,
          subtitle: `${t.status} • ${t.priority}`,
        }));
      setDrilldownTitle("Resolved / Closed");
    }

    setDrilldownRows(rows);
    setDrilldownOpen(true);
  };

  return (
    <DashboardContainer>
      {/* Header */}
      <HeaderSection>
        <Box>
          <Typography variant="h3" sx={{ fontWeight: 700, color: '#111827', mb: 1 }}>
            Admin Console
          </Typography>
          <Typography variant="body1" color="text.secondary">
            System overview and operational metrics
          </Typography>
        </Box>
      </HeaderSection>

      {/* KPI Cards */}
      <KpiGrid>
        <ButtonBase
          onClick={() => openDrilldown("Total Tickets")}
          sx={{ width: "100%", textAlign: "left", borderRadius: 2 }}
        >
          <MetricCard sx={{ width: "100%", cursor: "pointer" }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <MetricLabel>Total Tickets</MetricLabel>
                <TicketIcon sx={{ color: '#3b82f6', fontSize: 20 }} />
              </Box>
              <MetricValue sx={{ color: '#3b82f6' }}>{total}</MetricValue>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <MetricChange trend="up">
                  <TrendingIcon sx={{ fontSize: 14 }} />
                  +12% from last week
                </MetricChange>
                <Typography variant="caption" color="text.secondary">
                  All time
                </Typography>
              </Box>
            </CardContent>
          </MetricCard>
        </ButtonBase>

        <ButtonBase
          onClick={() => openDrilldown("Open Tickets")}
          sx={{ width: "100%", textAlign: "left", borderRadius: 2 }}
        >
          <MetricCard sx={{ width: "100%", cursor: "pointer" }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <MetricLabel>Open Tickets</MetricLabel>
                <TicketIcon sx={{ color: '#ef4444', fontSize: 20 }} />
              </Box>
              <MetricValue sx={{ color: '#ef4444' }}>{open}</MetricValue>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <MetricChange trend="down">
                  <TrendingIcon sx={{ fontSize: 14, transform: 'rotate(180deg)' }} />
                  -5% from yesterday
                </MetricChange>
                <Typography variant="caption" color="text.secondary">
                  Need attention
                </Typography>
              </Box>
            </CardContent>
          </MetricCard>
        </ButtonBase>

        <ButtonBase
          onClick={() => openDrilldown("In Progress")}
          sx={{ width: "100%", textAlign: "left", borderRadius: 2 }}
        >
          <MetricCard sx={{ width: "100%", cursor: "pointer" }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <MetricLabel>In Progress</MetricLabel>
                <SpeedIcon sx={{ color: '#f59e0b', fontSize: 20 }} />
              </Box>
              <MetricValue sx={{ color: '#f59e0b' }}>{inProgress}</MetricValue>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <MetricChange trend="neutral">
                  <TrendingIcon sx={{ fontSize: 14 }} />
                  0% change
                </MetricChange>
                <Typography variant="caption" color="text.secondary">
                  Being worked on
                </Typography>
              </Box>
            </CardContent>
          </MetricCard>
        </ButtonBase>

        <ButtonBase
          onClick={() => openDrilldown("Resolved")}
          sx={{ width: "100%", textAlign: "left", borderRadius: 2 }}
        >
          <MetricCard sx={{ width: "100%", cursor: "pointer" }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                <MetricLabel>Resolved</MetricLabel>
                <ResolvedIcon sx={{ color: '#10b981', fontSize: 20 }} />
              </Box>
              <MetricValue sx={{ color: '#10b981' }}>{resolved}</MetricValue>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <MetricChange trend="up">
                  <TrendingIcon sx={{ fontSize: 14 }} />
                  +8% from last week
                </MetricChange>
                <Typography variant="caption" color="text.secondary">
                  Completed
                </Typography>
              </Box>
            </CardContent>
          </MetricCard>
        </ButtonBase>
      </KpiGrid>

      {/* Charts and Actions */}
      <Grid container spacing={3}>
        {/* Status Distribution */}
        <Grid item xs={12} md={4}>
          <ChartContainer>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Status Distribution
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={statusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <RechartsTooltip />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </Grid>

        {/* Priority Breakdown */}
        <Grid item xs={12} md={4}>
          <ChartContainer>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Priority Breakdown
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
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

        {/* Weekly Trend */}
        <Grid item xs={12} md={4}>
          <ChartContainer>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 3 }}>
              Weekly Trend
            </Typography>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <RechartsTooltip />
                <Line type="monotone" dataKey="tickets" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
                <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
              </LineChart>
            </ResponsiveContainer>
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
                            {item.user && `${item.user} • `}
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
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={categoryData} layout="horizontal">
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" tick={{ fontSize: 12 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={100} />
            <RechartsTooltip />
            <Bar dataKey="value" radius={[0, 8, 8, 0]} fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </DashboardContainer>
  );
};
