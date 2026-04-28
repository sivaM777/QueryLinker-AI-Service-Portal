import React, { useState, useEffect } from "react";
import {
  Alert,
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Container,
  styled,
  Button,
} from "@mui/material";
import {
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Warning as WarningIcon,
  Assessment as AssessmentIcon,
  People as PeopleIcon,
  Assignment as AssignmentIcon,
  Info as InfoIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  Remove as RemoveIcon,
} from "@mui/icons-material";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { api } from "../../services/api";
import { subscribeToMetrics } from "../../services/socket.service";
import { formatDistanceToNow, subDays, format } from "date-fns";

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

const ActivityFeedCard = styled(Card)(() => ({
  padding: '24px',
  borderRadius: '16px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
  maxHeight: '400px',
  overflow: 'auto',
}));

// Types
type MetricData = {
  id: string;
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  target?: number;
  unit?: string;
  icon?: React.ReactNode;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
  sparklineData?: Array<{ x: string; y: number }>;
};

type ActivityItem = {
  id: string;
  type: string;
  title: string;
  description?: string;
  timestamp?: string;
  time?: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  user?: string;
  entityId?: string;
};

// Main CommandCenter Component
const CommandCenter: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<MetricData[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [performanceData, setPerformanceData] = useState<any[]>([]);
  const [hasTicketHistory, setHasTicketHistory] = useState(false);

  const loadData = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [ticketsRes, auditRes] = await Promise.all([
        api.get<{ items: any[]; total: number }>("/tickets", { params: { limit: 1000 } }).catch(() => ({ data: { items: [], total: 0 } })),
        api.get("/audit", { params: { limit: 10, offset: 0 } }).catch(() => ({ data: { data: [] } })),
      ]);

      const ticketPayload: any = ticketsRes.data ?? {};
      const tickets = Array.isArray(ticketPayload)
        ? ticketPayload
        : (ticketPayload.items || ticketPayload.data || []);
      const total = typeof ticketPayload.total === "number" ? ticketPayload.total : tickets.length;
      const open = tickets.filter((t: any) => t.status === 'OPEN').length;
      setHasTicketHistory(total > 0);

      // Calculate Time Ranges for Trends (Current vs Previous 7 days)
      const now = new Date();
      const oneWeekAgo = subDays(now, 7);
      const twoWeeksAgo = subDays(now, 14);

      const isCurrentPeriod = (d: Date) => d >= oneWeekAgo && d <= now;
      const isPreviousPeriod = (d: Date) => d >= twoWeeksAgo && d < oneWeekAgo;

      // 1. Total Tickets (Volume Trend)
      const currentPeriodTickets = tickets.filter((t: any) => t.created_at && isCurrentPeriod(new Date(t.created_at)));
      const previousPeriodTickets = tickets.filter((t: any) => t.created_at && isPreviousPeriod(new Date(t.created_at)));
      
      const currentTotal = currentPeriodTickets.length;
      const previousTotal = previousPeriodTickets.length;
      const volumeChange = previousTotal ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;

      // 2. Open Tickets (Backlog Trend)
      const openCount = tickets.filter((t: any) => t.status === 'OPEN').length;
      const currentResolvedCount = tickets.filter((t: any) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.resolved_at && isCurrentPeriod(new Date(t.resolved_at))).length;
      // Net change in backlog = Created - Resolved
      const netBacklogChange = currentTotal - currentResolvedCount;
      const startOfPeriodBacklog = Math.max(0, openCount - netBacklogChange);
      const backlogChange = startOfPeriodBacklog ? (netBacklogChange / startOfPeriodBacklog) * 100 : 0;

      // 3. Avg Resolution Time (Efficiency Trend)
      const calculateAvgRes = (subset: any[]) => {
        if (!subset.length) return 0;
        const totalTime = subset.reduce((acc: number, t: any) => {
             const created = new Date(t.created_at).getTime();
             const res = new Date(t.resolved_at).getTime();
             return acc + (res - created);
        }, 0);
        return totalTime / subset.length / (1000 * 60 * 60); // hours
      };

      const currentResolvedTickets = tickets.filter((t: any) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.resolved_at && isCurrentPeriod(new Date(t.resolved_at)));
      const previousResolvedTickets = tickets.filter((t: any) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.resolved_at && isPreviousPeriod(new Date(t.resolved_at)));
      
      const currentAvgRes = calculateAvgRes(currentResolvedTickets); 
      const prevAvgRes = calculateAvgRes(previousResolvedTickets);
      const resTimeChange = prevAvgRes ? ((currentAvgRes - prevAvgRes) / prevAvgRes) * 100 : 0;

      // 4. Satisfaction Rate (Quality Trend)
      const calculateSat = (subset: any[]) => {
          const withSentiment = subset.filter((t: any) => t.integration_metadata?.ai?.sentiment?.score !== undefined);
          if (!withSentiment.length) return 0;
          const avg = withSentiment.reduce((acc: number, t: any) => acc + (t.integration_metadata!.ai!.sentiment!.score || 0), 0) / withSentiment.length;
          return ((avg + 1) / 2) * 100;
      };
      
      // Use all tickets for overall satisfaction, but calculate trend based on recent
      const allWithSentiment = tickets.filter((t: any) => t.integration_metadata?.ai?.sentiment?.score !== undefined);
      const overallAvgSentiment = allWithSentiment.length 
        ? allWithSentiment.reduce((acc: number, t: any) => acc + (t.integration_metadata!.ai!.sentiment!.score || 0), 0) / allWithSentiment.length
        : 0;
      const satisfactionRate = allWithSentiment.length ? ((overallAvgSentiment + 1) / 2) * 100 : 0;

      const currentSat = calculateSat(currentPeriodTickets);
      const prevSat = calculateSat(previousPeriodTickets);
      const satChange = prevSat ? ((currentSat - prevSat) / prevSat) * 100 : 0;

      // Generate Performance Data (Last 7 Days)
      const days = [];
      for (let i = 6; i >= 0; i--) {
        days.push(subDays(now, i));
      }

      const perfData = days.map(day => {
        const nextDay = new Date(day);
         nextDay.setDate(day.getDate() + 1);
         // Reset times to compare dates properly
         const dayStart = new Date(day);
         dayStart.setHours(0,0,0,0);
         const dayEnd = new Date(nextDay);
         dayEnd.setHours(0,0,0,0);
         
         const createdCount = tickets.filter((t: any) => {
            const d = new Date(t.created_at);
            return d >= dayStart && d < dayEnd;
        }).length;

        const resolvedToday = tickets.filter((t: any) => {
            if (!t.resolved_at) return false;
            const d = new Date(t.resolved_at);
            return d >= dayStart && d < dayEnd;
        });

        const resolvedCount = resolvedToday.length;

        const avgResTime = resolvedToday.length ? resolvedToday.reduce((acc: number, t: any) => {
            return acc + (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime());
        }, 0) / resolvedToday.length / (1000 * 60 * 60) : 0;

        return {
            name: format(day, 'EEE'), // Mon, Tue...
            tickets: createdCount,
            ticketsHandled: resolvedCount,
            responseTime: Number(avgResTime.toFixed(1))
        };
      });
      
      setPerformanceData(perfData);

      const deriveTrend = (change: number, options?: { inverseGood?: boolean; hasBaseline?: boolean }) => {
        if (!options?.hasBaseline || Math.abs(change) < 0.05) return 'neutral' as const;
        if (options.inverseGood) {
          return change <= 0 ? 'up' as const : 'down' as const;
        }
        return change >= 0 ? 'up' as const : 'down' as const;
      };

      setMetrics([
        {
          id: '1',
          title: 'Total Tickets',
          value: total,
          change: Number(volumeChange.toFixed(1)),
          trend: deriveTrend(volumeChange, { hasBaseline: previousTotal > 0 }),
        },
        {
          id: '2',
          title: 'Open Tickets',
          value: open,
          change: Number(backlogChange.toFixed(1)),
          trend: deriveTrend(backlogChange, { hasBaseline: startOfPeriodBacklog > 0 }),
        },
        {
          id: '3',
          title: 'Avg Resolution',
          value: currentResolvedTickets.length ? `${currentAvgRes.toFixed(1)}h` : '--',
          change: Number(resTimeChange.toFixed(1)),
          trend: deriveTrend(resTimeChange, { inverseGood: true, hasBaseline: prevAvgRes > 0 }),
        },
        {
          id: '4',
          title: 'Satisfaction Rate',
          value: allWithSentiment.length ? `${satisfactionRate.toFixed(1)}%` : '--',
          change: Number(satChange.toFixed(1)),
          trend: deriveTrend(satChange, { hasBaseline: prevSat > 0 }),
        },
      ]);

      const auditItems = auditRes.data?.data || [];
      setActivities(auditItems.map((log: any) => ({
        id: log.id,
        type:
          String(log.action || '').toLowerCase().includes('create') ? 'ticket_created' :
          String(log.action || '').toLowerCase().includes('assign') ? 'ticket_assigned' :
          String(log.action || '').toLowerCase().includes('update') ? 'updated' :
          String(log.action || '').toLowerCase().includes('delete') ? 'deleted' :
          String(log.action || '').toLowerCase().includes('export') ? 'exported' :
          String(log.action || '').toLowerCase().includes('view') ? 'viewed' : 'system_alert',
        title: buildActivityTitle(log),
        description: log.field_name ? `Field: ${log.field_name}` : `${log.entity_type} · ${shortId(log.entity_id)}`,
        user: log.user_email || 'System',
        time: log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : '',
        severity: deriveActivitySeverity(log.action)
      })));

    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const unsubscribe = subscribeToMetrics("dashboard", () => void loadData(true));
    const interval = window.setInterval(() => void loadData(true), 30000);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [loadData]);

  if (loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Loading Command Center...</Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            Command Center
          </Typography>
          <Typography color="text.secondary">
            Live operational snapshot across tickets, activity, and service performance.
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void loadData()}>
          Refresh
        </Button>
      </Box>
      
      {/* Metrics Grid */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {metrics.map((metric) => (
          <Grid item xs={12} sm={6} md={3} key={metric.id}>
            <MetricCard>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                  <AssessmentIcon sx={{ mr: 1, color: 'primary.main' }} />
                  <Typography variant="h6" component="div">
                    {metric.title}
                  </Typography>
                </Box>
                <Typography variant="h4" component="div" sx={{ fontWeight: 600 }}>
                  {metric.value}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                  {metric.trend === 'up' ? (
                    <TrendingUpIcon sx={{ color: 'success.main', mr: 1 }} />
                  ) : metric.trend === 'down' ? (
                    <TrendingDownIcon sx={{ color: 'error.main', mr: 1 }} />
                  ) : (
                    <RemoveIcon sx={{ color: 'text.secondary', mr: 1 }} />
                  )}
                  <Typography 
                    variant="body2" 
                    color={metric.trend === 'up' ? 'success.main' : metric.trend === 'down' ? 'error.main' : 'text.secondary'}
                  >
                    {metric.trend === 'neutral' ? 'No change yet' : `${metric.change}%`}
                  </Typography>
                </Box>
              </CardContent>
            </MetricCard>
          </Grid>
        ))}
      </Grid>

      {/* Charts and Activity */}
      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <ChartContainer>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Performance Overview
            </Typography>
            {hasTicketHistory ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <RechartsTooltip />
                  <Legend />
                  <Line type="monotone" dataKey="responseTime" stroke="#3b82f6" name="Response Time (h)" />
                  <Line type="monotone" dataKey="ticketsHandled" stroke="#10b981" name="Tickets Handled" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Alert severity="info" sx={{ borderRadius: 3, mt: 2 }}>
                No ticket activity is available yet for this organization. Create or import tickets to populate the
                performance chart.
              </Alert>
            )}
          </ChartContainer>
        </Grid>
        
        <Grid item xs={12} md={4}>
          <ActivityFeedCard>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Recent Activity
            </Typography>
            {activities.length === 0 ? (
              <Alert severity="info" sx={{ borderRadius: 3 }}>
                No recent activity has been recorded yet.
              </Alert>
            ) : (
              <List>
                {activities.map((activity) => (
                  <ListItem key={activity.id} sx={{ px: 0, alignItems: 'flex-start' }}>
                    <ListItemIcon>
                      {getActivityIcon(activity.type)}
                    </ListItemIcon>
                    <ListItemText
                      primary={activity.title}
                      secondary={
                        <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.25 }}>
                          <Typography component="span" variant="body2" color="text.secondary">
                            {activity.description}
                          </Typography>
                          <Typography component="span" variant="caption" color="text.secondary">
                            {activity.user} · {activity.time}
                          </Typography>
                        </Box>
                      }
                    />
                    <Chip 
                      size="small" 
                      label={activity.severity}
                      color={activity.severity === 'error' ? 'error' : activity.severity === 'warning' ? 'warning' : activity.severity === 'success' ? 'success' : 'info'}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </ActivityFeedCard>
        </Grid>
      </Grid>
    </Container>
  );
};

// Helper function to get activity icon
const getActivityIcon = (type: string) => {
  switch (type) {
    case 'ticket_created': return <AssignmentIcon />;
    case 'ticket_assigned': return <PeopleIcon />;
    case 'updated': return <EditIcon />;
    case 'deleted': return <DeleteIcon color="error" />;
    case 'exported': return <DownloadIcon />;
    case 'viewed': return <InfoIcon color="info" />;
    case 'system_alert': return <WarningIcon />;
    default: return <InfoIcon />;
  }
};

const deriveActivitySeverity = (action: string): ActivityItem['severity'] => {
  const normalized = String(action || '').toLowerCase();
  if (normalized.includes('delete') || normalized.includes('fail') || normalized.includes('error')) return 'error';
  if (normalized.includes('create')) return 'success';
  if (normalized.includes('update') || normalized.includes('export') || normalized.includes('share')) return 'warning';
  return 'info';
};

const buildActivityTitle = (log: any) => {
  const action = String(log.action || '').toLowerCase();
  const entity = String(log.entity_type || 'record');
  if (action === 'viewed') return `Viewed ${entity}`;
  if (action === 'created') return `Created ${entity}`;
  if (action === 'updated') return `Updated ${entity}`;
  if (action === 'deleted') return `Deleted ${entity}`;
  if (action === 'exported') return `Exported ${entity}`;
  return `${log.action} ${entity}`.trim();
};

const shortId = (value?: string | null) => {
  if (!value) return '-';
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
};

export default CommandCenter;
