import React, { useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Typography,
  Card,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  Alert,
  TextField,
  Stack,
  Avatar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Grid,
  Chip,
  Paper,
  useTheme,
  alpha,
  IconButton,
  Step,
  StepLabel,
  Stepper,
  styled,
} from "@mui/material";
import {
  ArrowBack,
  Close,
  CheckCircle,
  Error as ErrorIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Send as SendIcon,
  SmartToy as BotIcon,
  BugReport as BugIcon,
  Assignment as TicketIcon,
  History as HistoryIcon,
  ThumbUp as ThumbUpIcon,
  ThumbDown as ThumbDownIcon,
  NotificationsActive as FollowIcon,
  NotificationsOff as UnfollowIcon,
} from "@mui/icons-material";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { api, getApiErrorMessage } from "../../services/api";
import { useAuth } from "../../services/auth";
import { htmlToPlainText } from "../../utils/plainText";

// --- Types ---

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";

type Ticket = {
  id: string;
  display_number?: string | null;
  title: string;
  description: string;
  status: TicketStatus;
  priority: "LOW" | "MEDIUM" | "HIGH";
  category: string | null;
  created_at: string;
  updated_at: string;
  assigned_team_name?: string | null;
  assigned_agent_name?: string | null;
  dedup_master_id?: string | null;
  tag_names?: string[];
};

type TicketEvent = {
  id: string;
  action: string;
  old_value: unknown;
  new_value: unknown;
  performed_by: string;
  performed_by_name?: string;
  timestamp: string;
};

type TicketDetailResponse = {
  ticket: Ticket;
  events: TicketEvent[];
};

type TicketComment = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string;
  author_email: string;
  body: string;
  is_internal: boolean;
  created_at: string;
};

type ApprovalRequest = {
  id: string;
  ticket_id: string;
  requested_by: string;
  status: "pending" | "approved" | "rejected" | "expired";
  action_title: string;
  action_body: string;
  created_at: string;
};

type TicketWatcher = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
  created_at: string;
};

type Verification = {
  id: string;
  approval_id: string;
  worked: boolean;
  notes: string | null;
  verified_at: string;
};

type AutoFixStep = {
  step_index: number;
  step_description: string;
  executed_at: string;
  success: boolean;
};

type AutoFixExecution = {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  current_step: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
};

// --- Components ---

const StatusChip = ({ status }: { status: TicketStatus }) => {
  let color: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" = "default";
  let label = status.replace(/_/g, " ");

  switch (status) {
    case "OPEN":
      color = "error";
      break;
    case "IN_PROGRESS":
      color = "info";
      break;
    case "WAITING_FOR_CUSTOMER":
      color = "warning";
      break;
    case "RESOLVED":
      color = "success";
      break;
    case "CLOSED":
      color = "default";
      break;
  }

  return <Chip label={label} color={color} size="small" sx={{ fontWeight: 600 }} />;
};

const PriorityChip = ({ priority }: { priority: string }) => {
  let color: "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" = "default";

  switch (priority) {
    case "HIGH":
      color = "error";
      break;
    case "MEDIUM":
      color = "warning";
      break;
    case "LOW":
      color = "success";
      break;
  }

  return <Chip label={priority} color={color} size="small" variant="outlined" sx={{ fontWeight: 600 }} />;
};

