import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Box,
  Typography,
  ButtonBase,
  styled,
  LinearProgress,
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
  Grid,
  Card,
  Avatar,
  Chip,
} from "@mui/material";
import {
  FactCheck as ApprovalsIcon,
  Speed as SlaIcon,
  Assessment as AssessmentIcon,
  Group as TeamIcon,
  Schedule as ScheduleIcon,
  Warning as WarningIcon,
  CheckCircle as CheckIcon,
  TrendingUp as TrendingIcon,
} from "@mui/icons-material";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { api, getApiErrorMessage, getCachedData } from "../../services/api";
import { subscribeToMetrics } from "../../services/socket.service";

// Styled components matching Admin/Agent dashboards
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

type PendingApprovalsResponse = {
  items: Array<{
    id: string;
    ticket_id: string;
    ticket_display_number?: string | null;
    ticket_title?: string | null;
    status: string;
    created_at: string;
    action_title: string;
  }>;
  total: number;
};

type SlaRiskResponse = {
  counts: { high: number; medium: number; low: number };
  tickets: Array<{ id: string; display_number?: string | null; title: string; priority: string; status: string; risk: string | null }>;
};

type Ticket = {
  id: string;
  display_number?: string | null;
  title?: string | null;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  created_at: string;
};

type AgentWorkload = {
  id: string;
  name: string;
  email: string;
  role: string;
  open_tickets: number;
  in_progress_tickets: number;
  high_priority_count: number;
  medium_priority_count: number;
  low_priority_count: number;
  weighted_score: number;
};

type WorkloadRecommendation = {
  ticket_id: string;
  display_number?: string | null;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER";
  reason: string;
  from_agent: { id: string; name: string; email: string };
  to_agent: { id: string; name: string; email: string };
};

type TeamOverviewTicket = {
  id: string;
  display_number?: string | null;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
  assigned_agent: string | null;
};

type TeamOverviewResponse = {
  agents: AgentWorkload[];
  summary: {
    active_tickets: number;
    open: number;
    in_progress: number;
    high_priority: number;
  };
  tickets: {
    open: TeamOverviewTicket[];
    in_progress: TeamOverviewTicket[];
    high_priority: TeamOverviewTicket[];
  };
};

const AnimatedNumber = ({ value }: { value: number }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, ease: "easeOut" }}
  >
    <Typography variant="h2" sx={{ fontWeight: 800, fontSize: '2.5rem' }}>
      {value}
    </Typography>
  </motion.div>
);

