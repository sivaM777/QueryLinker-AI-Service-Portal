import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  SelectChangeEvent,
  MenuItem,
  Grid,
  List,
  ListItem,
  ListItemText,
  Divider,
  Alert,
  Chip,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  Tooltip,
  Paper,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import { styled, alpha } from "@mui/material/styles";
import {
  Save,
  ArrowBack,
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  People as PeopleIcon,
  Sync as SyncIcon,
  ExpandMore as ExpandMoreIcon,
  History as HistoryIcon,
  Chat as ChatIcon,
  Send as SendIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
  BugReport as BugReportIcon,
  NotificationsActive as FollowIcon,
  NotificationsOff as UnfollowIcon,
  Link as LinkIcon,
} from "@mui/icons-material";
import { motion } from "framer-motion";
import { api, getApiErrorMessage } from "../../services/api";
import { useAuth } from "../../services/auth";
import { TicketFlowVisualization } from "../../components/TicketFlowVisualization";
import { formatDistanceToNow } from "date-fns";
import { htmlToPlainText } from "../../utils/plainText";

// --- Types ---

type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH";

type Ticket = {
  id: string;
  display_number?: string | null;
  title: string;
  description: string;
  type?: "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM";
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  ai_confidence: number | null;
  source_type: string | null;
  assigned_team: string | null;
  assigned_agent: string | null;
  requester_email: string;
  requester_name: string;
  assigned_team_name: string | null;
  assigned_agent_name: string | null;
  dedup_master_id?: string | null;
  tag_names?: string[];
  updated_at: string;
  created_at: string;
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

type Team = { id: string; name: string };
type Agent = { id: string; name: string; email: string };

type TicketComment = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string;
  author_email: string;
  body: string;
  is_internal: boolean;
  visibility: "INTERNAL_NOTE" | "REQUESTER_COMMENT";
  created_at: string;
};

type CannedResponse = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  visibility: "GLOBAL" | "TEAM" | "PRIVATE";
  linked_article_id: string | null;
  linked_article_title?: string | null;
};

type TicketDetailResponse = {
  ticket: Ticket;
  events: TicketEvent[];
};

type ApprovalRequest = {
  id: string;
  ticket_id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  action_title: string;
  action_body: string;
  created_at: string;
};

type Verification = {
  id: string;
  approval_id: string;
  worked: boolean;
  notes: string | null;
  verified_at: string;
};

type PresenceUser = {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  status: 'viewing' | 'editing';
  last_seen: string;
  is_current_user: boolean;
};

type TicketLock = {
  id: string;
  ticket_id: string;
  user_id: string;
  user_name: string;
  acquired_at: string;
  expires_at: string;
  is_current_user: boolean;
};

type TicketWatcher = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
  created_at: string;
};

// --- Styled Components ---

const PageContainer = styled(Box)(({ theme }) => ({
  minHeight: '100vh',
  background: `linear-gradient(135deg, ${alpha(theme.palette.primary.light, 0.05)} 0%, ${alpha(theme.palette.secondary.light, 0.05)} 100%)`,
  padding: '24px',
  [theme.breakpoints.down('md')]: {
    padding: '16px',
  },
}));

const HeaderSection = styled(Box)(() => ({
  marginBottom: '24px',
}));

const DetailCard = styled(motion(Card))(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.8)',
  backdropFilter: 'blur(12px)',
  borderRadius: theme.shape.borderRadius * 3,
  border: '1px solid rgba(255, 255, 255, 0.3)',
  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
  overflow: 'visible',
  marginBottom: '24px',
}));

const CardHeaderStyled = styled(Box)(() => ({
  padding: '20px 24px',
  borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}));

const PresenceContainer = styled(motion(Paper))(() => ({
  padding: '12px 16px',
  borderRadius: '16px',
  background: 'rgba(255, 255, 255, 0.6)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  marginBottom: '24px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
}));

const PresenceAvatar = styled(Avatar, {
  shouldForwardProp: (prop) => prop !== 'status',
})<{ status: 'viewing' | 'editing' }>(({ status }) => ({
  width: 32,
  height: 32,
  fontSize: '0.875rem',
  border: `2px solid ${status === 'editing' ? '#f59e0b' : '#10b981'}`,
  boxShadow: status === 'editing' ? '0 0 0 4px rgba(245, 158, 11, 0.2)' : 'none',
  transition: 'all 0.2s ease',
}));

const LockIndicator = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isLocked',
})<{ isLocked: boolean }>(({ isLocked }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '6px 12px',
  borderRadius: '20px',
  backgroundColor: isLocked ? '#fef2f2' : '#f0fdf4',
  border: `1px solid ${isLocked ? '#fecaca' : '#bbf7d0'}`,
  color: isLocked ? '#dc2626' : '#16a34a',
  fontSize: '0.875rem',
  fontWeight: 500,
}));

const CommentBubble = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isInternal' && prop !== 'isSelf',
})<{ isInternal: boolean; isSelf: boolean }>(({ theme, isInternal, isSelf }) => ({
  padding: '16px',
  borderRadius: '16px',
  borderTopLeftRadius: isSelf ? '16px' : '4px',
  borderTopRightRadius: isSelf ? '4px' : '16px',
  backgroundColor: isInternal 
    ? alpha(theme.palette.warning.light, 0.1) 
    : isSelf 
      ? alpha(theme.palette.primary.main, 0.05) 
      : '#f8fafc',
  border: `1px solid ${
    isInternal 
      ? alpha(theme.palette.warning.main, 0.2) 
      : isSelf 
        ? alpha(theme.palette.primary.main, 0.1) 
        : '#e2e8f0'
  }`,
  marginBottom: '16px',
  position: 'relative',
}));