const GlassCard = styled(motion(Card))(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(12px)',
  borderRadius: theme.shape.borderRadius * 3,
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
  overflow: 'visible',
}));

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export const TicketDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const { user } = useAuth();

  const [ticket, setTicket] = React.useState<Ticket | null>(null);
  const [events, setEvents] = React.useState<TicketEvent[]>([]);
  const [comments, setComments] = React.useState<TicketComment[]>([]);
  const [commentText, setCommentText] = React.useState<string>("");
  const [commentSubmitting, setCommentSubmitting] = React.useState(false);
  const [approval, setApproval] = React.useState<ApprovalRequest | null>(null);
  const [verification, setVerification] = React.useState<Verification | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = React.useState(false);
  const [verificationSubmitting, setVerificationSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);

  const [autoFixOpen, setAutoFixOpen] = React.useState(false);
  const [autoFixLoading, setAutoFixLoading] = React.useState(false);
  const [autoFixExecution, setAutoFixExecution] = React.useState<AutoFixExecution | null>(null);
  const [autoFixSteps, setAutoFixSteps] = React.useState<AutoFixStep[]>([]);
  const [autoFixError, setAutoFixError] = React.useState<string>("");
  const [autoFixVisibleSteps, setAutoFixVisibleSteps] = React.useState(0);
  const autoFixVisibleStepsRef = useRef(0);
  const [autoFixActiveStep, setAutoFixActiveStep] = React.useState(0);
  const [watchers, setWatchers] = React.useState<TicketWatcher[]>([]);
  const [watchSubmitting, setWatchSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    if (id === "new") {
      navigate("/app/create-ticket", { replace: true });
      return;
    }
    setLoading(true);
    setError("");
    setApproval(null);
    setVerification(null);
    try {
      const [res, watchersRes] = await Promise.all([
        api.get<TicketDetailResponse>(`/tickets/${id}`),
        api.get<TicketWatcher[]>(`/tickets/${id}/watchers`).catch(() => ({ data: [] as TicketWatcher[] })),
      ]);
      setTicket(res.data.ticket);
      setEvents(res.data.events || []);
      setWatchers(watchersRes.data || []);
      try {
        const c = await api.get<TicketComment[]>(`/tickets/${id}/comments`);
        setComments(c.data || []);
      } catch {
        setComments([]);
      }

      try {
        const a = await api.get<{ approval: ApprovalRequest | null }>(
          `/approvals/tickets/${id}/pending`
        );
        setApproval(a.data.approval);

        if (a.data.approval) {
          const v = await api.get<{ verification: Verification | null }>(`/tickets/${id}/verification`);
          setVerification(v.data.verification);
        }
      } catch {
        setApproval(null);
        setVerification(null);
      }
    } catch (e: unknown) {
      setTicket(null);
      setEvents([]);
      setComments([]);
      setError(getApiErrorMessage(e, "Failed to load ticket"));
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  const approve = async () => {
    if (!approval) return;
    setApprovalSubmitting(true);
    setError("");
    try {
      await api.post(`/approvals/${approval.id}/approve`);
      setAutoFixOpen(true);
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to approve"));
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const loadAutoFix = React.useCallback(async () => {
    if (!id) return;
    setAutoFixLoading(true);
    setAutoFixError("");
    try {
      const res = await api.get<{ execution: AutoFixExecution | null; steps: AutoFixStep[] }>(`/tickets/${id}/auto-fix`);
      setAutoFixExecution(res.data.execution);
      setAutoFixSteps(res.data.steps || []);
      return res.data;
    } catch (e: unknown) {
      setAutoFixError(getApiErrorMessage(e, "Failed to load auto-fix details"));
      return null;
    } finally {
      setAutoFixLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!autoFixOpen) return;
    let alive = true;
    let tries = 0;
    let timeoutId: number | undefined;

    autoFixVisibleStepsRef.current = 0;
    setAutoFixVisibleSteps(0);
    setAutoFixActiveStep(0);

    const tick = async () => {
      if (!alive) return;
      tries++;
      const data = await loadAutoFix();

      const status = data?.execution?.status;
      const shouldContinue = status === "pending" || status === "running" || status === undefined;
      if (shouldContinue && tries < 30) {
        timeoutId = window.setTimeout(() => void tick(), 1500);
      }
    };

    void tick();
    return () => {
      alive = false;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFixOpen, loadAutoFix]);

  useEffect(() => {
    if (!autoFixOpen) return;

    let alive = true;
    let timeoutId: number | undefined;

    const stepCount = autoFixSteps.length;
    const run = () => {
      if (!alive) return;
      const current = autoFixVisibleStepsRef.current;
      if (stepCount <= 0) return;
      if (current >= stepCount) return;

      const next = Math.min(stepCount, current + 1);
      autoFixVisibleStepsRef.current = next;
      setAutoFixVisibleSteps(next);

      setAutoFixActiveStep((prev) => {
        const nextActive = Math.min(next - 1, prev);
        return Math.max(0, nextActive);
      });

      timeoutId = window.setTimeout(run, 450);
    };

    // Kick once to start the reveal chain if there are new steps
    timeoutId = window.setTimeout(run, 150);

    return () => {
      alive = false;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [autoFixOpen, autoFixSteps]);

  const visibleSteps = React.useMemo(() => {
    if (autoFixSteps.length <= 0) return [];
    const count = Math.max(0, Math.min(autoFixSteps.length, autoFixVisibleSteps));
    return autoFixSteps.slice(0, Math.max(1, count));
  }, [autoFixSteps, autoFixVisibleSteps]);

  const canActOnApproval = React.useMemo(() => {
    if (!approval || !user) return false;
    return approval.requested_by === user.id;
  }, [approval, user]);

  useEffect(() => {
    if (!autoFixOpen) return;
    setAutoFixActiveStep((prev) => {
      if (visibleSteps.length <= 0) return 0;
      return Math.min(prev, visibleSteps.length - 1);
    });
  }, [autoFixOpen, visibleSteps.length]);

  const isRunning = autoFixExecution?.status === "pending" || autoFixExecution?.status === "running" || autoFixLoading;

  const verifyFix = async (worked: boolean) => {
    if (!approval) return;
    setVerificationSubmitting(true);
    setError("");
    try {
      await api.post(`/approvals/${approval.id}/verify`, { worked });
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to submit verification"));
    } finally {
      setVerificationSubmitting(false);
    }
  };

  const reject = async () => {
    if (!approval) return;
    setApprovalSubmitting(true);
    setError("");
    try {
      await api.post(`/approvals/${approval.id}/reject`);
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to reject"));
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const submitComment = async () => {
    if (!id) return;
    const trimmed = commentText.trim();
    if (!trimmed) return;

    setCommentSubmitting(true);
    try {
      await api.post(`/tickets/${id}/comments`, { body: trimmed });
      setCommentText("");
      const c = await api.get<TicketComment[]>(`/tickets/${id}/comments`);
      setComments(c.data || []);
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to post reply"));
    } finally {
      setCommentSubmitting(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const isWatching = React.useMemo(
    () => watchers.some((watcher) => watcher.user_id === user?.id),
    [user?.id, watchers]
  );

  const toggleWatch = async () => {
    if (!id) return;
    setWatchSubmitting(true);
    setError("");
    try {
      if (isWatching) {
        await api.delete(`/tickets/${id}/watch`);
        setWatchers((current) => current.filter((watcher) => watcher.user_id !== user?.id));
      } else {
        const response = await api.post<TicketWatcher | null>(`/tickets/${id}/watch`);
        const createdWatcher = response.data;
        if (createdWatcher) {
          setWatchers((current) =>
            current.some((watcher) => watcher.user_id === createdWatcher.user_id)
              ? current
              : [createdWatcher, ...current]
          );
        }
      }
    } catch (watchError) {
      setError(getApiErrorMessage(watchError, "Failed to update the watch setting."));
    } finally {
      setWatchSubmitting(false);
    }
  };

  if (loading && !ticket) {
    return <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }} />;
  }

  if (!ticket && !loading) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: 4 }}>
        <Grid container maxWidth="md" sx={{ mx: "auto" }}>
          <Grid item xs={12}>
            <Alert severity="error" sx={{ mb: 2 }}>
              {error || "Ticket not found or you don't have access to view it."}
            </Alert>
            <Button startIcon={<ArrowBack />} onClick={() => navigate("/app/tickets")}>
              Back to My Tickets
            </Button>
          </Grid>
        </Grid>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 8 }}>
      {/* Header */}
      <Box sx={{ bgcolor: 'white', borderBottom: `1px solid ${theme.palette.divider}`, pt: 4, pb: 4, mb: 4 }}>
        <Grid container maxWidth="lg" sx={{ mx: "auto", px: 3 }}>
          <Grid item xs={12}>
            <Button 
              startIcon={<ArrowBack />} 
              onClick={() => navigate("/app/tickets")}
              sx={{ mb: 2, color: 'text.secondary' }}
            >
              Back to Tickets
            </Button>
            
            {ticket && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                    <Typography variant="h4" fontWeight={700}>
                      {ticket.title}
                    </Typography>
                    <StatusChip status={ticket.status} />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <span>ID: #{ticket.id.substring(0, 8)}</span>
                    <span>•</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ScheduleIcon fontSize="small" /> 
                        {new Date(ticket.created_at).toLocaleString()}
                      </span>
                    </Typography>
                    {ticket.tag_names?.length ? (
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                        {ticket.tag_names.map((tag) => (
                          <Chip key={tag} label={tag} size="small" />
                        ))}
                      </Stack>
                    ) : null}
                  </Box>
                  
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                      variant={isWatching ? "outlined" : "contained"}
                      startIcon={isWatching ? <UnfollowIcon /> : <FollowIcon />}
                      onClick={() => void toggleWatch()}
                      disabled={watchSubmitting}
                    >
                      {isWatching ? "Unfollow" : "Follow"}
                    </Button>
                    <Chip label={`${watchers.length} follower${watchers.length === 1 ? "" : "s"}`} variant="outlined" />
                    {ticket.dedup_master_id && (
                      <Chip 
                        icon={<TicketIcon />} 
                      label={`Duplicate of #${ticket.dedup_master_id.substring(0, 8)}`} 
                      color="info" 
                      variant="outlined" 
                    />
                  )}
                </Box>
              </Box>
            )}
          </Grid>
        </Grid>
      </Box>

      <Grid container maxWidth="lg" spacing={4} sx={{ mx: "auto", px: 3 }}>
        {error && (
          <Grid item xs={12}>
            <Alert severity="error">{error}</Alert>
          </Grid>
        )}

        {/* Left Column: Main Content */}
        <Grid item xs={12} md={8}>
          <Stack spacing={3}>
            {/* Description Card */}
            <GlassCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              sx={{ p: 3 }}
            >
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Description
              </Typography>
              <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", color: 'text.secondary', lineHeight: 1.6 }}>
                {htmlToPlainText(ticket?.description)}
              </Typography>
            </GlassCard>

            {/* AI Auto-Fix & Approvals Section */}
            <AnimatePresence>
              {approval && approval.status === "pending" && canActOnApproval && (
                <GlassCard
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  sx={{ p: 3, border: `1px solid ${theme.palette.info.light}`, bgcolor: alpha(theme.palette.info.light, 0.05) }}
                >
                  <Stack direction="row" spacing={2} alignItems="flex-start">
                    <Avatar sx={{ bgcolor: theme.palette.info.main }}>
                      <BotIcon />
                    </Avatar>
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" gutterBottom color="info.main">
                        {approval.action_title}
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 3 }}>
                        {approval.action_body}
                      </Typography>
                      <Stack direction="row" spacing={2}>
                        <Button
                          variant="contained"
                          color="info"
                          onClick={() => void approve()}
                          disabled={approvalSubmitting}
                          startIcon={<CheckCircle />}
                        >
                          Approve Fix
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          onClick={() => void reject()}
                          disabled={approvalSubmitting}
                          startIcon={<Close />}
                        >
                          Reject
                        </Button>
                      </Stack>
                    </Box>
                  </Stack>
                </GlassCard>
              )}
            </AnimatePresence>

            {/* Verification Section */}
            <AnimatePresence>
              {(((approval && approval.status === "approved" && !verification && ticket?.status !== "RESOLVED") || 
                (approval && approval.status === "approved" && verification)) && canActOnApproval) && (
                <GlassCard
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  sx={{ p: 3, border: `1px solid ${verification ? (verification.worked ? theme.palette.success.light : theme.palette.error.light) : theme.palette.warning.light}`, bgcolor: 'rgba(255,255,255,0.9)' }}
                >
                  {!verification ? (
                    <Box>
                      <Typography variant="h6" gutterBottom color="warning.main" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BugIcon /> Verify Resolution
                      </Typography>
                      <Typography variant="body1" paragraph>
                        The AI has attempted to fix your issue. Please verify if the problem is now resolved.
                      </Typography>
                      <Stack direction="row" spacing={2}>
                        <Button
                          variant="contained"
                          color="success"
                          onClick={() => void verifyFix(true)}
                          disabled={verificationSubmitting}
                          startIcon={<ThumbUpIcon />}
                        >
                          Yes, It Worked!
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          onClick={() => void verifyFix(false)}
                          disabled={verificationSubmitting}
                          startIcon={<ThumbDownIcon />}
                        >
                          No, Still Broken
                        </Button>
                      </Stack>
                    </Box>
                  ) : (
                    <Box>
                      <Typography variant="h6" gutterBottom color={verification.worked ? "success.main" : "error.main"} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {verification.worked ? <CheckCircle /> : <ErrorIcon />}
                        {verification.worked ? "Issue Resolved" : "Escalated to Support"}
                      </Typography>
                      <Typography variant="body1">
                        {verification.worked
                          ? "The auto-fix worked and your ticket has been resolved. Thank you for your feedback!"
                          : "The auto-fix did not work. Your ticket has been automatically escalated to our support team."}
                      </Typography>
                    </Box>
                  )}
                </GlassCard>
              )}
            </AnimatePresence>

            {/* Comments / Conversation */}
            <GlassCard 
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              sx={{ p: 3 }}
            >
              <Typography variant="h6" fontWeight={600} gutterBottom sx={{ mb: 3 }}>
                Conversation
              </Typography>

              <Stack spacing={3} sx={{ mb: 4 }}>
                {comments.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4, bgcolor: alpha(theme.palette.divider, 0.05), borderRadius: 2 }}>
                    <Typography color="text.secondary">No messages yet. Start the conversation!</Typography>
                  </Box>
                ) : (
                  comments.map((c) => (
                    <Box key={c.id} sx={{ display: 'flex', gap: 2, flexDirection: c.is_internal ? 'row-reverse' : 'row' }}>
                      <Avatar 
                        sx={{ 
                          bgcolor: c.is_internal ? theme.palette.secondary.main : theme.palette.primary.main,
                          width: 40, height: 40
                        }}
                      >
                        {c.author_name?.[0]?.toUpperCase() || "U"}
                      </Avatar>
                      <Box sx={{ maxWidth: '80%' }}>
                        <Box sx={{ 
                          p: 2, 
                          bgcolor: c.is_internal ? alpha(theme.palette.secondary.main, 0.1) : alpha(theme.palette.primary.main, 0.05),
                          borderRadius: 2,
                          borderTopLeftRadius: c.is_internal ? 2 : 0,
                          borderTopRightRadius: c.is_internal ? 0 : 2,
                        }}>
                          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                            {c.author_name}
                          </Typography>
                          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                            {c.body}
                          </Typography>
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: c.is_internal ? 'right' : 'left' }}>
                          {new Date(c.created_at).toLocaleString()}
                        </Typography>
                      </Box>
                    </Box>
                  ))
                )}
              </Stack>

              <Divider sx={{ mb: 3 }} />

              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  maxRows={6}
                  placeholder="Type your reply here..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  disabled={commentSubmitting}
                  variant="outlined"
                  sx={{ bgcolor: alpha(theme.palette.background.paper, 0.5) }}
                />
                <Button 
                  variant="contained" 
                  onClick={() => void submitComment()} 
                  disabled={commentSubmitting || !commentText.trim()}
                  sx={{ px: 3, alignSelf: 'flex-end' }}
                  endIcon={<SendIcon />}
                >
                  Reply
                </Button>
              </Box>
            </GlassCard>
          </Stack>
        </Grid>

        {/* Right Column: Meta Info */}
        <Grid item xs={12} md={4}>
          <Stack spacing={3}>
            {/* Meta Card */}
            <GlassCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              sx={{ p: 3 }}
            >
              <Typography variant="h6" fontWeight={600} gutterBottom>
                Ticket Info
              </Typography>
              <List disablePadding>
                <ListItem disableGutters>
                  <ListItemText 
                    primary="Priority" 
                    secondary={<PriorityChip priority={ticket?.priority || "LOW"} />} 
                  />
                </ListItem>
                <Divider component="li" />
                <ListItem disableGutters>
                  <ListItemText 
                    primary="Category" 
                    secondary={ticket?.category || "Uncategorized"} 
                  />
                </ListItem>
                <Divider component="li" />
                <ListItem disableGutters>
                  <ListItemText 
                    primary="Assigned To" 
                    secondary={
                      <Stack spacing={0.5}>
                        {ticket?.assigned_team_name && <Typography variant="body2">{ticket.assigned_team_name}</Typography>}
                        {ticket?.assigned_agent_name && (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <PersonIcon fontSize="small" color="action" />
                            <Typography variant="body2">{ticket.assigned_agent_name}</Typography>
                          </Box>
                        )}
                        {!ticket?.assigned_team_name && !ticket?.assigned_agent_name && <Typography variant="body2" color="text.secondary">Unassigned</Typography>}
                      </Stack>
                    } 
                  />
                </ListItem>
              </List>
            </GlassCard>

            {/* Event Timeline */}
            <GlassCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              sx={{ p: 3 }}
            >
              <Typography variant="h6" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <HistoryIcon /> History
              </Typography>
              <List dense disablePadding>
                {events.slice(0, 5).map((ev: TicketEvent, idx: number) => (
                  <React.Fragment key={ev.id}>
                    <ListItem alignItems="flex-start" disableGutters>
                      <ListItemText
                        primary={ev.action}
                        secondary={
                          <>
                            <Typography variant="caption" display="block" color="text.primary">
                              {ev.performed_by_name || ev.performed_by || "System"}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {new Date(ev.timestamp).toLocaleString()}
                            </Typography>
                          </>
                        }
                      />
                    </ListItem>
                    {idx < Math.min(events.length, 5) - 1 && <Divider component="li" />}
                  </React.Fragment>
                ))}
              </List>
              {events.length > 5 && (
                <Button fullWidth size="small" sx={{ mt: 1 }}>View all events</Button>
              )}
            </GlassCard>
          </Stack>
        </Grid>
      </Grid>

      {/* Auto-Fix Dialog */}
      <Dialog
        open={autoFixOpen}
        onClose={() => (verificationSubmitting ? undefined : setAutoFixOpen(false))}
        fullWidth
        maxWidth="md"
        PaperProps={{
          sx: {
            borderRadius: 3,
            background: 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
          }
        }}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar sx={{ bgcolor: theme.palette.info.main }}><BotIcon /></Avatar>
            <Typography variant="h6">AI Auto-Fix Execution</Typography>
          </Box>
          <IconButton onClick={() => (verificationSubmitting ? undefined : setAutoFixOpen(false))} disabled={verificationSubmitting}>
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 3 }}>
          {autoFixError && <Alert severity="error" sx={{ mb: 3 }}>{autoFixError}</Alert>}
          
          <Box sx={{ mb: 4 }}>
             <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary">
               {autoFixExecution?.status === "completed" 
                 ? "Automation completed successfully" 
                 : autoFixExecution?.status === "failed" 
                   ? "Automation failed" 
                   : "Executing automation steps..."}
             </Typography>
             {isRunning && <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />}
          </Box>

          <Stepper activeStep={autoFixActiveStep} orientation="vertical">
            {visibleSteps.map((step, index) => (
              <Step key={index} completed={step.success || index < autoFixActiveStep}>
                <StepLabel 
                StepIconComponent={(props) => (
                    <Avatar 
                      sx={{ 
                        width: 24, 
                        height: 24, 
                        bgcolor: props.completed ? 'success.main' : (props.active ? 'info.main' : 'grey.300'),
                        fontSize: 12 
                      }}
                    >
                      {index + 1}
                    </Avatar>
                  )}
                >
                  <Typography variant="body1" fontWeight={index === autoFixActiveStep ? 600 : 400}>
                    {step.step_description}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {step.executed_at ? new Date(step.executed_at).toLocaleTimeString() : 'Pending'}
                  </Typography>
                </StepLabel>
              </Step>
            ))}
          </Stepper>

          {autoFixExecution?.status === "failed" && autoFixExecution.error_message && (
             <Paper sx={{ mt: 3, p: 2, bgcolor: alpha(theme.palette.error.main, 0.1), color: 'error.main' }}>
               <Typography variant="subtitle2">Error Details:</Typography>
               <Typography variant="body2">{autoFixExecution.error_message}</Typography>
             </Paper>
          )}

        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setAutoFixOpen(false)} disabled={verificationSubmitting} color="inherit">
            Close Viewer
          </Button>
          {autoFixExecution?.status === "completed" && (
            <Button
              variant="contained"
              color="success"
              onClick={() => {
                setAutoFixOpen(false);
                // Trigger verification scroll or highlight?
              }}
            >
              Review Results
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};