export const ManagerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const initialApprovals = getCachedData<PendingApprovalsResponse>({
    url: "/approvals/pending",
    params: { limit: 5, offset: 0, status: "pending" },
  });
  const initialSlaRisk = getCachedData<SlaRiskResponse>({ url: "/analytics/sla-risk" });
  const initialTickets = getCachedData<{ items: Ticket[]; total: number }>({ url: "/tickets", params: { limit: 1000, offset: 0 } });
  const initialWorkload = getCachedData<{ agents: AgentWorkload[] }>({ url: "/analytics/agent-workload" });
  const initialTeamOverview = getCachedData<TeamOverviewResponse>({ url: "/analytics/team-overview" });
  const [error, setError] = React.useState("");
  const [approvals, setApprovals] = React.useState<PendingApprovalsResponse | null>(initialApprovals || null);
  const [slaRisk, setSlaRisk] = React.useState<SlaRiskResponse | null>(initialSlaRisk || null);
  const [tickets, setTickets] = React.useState<{ items: Ticket[]; total: number } | null>(initialTickets || null);
  const [agentWorkload, setAgentWorkload] = React.useState<AgentWorkload[]>(initialWorkload?.agents || []);
  const [teamOverview, setTeamOverview] = React.useState<TeamOverviewResponse | null>(initialTeamOverview || null);
  const [workloadOpen, setWorkloadOpen] = React.useState(false);
  const [workloadRecommendations, setWorkloadRecommendations] = React.useState<WorkloadRecommendation[]>([]);
  const [workloadRecommendationsLoading, setWorkloadRecommendationsLoading] = React.useState(false);
  const [rebalancing, setRebalancing] = React.useState(false);
  const [rebalanceSummary, setRebalanceSummary] = React.useState("");
  const [drilldownOpen, setDrilldownOpen] = React.useState(false);
  const [drilldownTitle, setDrilldownTitle] = React.useState<string>("");
  const [drilldownRows, setDrilldownRows] = React.useState<
    Array<{ ticket_id: string; display_number?: string | null; title?: string | null; subtitle?: string | null }>
  >([]);

  const loadData = React.useCallback(async () => {
    setError("");
    try {
      const [aRes, slaRes, tRes, wRes, teamRes] = await Promise.all([
        api.get<PendingApprovalsResponse>("/approvals/pending", { params: { limit: 5, offset: 0, status: "pending" } }).catch(
          () => ({ data: { items: [], total: 0 } as PendingApprovalsResponse })
        ),
        api.get<SlaRiskResponse>("/analytics/sla-risk").catch(() => ({ data: null as any })),
        api.get<{ items: Ticket[]; total: number }>("/tickets", { params: { limit: 1000, offset: 0 } }).catch(() => ({ data: { items: [], total: 0 } as any })),
        api.get<{ agents: AgentWorkload[] }>("/analytics/agent-workload").catch(() => ({ data: { agents: [] } })),
        api.get<TeamOverviewResponse>("/analytics/team-overview").catch(() => ({ data: null as any })),
      ]);

      setApprovals(aRes.data || { items: [], total: 0 });
      setSlaRisk(slaRes.data || null);
      setTickets(tRes.data || { items: [], total: 0 });
      setAgentWorkload(wRes.data?.agents || []);
      setTeamOverview(teamRes.data || null);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load manager dashboard"));
    }
  }, []);

  const loadWorkloadRecommendations = React.useCallback(async () => {
    setWorkloadRecommendationsLoading(true);
    try {
      const res = await api.get<{ recommendations: WorkloadRecommendation[] }>(
        "/analytics/agent-workload/recommendations",
        { params: { limit: 20 } }
      );
      setWorkloadRecommendations(res.data.recommendations || []);
    } catch {
      setWorkloadRecommendations([]);
    } finally {
      setWorkloadRecommendationsLoading(false);
    }
  }, []);

  const runAutoRebalance = async () => {
    setRebalancing(true);
    setRebalanceSummary("");
    try {
      const res = await api.post<{
        moved: Array<{ ticket_id: string; to_agent_id: string }>;
        skipped: Array<{ ticket_id: string; reason: string }>;
      }>("/analytics/agent-workload/rebalance", {
        dry_run: false,
        max_moves: 20,
      });
      const movedCount = res.data.moved?.length || 0;
      const skippedCount = res.data.skipped?.length || 0;
      setRebalanceSummary(`Rebalance complete. Moved ${movedCount} ticket(s). Skipped ${skippedCount}.`);
      await Promise.all([loadData(), loadWorkloadRecommendations()]);
    } catch (e: unknown) {
      setRebalanceSummary(getApiErrorMessage(e, "Failed to auto-rebalance workload"));
    } finally {
      setRebalancing(false);
    }
  };

  React.useEffect(() => {
    void loadData();
    const unsubscribe = subscribeToMetrics("dashboard", () => void loadData());
    return () => {
      unsubscribe();
    };
  }, [loadData]);

  React.useEffect(() => {
    if (!workloadOpen) return;
    void loadWorkloadRecommendations();
  }, [workloadOpen, loadWorkloadRecommendations]);

  const all = tickets?.items || [];
  const open = all.filter((t) => t.status === "OPEN").length;
  const highPriority = all.filter((t) => t.priority === "HIGH").length;
  const teamOpen = teamOverview?.summary.open || 0;
  const teamInProgress = teamOverview?.summary.in_progress || 0;
  const teamHighPriority = teamOverview?.summary.high_priority || 0;
  const teamActiveTickets = teamOverview?.summary.active_tickets || 0;

  const pendingApprovals = approvals?.total || 0;
  const slaHigh = slaRisk?.counts?.high || 0;
  const slaMed = slaRisk?.counts?.medium || 0;

  // Status data for chart
  const statusData = [
    { name: "Open", value: teamOpen, fill: "#dc2626" },
    { name: "In Progress", value: teamInProgress, fill: "#f59e0b" },
    { name: "High Priority", value: teamHighPriority, fill: "#7c3aed" },
  ];

  const ticketLabel = (id: string, display?: string | null) => {
    return display || `#${id.slice(0, 8)}`;
  };

  const topAgent = agentWorkload.length > 0 ? agentWorkload[0] : null;

  type ManagerDrilldownKind = "OPEN" | "IN_PROGRESS" | "HIGH_PRIORITY" | "SLA_HIGH" | "SLA_MEDIUM";

  const openTicketDrilldown = (kind: ManagerDrilldownKind) => {
    let rows: Array<{ ticket_id: string; display_number?: string | null; title?: string | null; subtitle?: string | null }> = [];

    if (kind === "OPEN") {
      rows = (teamOverview?.tickets.open || []).map((t) => ({
        ticket_id: t.id,
        display_number: t.display_number,
        title: t.title ?? null,
        subtitle: `${t.status} • ${t.priority}`,
      }));
      setDrilldownTitle("Managed Team Open Tickets");
    } else if (kind === "IN_PROGRESS") {
      rows = (teamOverview?.tickets.in_progress || []).map((t) => ({
        ticket_id: t.id,
        display_number: t.display_number,
        title: t.title ?? null,
        subtitle: `${t.status} • ${t.priority}`,
      }));
      setDrilldownTitle("Managed Team In Progress / Waiting");
    } else if (kind === "HIGH_PRIORITY") {
      rows = (teamOverview?.tickets.high_priority || []).map((t) => ({
        ticket_id: t.id,
        display_number: t.display_number,
        title: t.title ?? null,
        subtitle: `${t.status} • HIGH`,
      }));
      setDrilldownTitle("Managed Team High Priority Tickets");
    } else if (kind === "SLA_HIGH" || kind === "SLA_MEDIUM") {
      const riskLevel = kind === "SLA_HIGH" ? "HIGH" : "MEDIUM";
      const items = slaRisk?.tickets || [];
      rows = items
        .filter((t) => String(t.risk || "").toUpperCase() === riskLevel)
        .map((t) => ({
          ticket_id: t.id,
          display_number: t.display_number,
          title: t.title,
          subtitle: `Risk: ${String(t.risk || "").toUpperCase()} | ${t.priority} | ${t.status}`,
        }));
      setDrilldownTitle(riskLevel === "HIGH" ? "SLA Breached" : "SLA At Risk");
    }

    setDrilldownRows(rows);
    setDrilldownOpen(true);
  };

  return (
    <DashboardContainer>
      {/* Header */}
      <HeaderSection>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Typography variant="h4" sx={{ fontWeight: 800, color: '#1e293b', mb: 1 }}>
            Manager Overview
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Team performance, approvals, and SLA monitoring
          </Typography>
        </motion.div>
      </HeaderSection>

      {error && (
        <Alert severity="error" sx={{ borderRadius: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <KpiGrid container spacing={3}>
        {/* Hero Card - Pending Approvals */}
        <Grid item xs={12} md={6} lg={4}>
          <MetricCard 
            sx={{ height: '100%', minHeight: 300 }}
            gradient="linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)"
          >
            <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', color: 'white' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'rgba(255,255,255,0.2)' }}>
                  <ApprovalsIcon sx={{ color: 'white', fontSize: 24 }} />
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 600, color: 'white' }}>
                  Pending Approvals
                </Typography>
              </Box>
              
              <Box sx={{ flex: 1 }}>
                <Typography variant="h1" sx={{ fontSize: '3.5rem', fontWeight: 800, color: 'white', mb: 1 }}>
                  {pendingApprovals}
                </Typography>
                <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.8)', mb: 3 }}>
                  Actions awaiting your decision
                </Typography>
                
                {(approvals?.items?.length || 0) > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>
                      Latest:
                    </Typography>
                    {approvals?.items?.slice(0, 2).map((a) => (
                      <Box key={a.id} sx={{ mb: 1, p: 1.5, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'white' }}>
                          {a.ticket_title || `Ticket ${a.ticket_display_number || a.ticket_id.slice(0, 8)}`}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                          {a.action_title}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              <Box sx={{ mt: 'auto', pt: 2 }}>
                <ButtonBase
                  onClick={() => navigate('/admin/approvals')}
                  sx={{
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    backdropFilter: 'blur(10px)',
                    px: 3,
                    py: 1.5,
                    borderRadius: 3,
                    color: 'white',
                    fontWeight: 600,
                    width: '100%',
                    justifyContent: 'center',
                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.3)' },
                  }}
                >
                  Review Approvals
                </ButtonBase>
              </Box>
            </Box>
          </MetricCard>
        </Grid>

        {/* KPI Cards Column */}
        <Grid item xs={12} md={6} lg={8}>
          <Grid container spacing={3}>
            {/* SLA Breached */}
            <Grid item xs={12} sm={6}>
              <MetricCard
                onClick={() => openTicketDrilldown("SLA_HIGH")}
                sx={{ cursor: "pointer", height: '100%' }}
              >
                <Box sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'rgba(220, 38, 38, 0.1)' }}>
                      <WarningIcon sx={{ color: '#dc2626', fontSize: 24 }} />
                    </Box>
                    <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
                      SLA Breached
                    </Typography>
                  </Box>
                  <AnimatedNumber value={slaHigh} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Critical violations
                  </Typography>
                  {slaHigh > 0 && (
                    <LinearProgress
                      variant="determinate"
                      value={Math.min((slaHigh / (all.length || 1)) * 100, 100)}
                      sx={{
                        mt: 2,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: 'rgba(220, 38, 38, 0.1)',
                        '& .MuiLinearProgress-bar': {
                          backgroundColor: '#dc2626',
                          borderRadius: 3,
                        },
                      }}
                    />
                  )}
                </Box>
              </MetricCard>
            </Grid>

            {/* SLA At Risk */}
            <Grid item xs={12} sm={6}>
              <MetricCard
                onClick={() => openTicketDrilldown("SLA_MEDIUM")}
                sx={{ cursor: "pointer", height: '100%' }}
              >
                <Box sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'rgba(245, 158, 11, 0.1)' }}>
                      <SlaIcon sx={{ color: '#f59e0b', fontSize: 24 }} />
                    </Box>
                    <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
                      SLA At Risk
                    </Typography>
                  </Box>
                  <AnimatedNumber value={slaMed} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Nearing deadline
                  </Typography>
                </Box>
              </MetricCard>
            </Grid>

            {/* Open Queue */}
            <Grid item xs={12} sm={6}>
              <MetricCard
                onClick={() => openTicketDrilldown("OPEN")}
                sx={{ cursor: "pointer", height: '100%' }}
              >
                <Box sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'rgba(37, 99, 235, 0.1)' }}>
                      <AssessmentIcon sx={{ color: '#2563eb', fontSize: 24 }} />
                    </Box>
                    <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Open Queue
                    </Typography>
                  </Box>
                  <AnimatedNumber value={open} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Unassigned tickets
                  </Typography>
                </Box>
              </MetricCard>
            </Grid>

            {/* High Priority */}
            <Grid item xs={12} sm={6}>
              <MetricCard
                onClick={() => openTicketDrilldown("HIGH_PRIORITY")}
                sx={{ cursor: "pointer", height: '100%' }}
              >
                <Box sx={{ p: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                    <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'rgba(245, 158, 11, 0.1)' }}>
                      <TrendingIcon sx={{ color: '#f59e0b', fontSize: 24 }} />
                    </Box>
                    <Typography variant="body1" color="text.secondary" sx={{ fontWeight: 600 }}>
                      High Priority
                    </Typography>
                  </Box>
                  <AnimatedNumber value={highPriority} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Escalated items
                  </Typography>
                </Box>
              </MetricCard>
            </Grid>
          </Grid>
        </Grid>

        {/* Team Workload */}
        <Grid item xs={12} md={6}>
          <MetricCard
            gradient="linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)"
            onClick={() => setWorkloadOpen(true)}
            sx={{ cursor: "pointer", height: '100%' }}
          >
            <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Box sx={{ p: 1, borderRadius: '12px', bgcolor: 'rgba(5, 150, 105, 0.2)' }}>
                  <TeamIcon sx={{ color: '#059669', fontSize: 24 }} />
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 600, color: '#064e3b' }}>
                  Team Workload
                </Typography>
              </Box>
              
              <Typography variant="h2" sx={{ fontWeight: 800, color: '#059669', mb: 1 }}>
                {teamActiveTickets}
              </Typography>
              
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Active tickets across your managed agents
              </Typography>

              {topAgent && (
                <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, bgcolor: 'rgba(5, 150, 105, 0.1)' }}>
                  <Typography variant="caption" sx={{ color: '#064e3b', fontWeight: 600, display: 'block', mb: 0.5 }}>
                    Most Active Agent
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Avatar sx={{ width: 24, height: 24, fontSize: 12, bgcolor: '#059669' }}>
                      {topAgent.name.charAt(0)}
                    </Avatar>
                    <Typography variant="body2" sx={{ color: '#064e3b' }}>
                      {topAgent.name}
                    </Typography>
                    <Chip 
                      label={`Score: ${topAgent.weighted_score}`} 
                      size="small" 
                      sx={{ ml: 'auto', height: 20, fontSize: '0.7rem', bgcolor: 'rgba(255,255,255,0.5)', color: '#059669' }} 
                    />
                  </Box>
                </Box>
              )}
              
              <Box sx={{ mt: 'auto' }}>
                <ButtonBase
                  onClick={(e) => {
                    e.stopPropagation();
                    setWorkloadOpen(true);
                  }}
                  sx={{
                    backgroundColor: 'rgba(5, 150, 105, 0.2)',
                    backdropFilter: 'blur(10px)',
                    px: 3,
                    py: 1.5,
                    borderRadius: 3,
                    color: '#059669',
                    fontWeight: 600,
                    width: '100%',
                    justifyContent: 'center',
                    '&:hover': { backgroundColor: 'rgba(5, 150, 105, 0.3)' },
                  }}
                >
                  View Distribution
                </ButtonBase>
              </Box>
            </Box>
          </MetricCard>
        </Grid>

        {/* Status Chart */}
        <Grid item xs={12} md={6}>
          <ChartContainer>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              Team Status Overview
            </Typography>
            <Box sx={{ flex: 1, minHeight: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis hide />
                  <Tooltip 
                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                    contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
                    {statusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </ChartContainer>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12}>
          <MetricCard sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
              Quick Actions
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <ButtonBase
                onClick={() => navigate('/admin/approvals')}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  backgroundColor: 'rgba(124, 58, 237, 0.1)',
                  color: '#7c3aed',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  transition: 'all 0.2s',
                  '&:hover': { backgroundColor: 'rgba(124, 58, 237, 0.2)', transform: 'translateY(-2px)' },
                }}
              >
                <ApprovalsIcon />
                <Typography variant="body2">Review Approvals</Typography>
              </ButtonBase>
              <ButtonBase
                onClick={() => navigate('/admin/tickets')}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  backgroundColor: 'rgba(37, 99, 235, 0.1)',
                  color: '#2563eb',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  transition: 'all 0.2s',
                  '&:hover': { backgroundColor: 'rgba(37, 99, 235, 0.2)', transform: 'translateY(-2px)' },
                }}
              >
                <CheckIcon />
                <Typography variant="body2">View All Tickets</Typography>
              </ButtonBase>
              <ButtonBase
                onClick={() => navigate('/admin/sla-monitor')}
                sx={{
                  p: 2,
                  borderRadius: 2,
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  color: '#f59e0b',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  transition: 'all 0.2s',
                  '&:hover': { backgroundColor: 'rgba(245, 158, 11, 0.2)', transform: 'translateY(-2px)' },
                }}
              >
                <SlaIcon />

              <Typography variant="body2">SLA Monitor</Typography>
            </ButtonBase>
            <ButtonBase
              onClick={() => navigate('/admin/schedule')}
              sx={{
                p: 2,
                borderRadius: 2,
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                color: '#059669',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                transition: 'all 0.2s',
                '&:hover': { backgroundColor: 'rgba(16, 185, 129, 0.2)', transform: 'translateY(-2px)' },
              }}
            >
              <ScheduleIcon />
              <Typography variant="body2">Schedule</Typography>
            </ButtonBase>
          </Box>
        </MetricCard>
      </Grid>
    </KpiGrid>

    <Dialog open={workloadOpen} onClose={() => setWorkloadOpen(false)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 800 }}>Agent Workload Distribution</DialogTitle>
        <DialogContent dividers>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Agent</TableCell>
                  <TableCell align="right">Open</TableCell>
                  <TableCell align="right">In Progress</TableCell>
                  <TableCell align="right">High Prio</TableCell>
                  <TableCell align="right">Weighted Score</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {agentWorkload.map((agent) => (
                  <TableRow key={agent.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>
                          {agent.name.charAt(0)}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" fontWeight={600}>
                            {agent.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {agent.email}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="right">{agent.open_tickets}</TableCell>
                    <TableCell align="right">{agent.in_progress_tickets}</TableCell>
                    <TableCell align="right">
                      {agent.high_priority_count > 0 ? (
                        <Chip 
                          label={agent.high_priority_count} 
                          size="small" 
                          color="error" 
                          variant="outlined" 
                        />
                      ) : (
                        0
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Chip 
                        label={agent.weighted_score} 
                        size="small" 
                        color={agent.weighted_score > 10 ? "warning" : "default"}
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {agentWorkload.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography color="text.secondary" sx={{ py: 4 }}>
                        No agent workload data available
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
              Rebalance Recommendations
            </Typography>
            {workloadRecommendationsLoading ? (
              <Typography color="text.secondary">Loading recommendations...</Typography>
            ) : workloadRecommendations.length === 0 ? (
              <Typography color="text.secondary">No rebalance moves recommended right now.</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Ticket</TableCell>
                      <TableCell>Move</TableCell>
                      <TableCell>Reason</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workloadRecommendations.slice(0, 10).map((item) => (
                      <TableRow key={item.ticket_id}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>
                            {item.display_number || item.ticket_id.slice(0, 8)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.title}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">
                            {item.from_agent.name} {"->"} {item.to_agent.name}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">
                            {item.reason}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {rebalanceSummary && (
              <Alert severity="info" sx={{ mt: 2 }}>
                {rebalanceSummary}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => void loadWorkloadRecommendations()} disabled={workloadRecommendationsLoading || rebalancing}>
            Refresh Recommendations
          </Button>
          <Button
            variant="contained"
            onClick={() => void runAutoRebalance()}
            disabled={rebalancing || workloadRecommendations.length === 0}
          >
            {rebalancing ? "Rebalancing..." : "Auto Rebalance"}
          </Button>
          <Button onClick={() => setWorkloadOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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
    </DashboardContainer>
  );
};