// --- Main Component ---

export const TicketDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  // const theme = useTheme();

  const resolutionStepsRef = React.useRef<HTMLTextAreaElement | null>(null);

  const [ticket, setTicket] = React.useState<Ticket | null>(null);
  const [events, setEvents] = React.useState<TicketEvent[]>([]);

  const [status, setStatus] = React.useState<TicketStatus>("OPEN");
  const [priority, setPriority] = React.useState<TicketPriority>("LOW");
  const [assignedTeam, setAssignedTeam] = React.useState<string | null>(null);
  const [assignedAgent, setAssignedAgent] = React.useState<string | null>(null);

  const [teams, setTeams] = React.useState<Team[]>([]);
  const [agents, setAgents] = React.useState<Agent[]>([]);

  const [comments, setComments] = React.useState<TicketComment[]>([]);
  const [cannedResponses, setCannedResponses] = React.useState<CannedResponse[]>([]);
  const [selectedCannedResponseId, setSelectedCannedResponseId] = React.useState("");
  const [replyBody, setReplyBody] = React.useState("");
  const [sendingReply, setSendingReply] = React.useState(false);

  const [internalNote, setInternalNote] = React.useState("");
  const [sendingInternalNote, setSendingInternalNote] = React.useState(false);

  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [approval, setApproval] = React.useState<ApprovalRequest | null>(null);
  const [verification, setVerification] = React.useState<Verification | null>(null);

  const [resolveOpen, setResolveOpen] = React.useState(false);
  const [resolutionSummary, setResolutionSummary] = React.useState("");
  const [resolutionSymptoms, setResolutionSymptoms] = React.useState("");
  const [resolutionRootCause, setResolutionRootCause] = React.useState("");
  const [resolutionSteps, setResolutionSteps] = React.useState("");
  const [resolving, setResolving] = React.useState(false);

  // Presence and locking state
  const [presenceUsers, setPresenceUsers] = React.useState<PresenceUser[]>([]);
  const [ticketLock, setTicketLock] = React.useState<TicketLock | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [lockError, setLockError] = React.useState("");
  const [watchers, setWatchers] = React.useState<TicketWatcher[]>([]);
  const [watchSubmitting, setWatchSubmitting] = React.useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = React.useState(false);
  const [linkTargetId, setLinkTargetId] = React.useState("");
  const [linkRelationshipType, setLinkRelationshipType] = React.useState("RELATED_TO");
  const [linkNotes, setLinkNotes] = React.useState("");
  const [linkSubmitting, setLinkSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const [detail, teamRes, agentRes, presenceRes, lockRes, cannedRes, watcherRes] = await Promise.all([
        api.get<TicketDetailResponse>(`/tickets/${id}`),
        api.get<Team[]>("/teams"),
        api.get<Agent[]>("/users", { params: { role: "AGENT" } }),
        api.get<PresenceUser[]>(`/tickets/${id}/presence`).catch(() => ({ data: [] })),
        api.get<TicketLock>(`/tickets/${id}/lock`).catch(() => ({ data: null })),
        api.get<CannedResponse[]>("/kb/canned-responses", { params: { limit: 100 } }).catch(() => ({ data: [] })),
        api.get<TicketWatcher[]>(`/tickets/${id}/watchers`).catch(() => ({ data: [] as TicketWatcher[] })),
      ]);

      const t = detail.data.ticket;
      setTicket(t);
      setEvents(detail.data.events || []);
      setPresenceUsers(presenceRes.data || []);
      setTicketLock(lockRes.data || null);
      setWatchers(watcherRes.data || []);

      setStatus(t.status);
      setPriority(t.priority);
      setAssignedTeam(t.assigned_team);
      setAssignedAgent(t.assigned_agent);

      setTeams(teamRes.data || []);
      setAgents(agentRes.data || []);
      setCannedResponses(cannedRes.data || []);

      // Load latest auto-resolution approval (if any)
      try {
        const a = await api.get<{ approval: ApprovalRequest | null }>(
          `/approvals/tickets/${id}/pending`
        );
        setApproval(a.data.approval);

        if (a.data.approval) {
          const v = await api.get<{ verification: Verification | null }>(
            `/tickets/${id}/verification`
          );
          setVerification(v.data.verification);
        } else {
          setVerification(null);
        }
      } catch {
        setApproval(null);
        setVerification(null);
      }

      try {
        const commentRes = await api.get<TicketComment[]>(`/tickets/${id}/comments`);
        setComments(commentRes.data || []);
      } catch {
        setComments([]);
      }
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to load ticket"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const refreshRealtime = React.useCallback(async () => {
    if (!id) return;
    try {
      const detail = await api.get<TicketDetailResponse>(`/tickets/${id}`);
      const t = detail.data.ticket;
      setTicket(t);
      setEvents(detail.data.events || []);
      setStatus(t.status);
      setPriority(t.priority);
      setAssignedTeam(t.assigned_team);
      setAssignedAgent(t.assigned_agent);
    } catch {
      // Silent refresh should never interrupt user actions.
    }
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!id) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void refreshRealtime();
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [id, refreshRealtime]);

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
      setError(getApiErrorMessage(watchError, "Failed to update ticket followers."));
    } finally {
      setWatchSubmitting(false);
    }
  };

  const createContextualRecord = async (targetType: "PROBLEM" | "CHANGE") => {
    if (!id) return;
    setError("");
    setSuccess("");
    try {
      const route = targetType === "PROBLEM" ? `/tickets/${id}/create-problem` : `/tickets/${id}/create-change`;
      const response = await api.post<{ id: string }>(route);
      setSuccess(`${targetType === "PROBLEM" ? "Problem record" : "Change record"} created.`);
      navigate(`/admin/tickets/${response.data.id}`);
    } catch (contextError) {
      setError(
        getApiErrorMessage(
          contextError,
          targetType === "PROBLEM"
            ? "Failed to create the linked problem record."
            : "Failed to create the linked change record."
        )
      );
    }
  };

  const submitLinkedTicket = async () => {
    if (!id || !linkTargetId.trim()) return;
    setLinkSubmitting(true);
    setError("");
    try {
      await api.post(`/tickets/${id}/relations`, {
        target_ticket_id: linkTargetId.trim(),
        relationship_type: linkRelationshipType,
        notes: linkNotes.trim() || null,
      });
      setSuccess("Related ticket linked.");
      setLinkDialogOpen(false);
      setLinkTargetId("");
      setLinkRelationshipType("RELATED_TO");
      setLinkNotes("");
      await load();
    } catch (linkError) {
      setError(getApiErrorMessage(linkError, "Failed to link the existing ticket."));
    } finally {
      setLinkSubmitting(false);
    }
  };

  const applyChanges = async () => {
    if (!id) return;
    setError("");
    setSuccess("");
    try {
      await api.patch(`/tickets/${id}/assign`, {
        assigned_team: assignedTeam,
        assigned_agent: assignedAgent,
      });

      if (status === "RESOLVED") {
        if (!resolutionSteps.trim()) {
          setResolutionSteps("1. ");
        }
        setResolveOpen(true);
        return;
      }

      await api.patch(`/tickets/${id}/status`, { status });

      setSuccess("Changes applied.");
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to apply changes"));
    }
  };

  const getNextStepNumber = (text: string): number => {
    const lines = text.split(/\r?\n/);
    let max = 0;
    for (const line of lines) {
      const m = line.match(/^\s*(\d+)\.\s+/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return Math.max(1, max + 1);
  };

  const normalizeSteps = (text: string): string => {
    const lines = text.split(/\r?\n/);
    const result: string[] = [];
    let stepNum = 1;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") {
        result.push("");
        continue;
      }
      const m = trimmed.match(/^(\d+)\.\s*(.*)$/);
      if (m) {
        result.push(`${stepNum}. ${m[2]}`);
        stepNum++;
      } else {
        result.push(`${stepNum}. ${trimmed}`);
        stepNum++;
      }
    }

    if (result.every((l) => !l.trim())) {
      return "1. ";
    }

    return result.join("\n");
  };

  const selectionOverlapsLockedPrefix = (value: string, start: number, end: number): boolean => {
    const text = (value || "").replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    let cursor = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const prefixMatch = line.match(/^\s*(\d+)\.\s*/);
      const prefixLen = prefixMatch ? prefixMatch[0].length : 0;
      const lockedStart = cursor;
      const lockedEnd = cursor + prefixLen;

      const overlaps = Math.max(start, lockedStart) < Math.min(end, lockedEnd);
      if (overlaps && prefixLen > 0) return true;

      cursor += line.length;
      if (i < lines.length - 1) cursor += 1; // newline
    }
    return false;
  };

  const handleStepsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = resolutionStepsRef.current;
    if (!el) return;

    if (e.key === "Backspace" || e.key === "Delete") {
      const value = el.value ?? "";
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      if (start !== end) {
        if (selectionOverlapsLockedPrefix(value, start, end)) {
          e.preventDefault();
          return;
        }
      } else {
        const before = value.slice(0, start);
        const lineStart = before.lastIndexOf("\n") + 1;
        const line = value.slice(lineStart).split("\n")[0] ?? "";
        const m = line.match(/^\s*(\d+)\.\s*/);
        const prefixLen = m ? m[0].length : 0;
        const caretInPrefix = start <= lineStart + prefixLen;
        if (prefixLen > 0 && caretInPrefix) {
          e.preventDefault();
          return;
        }
      }
    }

    if (e.key !== "Enter" || e.shiftKey) return;

    e.preventDefault();

    const value = el.value ?? "";
    const next = getNextStepNumber(value);
    const insert = `\n${next}. `;

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const updated = value.slice(0, start) + insert + value.slice(end);

    setResolutionSteps(updated);

    requestAnimationFrame(() => {
      const el2 = resolutionStepsRef.current;
      if (!el2) return;
      const caret = start + insert.length;
      el2.focus();
      el2.setSelectionRange(caret, caret);
    });
  };

  const confirmResolve = async () => {
    if (!id) return;
    const summary = resolutionSummary.trim();
    const steps = normalizeSteps(resolutionSteps).trim();
    if (!summary || !steps) {
      setError("Resolution summary and steps performed are required.");
      return;
    }

    setResolving(true);
    setError("");
    setSuccess("");
    try {
      await api.patch(`/tickets/${id}/status`, {
        status: "RESOLVED",
        resolution: {
          resolution_summary: summary,
          symptoms: resolutionSymptoms.trim() ? resolutionSymptoms.trim() : null,
          root_cause: resolutionRootCause.trim() ? resolutionRootCause.trim() : null,
          steps_performed: steps,
        },
      });
      setResolveOpen(false);
      setResolutionSummary("");
      setResolutionSymptoms("");
      setResolutionRootCause("");
      setResolutionSteps("");
      setSuccess("Changes applied.");
      await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to resolve ticket"));
    } finally {
      setResolving(false);
    }
  };

  const sendReply = async () => {
    if (!id) return;
    const body = replyBody.trim();
    if (!body) return;
    setSendingReply(true);
      setError("");
      setSuccess("");
      try {
        await api.post(`/tickets/${id}/comments`, { body, visibility: "REQUESTER_COMMENT" });
        setReplyBody("");
        await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to send reply"));
    } finally {
      setSendingReply(false);
    }
  };

  const sendInternalNote = async () => {
    if (!id) return;
    const body = internalNote.trim();
    if (!body) return;
    setSendingInternalNote(true);
      setError("");
      setSuccess("");
      try {
        await api.post(`/tickets/${id}/comments`, { body, visibility: "INTERNAL_NOTE" });
        setInternalNote("");
        await load();
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "Failed to add internal note"));
    } finally {
      setSendingInternalNote(false);
    }
  };

  const expandCannedTemplate = React.useCallback(
    (template: string, linkedArticleId?: string | null, linkedArticleTitle?: string | null) => {
      const articleUrl =
        linkedArticleId && linkedArticleId.trim().length > 0
          ? `${window.location.origin}/app/help/${linkedArticleId}`
          : "";

      const replacements: Record<string, string> = {
        "{{ticket_id}}": ticket?.id || id || "",
        "{{ticket_number}}": ticket?.id ? ticket.id.slice(0, 8) : id ? id.slice(0, 8) : "",
        "{{requester_name}}": ticket?.requester_name || "",
        "{{requester_email}}": ticket?.requester_email || "",
        "{{agent_name}}": user?.name || "",
        "{{article_title}}": linkedArticleTitle || "",
        "{{article_url}}": articleUrl,
      };

      let result = template;
      Object.entries(replacements).forEach(([key, value]) => {
        result = result.split(key).join(value);
      });
      return result.trim();
    },
    [ticket, id, user?.name]
  );

  const insertSelectedCannedResponse = async (target: "reply" | "internal") => {
    if (!selectedCannedResponseId) return;
    const chosen = cannedResponses.find((item) => item.id === selectedCannedResponseId);
    if (!chosen) return;

    const composed = expandCannedTemplate(chosen.body, chosen.linked_article_id, chosen.linked_article_title || null);

    if (target === "reply") {
      setReplyBody((prev) => (prev.trim() ? `${prev.trim()}\n\n${composed}` : composed));
    } else {
      setInternalNote((prev) => (prev.trim() ? `${prev.trim()}\n\n${composed}` : composed));
    }

    try {
      await api.post(`/kb/canned-responses/${chosen.id}/use`);
    } catch {
      // Best effort usage tracking.
    }
  };

  // Presence and locking functions
  const acquireLock = async () => {
    if (!id) return;
    try {
      const response = await api.post<TicketLock>(`/tickets/${id}/lock`);
      setTicketLock(response.data);
      setIsEditing(true);
      setLockError("");
      
      await api.post(`/tickets/${id}/presence`, { status: 'editing' });
    } catch (error: any) {
      setLockError(error.response?.data?.message || "Failed to acquire lock");
    }
  };

  const releaseLock = async () => {
    if (!id || !ticketLock?.is_current_user) return;
    try {
      await api.delete(`/tickets/${id}/lock`);
      setTicketLock(null);
      setIsEditing(false);
      
      await api.post(`/tickets/${id}/presence`, { status: 'viewing' });
    } catch (error) {
      console.error("Failed to release lock:", error);
    }
  };

  const updatePresence = async (status: 'viewing' | 'editing') => {
    if (!id) return;
    try {
      await api.post(`/tickets/${id}/presence`, { status });
    } catch (error) {
      console.error("Failed to update presence:", error);
    }
  };

  const handleFieldFocus = async () => {
    if (!isEditing && !ticketLock?.is_current_user) {
      await acquireLock();
    } else if (isEditing) {
      await updatePresence('editing');
    }
  };

  const handleFieldBlur = async () => {
    if (isEditing) {
      await updatePresence('viewing');
    }
  };

  // UI Helpers
  const getStatusColor = (s: string) => {
    switch (s) {
      case "OPEN": return "error";
      case "IN_PROGRESS": return "warning";
      case "WAITING_FOR_CUSTOMER": return "info";
      case "RESOLVED": return "success";
      case "CLOSED": return "default";
      default: return "default";
    }
  };

  const getPriorityColor = (p: string) => {
    switch (p) {
      case "HIGH": return "error";
      case "MEDIUM": return "warning";
      case "LOW": return "success";
      default: return "default";
    }
  };

  return (
    <PageContainer>
      {/* Header & Nav */}
      <HeaderSection>
        <Button 
          startIcon={<ArrowBack />} 
          onClick={() => navigate("/admin/tickets")}
          sx={{ mb: 2, color: 'text.secondary', '&:hover': { color: 'primary.main', bgcolor: 'transparent' } }}
        >
          Back to Inbox
        </Button>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
              <Typography variant="h4" sx={{ fontWeight: 800, color: '#1e293b' }}>
                Ticket #{id?.substring(0, 8)}
              </Typography>
              {ticket && (
                <>
                  <Chip 
                    label={ticket.status.replace(/_/g, " ")} 
                    color={getStatusColor(ticket.status) as any} 
                    sx={{ fontWeight: 700, borderRadius: '8px' }} 
                  />
                  <Chip 
                    label={`${ticket.priority} PRIORITY`} 
                    variant="outlined"
                    color={getPriorityColor(ticket.priority) as any} 
                    sx={{ fontWeight: 600, borderRadius: '8px', borderWidth: 2 }} 
                  />
                </>
              )}
            </Box>
              <Typography variant="h6" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                {ticket?.title || "Loading..."}
              </Typography>
              {ticket?.tag_names?.length ? (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                  {ticket.tag_names.map((tag) => (
                    <Chip key={tag} label={tag} size="small" />
                  ))}
                </Stack>
              ) : null}
            </Box>

            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button
                variant={isWatching ? "outlined" : "contained"}
                color={isWatching ? "inherit" : "primary"}
                startIcon={isWatching ? <UnfollowIcon /> : <FollowIcon />}
                onClick={() => void toggleWatch()}
                disabled={watchSubmitting}
                sx={{ borderRadius: '10px', fontWeight: 600 }}
              >
                {isWatching ? "Unfollow" : "Follow"}
              </Button>
              <Button
                variant="outlined"
                startIcon={<BugReportIcon />}
                disabled={!ticket || ticket.type !== "INCIDENT"}
                onClick={() => void createContextualRecord("PROBLEM")}
                sx={{ borderRadius: '10px', fontWeight: 600 }}
              >
                Create Problem
              </Button>
              <Button
                variant="outlined"
                startIcon={<SyncIcon />}
                disabled={!ticket || ticket.type !== "PROBLEM"}
                onClick={() => void createContextualRecord("CHANGE")}
                sx={{ borderRadius: '10px', fontWeight: 600 }}
              >
                Create Change
              </Button>
              <Button
                variant="outlined"
                startIcon={<LinkIcon />}
                onClick={() => setLinkDialogOpen(true)}
                sx={{ borderRadius: '10px', fontWeight: 600 }}
              >
                Link Existing Ticket
              </Button>
              <Button
                variant="contained"
                startIcon={<Save />}
              onClick={applyChanges}
              disabled={loading || !!ticketLock && !(ticketLock.is_current_user ?? false)}
              sx={{ 
                borderRadius: '10px', 
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                fontWeight: 600
              }}
            >
              Save Changes
            </Button>
          </Box>
        </Box>
      </HeaderSection>

      {/* Alerts & Messages */}
      <Stack spacing={2} sx={{ mb: 3 }}>
        {error && <Alert severity="error" sx={{ borderRadius: '12px' }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ borderRadius: '12px' }}>{success}</Alert>}
        
        {ticket?.dedup_master_id && (
          <Alert severity="info" icon={<InfoIcon />} sx={{ borderRadius: '12px' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Linked Duplicate</Typography>
            This ticket is a duplicate of <strong>{ticket.dedup_master_id}</strong>. Please update the master ticket.
          </Alert>
        )}

        {lockError && <Alert severity="warning" sx={{ borderRadius: '12px' }}>{lockError}</Alert>}

        {approval && (
            <Box>
              {approval.status === "pending" && (
                <Alert severity="info" sx={{ borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>AI Auto-Resolve: Awaiting Approval</Typography>
                  {approval.action_title} — {approval.action_body}
                </Alert>
              )}
              {approval.status === "approved" && !verification && ticket?.status !== "RESOLVED" && (
                <Alert severity="warning" sx={{ borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>AI Auto-Resolve: Pending Verification</Typography>
                  Fix applied. Waiting for employee confirmation.
                </Alert>
              )}
              {verification && (
                <Alert severity={verification.worked ? "success" : "error"} sx={{ borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {verification.worked ? "AI Auto-Resolve Successful" : "AI Auto-Resolve Failed – Escalated"}
                  </Typography>
                  {verification.notes && <Typography variant="body2" sx={{ mt: 0.5 }}>Note: {verification.notes}</Typography>}
                </Alert>
              )}
            </Box>
          )}
      </Stack>

      {/* Main Grid Layout */}
      <Grid container spacing={3}>
        {/* LEFT COLUMN: Main Content */}
        <Grid item xs={12} lg={8}>
          
          {/* Presence & Lock Bar */}
          {(presenceUsers.length > 0 || ticketLock) && (
            <PresenceContainer
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#64748b', display: 'flex', alignItems: 'center' }}>
                  <PeopleIcon sx={{ fontSize: 18, mr: 1 }} />
                  Active Workspace
                </Typography>
                <Chip 
                  icon={<SyncIcon sx={{ animation: 'spin 2s linear infinite' }} />} 
                  label="Live Sync" 
                  size="small" 
                  color="success" 
                  variant="outlined" 
                  sx={{ borderRadius: '8px' }}
                />
              </Box>
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                {ticketLock && (
                  <LockIndicator isLocked={!ticketLock.is_current_user}>
                    {ticketLock.is_current_user ? (
                      <>
                        <LockOpenIcon sx={{ fontSize: 16 }} />
                        You are editing
                        <Button size="small" onClick={releaseLock} sx={{ minWidth: 'auto', ml: 1, p: 0.5, fontSize: '0.75rem' }}>
                          Release
                        </Button>
                      </>
                    ) : (
                      <>
                        <LockIcon sx={{ fontSize: 16 }} />
                        {ticketLock.user_name} is editing
                      </>
                    )}
                  </LockIndicator>
                )}
                
                <Box sx={{ display: 'flex', ml: 'auto' }}>
                  {presenceUsers.map((user) => (
                    <Tooltip key={user.id} title={`${user.name} (${user.status})`}>
                      <PresenceAvatar status={user.status} src={user.avatar} alt={user.name} sx={{ ml: -1 }}>
                        {user.name.charAt(0)}
                      </PresenceAvatar>
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            </PresenceContainer>
          )}

          {/* Ticket Description Card */}
          <DetailCard
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <CardHeaderStyled>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Description</Typography>
              <Typography variant="caption" color="text.secondary">
                Created {ticket ? formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true }) : ''}
              </Typography>
            </CardHeaderStyled>
            <CardContent>
              <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', color: '#334155', lineHeight: 1.6 }}>
                {htmlToPlainText(ticket?.description)}
              </Typography>
            </CardContent>
          </DetailCard>

          {/* Visual Flow */}
          <DetailCard
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
          >
            <CardHeaderStyled>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Process Flow</Typography>
            </CardHeaderStyled>
            <Box sx={{ p: 3 }}>
              {ticket && (
                <TicketFlowVisualization
                  ticketId={ticket.id}
                  status={ticket.status}
                  category={ticket.category}
                  aiConfidence={ticket.ai_confidence}
                  assignedTeam={ticket.assigned_team_name}
                  assignedAgent={ticket.assigned_agent_name}
                  sourceType={ticket.source_type || undefined}
                  events={events}
                  createdAt={ticket.created_at}
                />
              )}
            </Box>
          </DetailCard>

          {/* Activity / Conversation */}
          <DetailCard
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
          >
            <CardHeaderStyled>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Activity & Comments</Typography>
              <Chip icon={<ChatIcon sx={{ fontSize: 16 }} />} label={`${comments.length} comments`} size="small" />
            </CardHeaderStyled>
            <CardContent sx={{ p: 3 }}>
              {/* History Accordion */}
              <Accordion sx={{ 
                mb: 3, 
                borderRadius: '12px !important', 
                boxShadow: 'none', 
                border: '1px solid rgba(255, 255, 255, 0.3)',
                background: 'rgba(255, 255, 255, 0.4)',
                '&:before': { display: 'none' }
              }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <HistoryIcon color="action" /> Audit Log ({events.length})
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ maxHeight: 300, overflowY: 'auto' }}>
                  <List dense>
                    {events.map((entry, idx) => (
                      <React.Fragment key={entry.id}>
                        <ListItem>
                          <ListItemText
                            primary={<Typography variant="body2" fontWeight={600}>{entry.action}</Typography>}
                            secondary={
                              <Typography variant="caption" color="text.secondary">
                                {new Date(entry.timestamp).toLocaleString()} • {entry.performed_by_name || entry.performed_by || "System"}
                              </Typography>
                            }
                          />
                        </ListItem>
                        {idx < events.length - 1 && <Divider component="li" />}
                      </React.Fragment>
                    ))}
                  </List>
                </AccordionDetails>
              </Accordion>

              {/* Comments Stream */}
              <Stack spacing={2}>
                {comments.length === 0 && (
                  <Typography color="text.secondary" align="center" sx={{ py: 4 }}>No messages yet.</Typography>
                )}
                
                {comments.map((c) => (
                  <CommentBubble key={c.id} isInternal={c.is_internal} isSelf={c.author_id === user?.id}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Avatar sx={{ width: 24, height: 24, fontSize: 12 }}>{c.author_name.charAt(0)}</Avatar>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{c.author_name}</Typography>
                        <Chip
                          label={c.visibility === "INTERNAL_NOTE" ? "Internal Note" : "Requester Comment"}
                          size="small"
                          color={c.visibility === "INTERNAL_NOTE" ? "warning" : "default"}
                          sx={{ height: 20, fontSize: '0.65rem' }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: '#334155' }}>{c.body}</Typography>
                  </CommentBubble>
                ))}
              </Stack>

              {/* Reply Box */}
              <Paper sx={{ p: 2, mt: 3, borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>Post a Reply</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
                      <FormControl size="small" sx={{ minWidth: 280, flex: 1 }}>
                        <InputLabel>Canned Response</InputLabel>
                        <Select
                          value={selectedCannedResponseId}
                          label="Canned Response"
                          onChange={(e: SelectChangeEvent) => setSelectedCannedResponseId(String(e.target.value))}
                        >
                          <MenuItem value="">
                            <em>Select template</em>
                          </MenuItem>
                          {cannedResponses.map((item) => (
                            <MenuItem key={item.id} value={item.id}>
                              {item.title}
                              {item.category ? ` (${item.category})` : ""}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Button
                        variant="outlined"
                        onClick={() => void insertSelectedCannedResponse("reply")}
                        disabled={!selectedCannedResponseId}
                      >
                        Insert In Reply
                      </Button>
                      <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => void insertSelectedCannedResponse("internal")}
                        disabled={!selectedCannedResponseId}
                      >
                        Insert In Internal Note
                      </Button>
                    </Box>
                  </Grid>
                  <Grid item xs={12}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={3}
                      placeholder="Type your reply here..."
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      variant="outlined"
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
                    />
                  </Grid>
                  <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                    <Button 
                      variant="contained" 
                      endIcon={<SendIcon />} 
                      onClick={() => void sendReply()} 
                      disabled={sendingReply || !replyBody.trim()}
                    >
                      Send Reply
                    </Button>
                  </Grid>
                  {/* Internal Note Input (Separate) */}
                  <Grid item xs={12}>
                     <Accordion sx={{ 
                       boxShadow: 'none', 
                       border: '1px dashed rgba(203, 213, 225, 0.8)',
                       background: 'rgba(255, 255, 255, 0.4)', 
                       borderRadius: '8px !important', 
                       '&:before': { display: 'none' } 
                     }}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                           <Typography variant="body2" color="text.secondary">Add Internal Note instead?</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <TextField
                            fullWidth
                            multiline
                            minRows={2}
                            placeholder="Internal team note (hidden from customer)..."
                            value={internalNote}
                            onChange={(e) => setInternalNote(e.target.value)}
                            sx={{ mb: 2, bgcolor: '#fff8e1' }}
                          />
                          <Button 
                            size="small" 
                            variant="contained" 
                            color="warning" 
                            onClick={() => void sendInternalNote()}
                            disabled={sendingInternalNote || !internalNote.trim()}
                          >
                            Post Internal Note
                          </Button>
                        </AccordionDetails>
                     </Accordion>
                  </Grid>
                </Grid>
              </Paper>

            </CardContent>
          </DetailCard>

        </Grid>

        {/* RIGHT COLUMN: Metadata & Actions */}
        <Grid item xs={12} lg={4}>
          <DetailCard
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
          >
            <CardHeaderStyled>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Properties</Typography>
            </CardHeaderStyled>
            <CardContent>
              <Stack spacing={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={status}
                    label="Status"
                    onChange={(e: SelectChangeEvent) => setStatus(e.target.value as TicketStatus)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    disabled={!!ticketLock && !(ticketLock.is_current_user ?? false)}
                  >
                    <MenuItem value="OPEN">Open</MenuItem>
                    <MenuItem value="IN_PROGRESS">In Progress</MenuItem>
                    <MenuItem value="WAITING_FOR_CUSTOMER">Waiting for Customer</MenuItem>
                    <MenuItem value="RESOLVED">Resolved</MenuItem>
                    <MenuItem value="CLOSED">Closed</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small">
                  <InputLabel>Priority</InputLabel>
                  <Select
                    value={priority}
                    label="Priority"
                    onChange={(e: SelectChangeEvent) => setPriority(e.target.value as TicketPriority)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    disabled={!!ticketLock && !(ticketLock.is_current_user ?? false)}
                  >
                    <MenuItem value="LOW">Low</MenuItem>
                    <MenuItem value="MEDIUM">Medium</MenuItem>
                    <MenuItem value="HIGH">High</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small">
                  <InputLabel>Assigned Team</InputLabel>
                  <Select
                    value={assignedTeam || ""}
                    label="Assigned Team"
                    onChange={(e: SelectChangeEvent) => setAssignedTeam(e.target.value || null)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    disabled={!!ticketLock && !(ticketLock.is_current_user ?? false)}
                  >
                    <MenuItem value=""><em>Unassigned</em></MenuItem>
                    {teams.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small">
                  <InputLabel>Assigned Agent</InputLabel>
                  <Select
                    value={assignedAgent || ""}
                    label="Assigned Agent"
                    onChange={(e: SelectChangeEvent) => setAssignedAgent(e.target.value || null)}
                    onFocus={handleFieldFocus}
                    onBlur={handleFieldBlur}
                    disabled={!!ticketLock && !(ticketLock.is_current_user ?? false)}
                  >
                    <MenuItem value=""><em>Unassigned</em></MenuItem>
                    {agents.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
            </CardContent>
          </DetailCard>

          <DetailCard
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.4 }}
          >
            <CardHeaderStyled>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>Requester Info</Typography>
            </CardHeaderStyled>
            <CardContent>
               <List dense>
                 <ListItem disablePadding sx={{ mb: 1 }}>
                   <ListItemText 
                     primary="Name" 
                     secondary={<Typography variant="body2" color="text.primary">{ticket?.requester_name || 'Unknown'}</Typography>} 
                   />
                 </ListItem>
                 <ListItem disablePadding sx={{ mb: 1 }}>
                   <ListItemText 
                     primary="Email" 
                     secondary={<Typography variant="body2" color="text.primary">{ticket?.requester_email || 'Unknown'}</Typography>} 
                   />
                 </ListItem>
                 <ListItem disablePadding>
                   <ListItemText 
                     primary="Source" 
                     secondary={<Chip label={ticket?.source_type || 'WEB'} size="small" variant="outlined" />} 
                   />
                 </ListItem>
               </List>
            </CardContent>
          </DetailCard>
          
            <DetailCard
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               transition={{ duration: 0.3, delay: 0.5 }}
            >
               <CardHeaderStyled>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>Followers</Typography>
                <Chip label={`${watchers.length}`} size="small" />
               </CardHeaderStyled>
               <CardContent>
                 {watchers.length ? (
                   <Stack spacing={1.25}>
                     {watchers.map((watcher) => (
                       <Box
                         key={watcher.id}
                         sx={{
                           display: 'flex',
                           alignItems: 'center',
                           justifyContent: 'space-between',
                           gap: 1,
                         }}
                       >
                         <Stack direction="row" spacing={1.25} alignItems="center">
                           <Avatar sx={{ width: 30, height: 30, fontSize: 13 }}>
                             {watcher.name.charAt(0)}
                           </Avatar>
                           <Box>
                             <Typography variant="body2" sx={{ fontWeight: 600 }}>
                               {watcher.name}
                             </Typography>
                             <Typography variant="caption" color="text.secondary">
                               {watcher.email}
                             </Typography>
                           </Box>
                         </Stack>
                         <Chip size="small" label={watcher.role} variant="outlined" />
                       </Box>
                     ))}
                   </Stack>
                 ) : (
                   <Typography variant="body2" color="text.secondary">
                     No one is following this ticket yet.
                   </Typography>
                 )}
               </CardContent>
            </DetailCard>
            
            <DetailCard
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               transition={{ duration: 0.3, delay: 0.5 }}
            >
               <CardHeaderStyled>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>AI Insights</Typography>
                <BugReportIcon color="action" />
             </CardHeaderStyled>
             <CardContent>
               <Stack spacing={2}>
                 <Box>
                   <Typography variant="caption" color="text.secondary">Category Prediction</Typography>
                   <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <Typography variant="body2" fontWeight={600}>{ticket?.category || "Uncategorized"}</Typography>
                     {ticket?.ai_confidence && (
                       <Chip label={`${Math.round(ticket.ai_confidence * 100)}% Conf.`} size="small" color="primary" variant="outlined" />
                     )}
                   </Box>
                 </Box>
                 {/* Placeholder for Sentiment or other AI metrics */}
               </Stack>
             </CardContent>
          </DetailCard>

        </Grid>
        </Grid>

        <Dialog
          open={linkDialogOpen}
          onClose={() => (linkSubmitting ? undefined : setLinkDialogOpen(false))}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Link Existing Ticket</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Target Ticket ID"
                placeholder="Paste the target ticket UUID"
                value={linkTargetId}
                onChange={(e) => setLinkTargetId(e.target.value)}
                fullWidth
              />
              <FormControl fullWidth>
                <InputLabel>Relationship</InputLabel>
                <Select
                  label="Relationship"
                  value={linkRelationshipType}
                  onChange={(e: SelectChangeEvent) => setLinkRelationshipType(String(e.target.value))}
                >
                  <MenuItem value="RELATED_TO">Related To</MenuItem>
                  <MenuItem value="DUPLICATE_OF">Duplicate Of</MenuItem>
                  <MenuItem value="BLOCKED_BY">Blocked By</MenuItem>
                  <MenuItem value="CAUSE_OF">Cause Of</MenuItem>
                  <MenuItem value="RESOLVED_BY_CHANGE">Resolved By Change</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="Notes"
                placeholder="Optional context for the linked record"
                value={linkNotes}
                onChange={(e) => setLinkNotes(e.target.value)}
                fullWidth
                multiline
                minRows={3}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLinkDialogOpen(false)} disabled={linkSubmitting}>
              Cancel
            </Button>
            <Button variant="contained" onClick={() => void submitLinkedTicket()} disabled={linkSubmitting || !linkTargetId.trim()}>
              Link Ticket
            </Button>
          </DialogActions>
        </Dialog>

        {/* Resolution Dialog */}
        <Dialog 
        open={resolveOpen} 
        onClose={() => (resolving ? undefined : setResolveOpen(false))} 
        fullWidth 
        maxWidth="md"
        PaperProps={{ 
          sx: { 
            borderRadius: '16px',
            backdropFilter: 'blur(12px)',
            background: 'rgba(255, 255, 255, 0.9)'
          } 
        }}
      >
        <DialogTitle sx={{ borderBottom: '1px solid #e2e8f0' }}>
          <Typography variant="h5" fontWeight={700}>Resolve Ticket</Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3} sx={{ mt: 1 }}>
            <Alert severity="success" icon={<CheckCircleIcon fontSize="inherit" />}>
              You are about to resolve this ticket. Please provide the resolution details below.
            </Alert>
            
            <TextField
              label="Resolution Summary"
              placeholder="Brief summary of how the issue was resolved..."
              value={resolutionSummary}
              onChange={(e) => setResolutionSummary(e.target.value)}
              fullWidth
              required
              multiline
              minRows={2}
              variant="outlined"
            />
            
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>Steps Performed (Required)</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                List the steps taken to resolve the issue. Press Enter to add a new step.
              </Typography>
              <TextField
                value={resolutionSteps}
                onChange={(e) => setResolutionSteps(e.target.value === "" ? "1. " : e.target.value)}
                onKeyDown={handleStepsKeyDown}
                onBlur={() => setResolutionSteps((s) => normalizeSteps(s))}
                fullWidth
                required
                multiline
                minRows={6}
                inputRef={resolutionStepsRef}
                placeholder={`1. Diagnosed the issue...\n2. Applied patch...\n3. Verified fix...`}
                sx={{ fontFamily: 'monospace' }}
              />
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Symptoms (Optional)"
                  value={resolutionSymptoms}
                  onChange={(e) => setResolutionSymptoms(e.target.value)}
                  fullWidth
                  multiline
                  minRows={2}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Root Cause (Optional)"
                  value={resolutionRootCause}
                  onChange={(e) => setResolutionRootCause(e.target.value)}
                  fullWidth
                  multiline
                  minRows={2}
                />
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3, borderTop: '1px solid #e2e8f0' }}>
          <Button onClick={() => setResolveOpen(false)} disabled={resolving} size="large">
            Cancel
          </Button>
          <Button 
            variant="contained" 
            onClick={() => void confirmResolve()} 
            disabled={resolving}
            size="large"
            color="success"
            startIcon={<CheckCircleIcon />}
          >
            Confirm Resolution
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
};
