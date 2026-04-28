import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Backdrop,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import ChatIcon from "@mui/icons-material/Chat";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import HistoryRoundedIcon from "@mui/icons-material/HistoryRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import ArrowOutwardRoundedIcon from "@mui/icons-material/ArrowOutwardRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import { api, getApiErrorMessage } from "../../services/api";
import { useAuth } from "../../services/auth";

interface KbArticle {
  id: string;
  title: string;
  body: string;
  category?: string;
  relevance?: number;
}

interface TicketReadiness {
  ready: boolean;
  missingFields: string[];
  guidance: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  intent?: string;
  kbArticlesSuggested?: string[];
  ticketCreatedId?: string;
  autoResolved?: boolean;
  createdAt?: string;
  kbArticles?: KbArticle[];
  ticketReadiness?: TicketReadiness | null;
}

interface ChatSessionItem {
  id: string;
  sessionToken: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  title: string;
  preview: string | null;
  isPinned?: boolean;
  isArchived?: boolean;
}

interface ChatWidgetProps {
  sessionToken?: string;
  onTicketCreated?: (ticketId: string) => void;
  audienceRole?: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";
}

const PROMPTS_BY_ROLE: Record<NonNullable<ChatWidgetProps["audienceRole"]>, string[]> = {
  EMPLOYEE: [
    "My VPN is not connecting from home",
    "Outlook is not receiving new emails",
    "I need help creating a ticket for my laptop issue",
  ],
  AGENT: [
    "Suggest triage questions for a backup failure",
    "Draft a reply asking the user for screenshots and logs",
    "How should I prioritize a network outage ticket?",
  ],
  MANAGER: [
    "Summarize today's SLA risks for my team",
    "What should I check before escalating a priority ticket?",
    "How do I review team ticket workload quickly?",
  ],
  ADMIN: [
    "How should I configure routing for hardware issues?",
    "Help me think through a workflow for password resets",
    "What should I audit for ticket ownership changes?",
  ],
};

const CHATBOT_STORAGE_VERSION = "v2";

const formatTimestamp = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatRelativeTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return formatTimestamp(value);
};

const customScrollSx = {
  overflowY: "auto",
  overscrollBehavior: "contain",
  scrollbarWidth: "thin",
  scrollbarColor: "rgba(148, 163, 184, 0.9) transparent",
  "&::-webkit-scrollbar": {
    width: 10,
  },
  "&::-webkit-scrollbar-track": {
    backgroundColor: "transparent",
  },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: "rgba(148, 163, 184, 0.9)",
    borderRadius: 999,
    border: "2px solid transparent",
    backgroundClip: "content-box",
  },
  "&::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "rgba(100, 116, 139, 0.95)",
  },
} as const;

const humanizeMissingField = (field: string) =>
  ({
    issue: "Issue",
    impact: "Impact",
    urgency: "Urgency",
    device: "Device/System",
    location: "Location",
    error_message: "Error message",
  }[field] || field.replace(/_/g, " "));

export const ChatWidget: React.FC<ChatWidgetProps> = ({
  sessionToken: initialSessionToken,
  onTicketCreated,
  audienceRole = "EMPLOYEE",
}) => {
  const theme = useTheme();
  const compactLayout = useMediaQuery(theme.breakpoints.down("lg"));
  const { isAuthenticated, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<ChatSessionItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string>();
  const [sessionToken, setSessionToken] = useState<string | undefined>(initialSessionToken);
  const [ticketCreated, setTicketCreated] = useState<{ id: string } | null>(null);
  const [pendingReadiness, setPendingReadiness] = useState<TicketReadiness | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(!compactLayout);
  const [sessionMenuAnchorEl, setSessionMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [sessionMenuTarget, setSessionMenuTarget] = useState<ChatSessionItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatSessionItem | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<ChatSessionItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [processingSessionId, setProcessingSessionId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const recoveringSessionRef = useRef(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const sessionTokenRef = useRef<string | undefined>(initialSessionToken);

  const sessionStorageKeyBase = `chatbot_session_${CHATBOT_STORAGE_VERSION}_${user?.id || "anon"}_${audienceRole}`;
  const sessionTokenStorageKey = `${sessionStorageKeyBase}_token`;
  const sessionIdStorageKey = `${sessionStorageKeyBase}_id`;
  const storageCleanupMarkerKey = `chatbot_storage_cleanup_${CHATBOT_STORAGE_VERSION}`;

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const alreadyCleaned = window.localStorage.getItem(storageCleanupMarkerKey);
      if (alreadyCleaned === "done") return;

      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (key.startsWith("chatbot_session_") && !key.startsWith(`chatbot_session_${CHATBOT_STORAGE_VERSION}_`)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => window.localStorage.removeItem(key));
      window.localStorage.setItem(storageCleanupMarkerKey, "done");
    } catch {
      return;
    }
  }, [storageCleanupMarkerKey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const roleCopy = useMemo(() => {
    if (audienceRole === "ADMIN") {
      return {
        title: "Admin AI Console",
        subtitle: "Workflow, routing, governance, and operational guidance.",
      };
    }
    if (audienceRole === "MANAGER") {
      return {
        title: "Manager AI Assistant",
        subtitle: "SLA awareness, workload coaching, and team support.",
      };
    }
    if (audienceRole === "AGENT") {
      return {
        title: "Agent Copilot",
        subtitle: "Triage, next steps, and polished requester communication.",
      };
    }
    return {
      title: "IT Help Assistant",
      subtitle: "Describe the issue, search KB answers, and create a clean ticket.",
    };
  }, [audienceRole]);

  const loadSessions = useCallback(async () => {
    if (!isAuthenticated) return [];
    setHistoryLoading(true);
    try {
      const res = await api.get<ChatSessionItem[]>("/chatbot/sessions", {
        params: { limit: 20, cacheBust: String(Date.now()) },
      });
      const next = res.data || [];
      setSessions(next);
      return next;
    } catch (err) {
      setError(getApiErrorMessage(err, "Unable to load your chat history."));
      return [];
    } finally {
      setHistoryLoading(false);
    }
  }, [isAuthenticated]);

  const persistSessionLocally = useCallback((nextSessionId?: string, nextSessionToken?: string) => {
    try {
      if (nextSessionId) {
        window.localStorage.setItem(sessionIdStorageKey, nextSessionId);
      }
      if (nextSessionToken) {
        window.localStorage.setItem(sessionTokenStorageKey, nextSessionToken);
      }
    } catch {
      return;
    }
  }, [sessionIdStorageKey, sessionTokenStorageKey]);

  const clearStoredSession = useCallback(() => {
    try {
      window.localStorage.removeItem(sessionIdStorageKey);
      window.localStorage.removeItem(sessionTokenStorageKey);
    } catch {
      return;
    }
  }, [sessionIdStorageKey, sessionTokenStorageKey]);

  const createFreshSession = useCallback(
    async () => {
      setHydrating(true);
      setError("");
      clearStoredSession();
      setSessionId(undefined);
      setSessionToken(undefined);
      sessionIdRef.current = undefined;
      sessionTokenRef.current = undefined;
      setMessages([]);
      setTicketCreated(null);
      setPendingReadiness(null);
      try {
        const res = await api.post<{ sessionId: string; sessionToken: string }>("/chatbot/session", {
          audienceRole,
          forceNew: true,
        });
        const nowIso = new Date().toISOString();
        sessionIdRef.current = res.data.sessionId;
        sessionTokenRef.current = res.data.sessionToken;
        setSessionId(res.data.sessionId);
        setSessionToken(res.data.sessionToken);
        setSessions((prev) => {
          const nextSession: ChatSessionItem = {
            id: res.data.sessionId,
            sessionToken: res.data.sessionToken,
            createdAt: nowIso,
            updatedAt: nowIso,
            lastActivityAt: nowIso,
            title: "New conversation",
            preview: null,
            isPinned: false,
            isArchived: false,
          };
          return [nextSession, ...prev.filter((item) => item.id !== res.data.sessionId)];
        });
        persistSessionLocally(res.data.sessionId, res.data.sessionToken);
        await loadSessions();
      } catch (err) {
        setError(getApiErrorMessage(err, "Unable to start a new conversation."));
      } finally {
        setHydrating(false);
      }
    },
    [audienceRole, clearStoredSession, loadSessions, persistSessionLocally]
  );

  const closeSessionMenu = useCallback(() => {
    setSessionMenuAnchorEl(null);
    setSessionMenuTarget(null);
  }, []);

  const syncAfterSessionListUpdate = useCallback(
    async () => {
      const refreshed = await loadSessions();
      setSessions(refreshed);
      return refreshed;
    },
    [loadSessions]
  );

  const recoverMissingSession = useCallback(async () => {
    if (recoveringSessionRef.current) return;
    recoveringSessionRef.current = true;

    clearStoredSession();
    setSessionId(undefined);
    setSessionToken(undefined);
    setMessages([]);
    setTicketCreated(null);
    setPendingReadiness(null);

    try {
      const nextSessions = await loadSessions();
      if (nextSessions.length > 0) {
        const next = nextSessions[0];
        sessionIdRef.current = next.id;
        sessionTokenRef.current = next.sessionToken;
        setSessionId(next.id);
        setSessionToken(next.sessionToken);
        persistSessionLocally(next.id, next.sessionToken);

        const res = await api.get<Message[]>(`/chatbot/session/${next.id}/messages`, {
          params: { limit: 80 },
        });
        setMessages(res.data || []);
      } else {
        await createFreshSession();
      }
      setError("");
    } catch {
      await createFreshSession();
      setError("");
    } finally {
      recoveringSessionRef.current = false;
    }
  }, [clearStoredSession, createFreshSession, loadSessions, persistSessionLocally]);

  const loadMessages = useCallback(async (nextSessionId: string) => {
    setHydrating(true);
    setError("");
    try {
      const res = await api.get<Message[]>(`/chatbot/session/${nextSessionId}/messages`, {
        params: { limit: 80, cacheBust: String(Date.now()) },
      });
      setMessages(res.data || []);
      setTicketCreated(null);
      setPendingReadiness(null);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        await recoverMissingSession();
      } else {
        setError(getApiErrorMessage(err, "Unable to load this conversation right now."));
      }
    } finally {
      setHydrating(false);
    }
  }, [recoverMissingSession]);

  const selectSession = useCallback(
    async (nextSession: ChatSessionItem) => {
      sessionIdRef.current = nextSession.id;
      sessionTokenRef.current = nextSession.sessionToken;
      setSessionId(nextSession.id);
      setSessionToken(nextSession.sessionToken);
      persistSessionLocally(nextSession.id, nextSession.sessionToken);
      await loadMessages(nextSession.id);
    },
    [loadMessages, persistSessionLocally]
  );

  const updateSessionMetadata = useCallback(
    async (
      target: ChatSessionItem,
      patch: { title?: string; pinned?: boolean; archived?: boolean }
    ): Promise<ChatSessionItem | null> => {
      const res = await api.patch<ChatSessionItem>(`/chatbot/session/${target.id}`, patch);
      return res.data ?? null;
    },
    []
  );

  const deleteConversation = useCallback(
    async (target: ChatSessionItem) => {
      setDeletingSessionId(target.id);
      setError("");
      const previousSessions = sessions;
      const deletingActiveSession = sessionIdRef.current === target.id;
      const optimisticSessions = previousSessions.filter((session) => session.id !== target.id);
      setSessions(optimisticSessions);

      try {
        await api.delete(`/chatbot/session/${target.id}`);

        const refreshedSessions = await syncAfterSessionListUpdate();

        if (deletingActiveSession) {
          clearStoredSession();
          setSessionId(undefined);
          setSessionToken(undefined);
          sessionIdRef.current = undefined;
          sessionTokenRef.current = undefined;
          setMessages([]);
          setTicketCreated(null);
          setPendingReadiness(null);

          if (refreshedSessions.length > 0) {
            await selectSession(refreshedSessions[0]);
          } else {
            await createFreshSession();
          }
        }

        setError("");
        setActionNotice("Conversation deleted");
      } catch (err) {
        setSessions(previousSessions);
        setError(getApiErrorMessage(err, "Unable to delete that conversation right now."));
      } finally {
        setDeletingSessionId(null);
        setDeleteTarget(null);
      }
    },
    [clearStoredSession, createFreshSession, selectSession, sessions, syncAfterSessionListUpdate]
  );

  const togglePinConversation = useCallback(
    async (target: ChatSessionItem) => {
      setProcessingSessionId(target.id);
      setError("");
      try {
        await updateSessionMetadata(target, { pinned: !Boolean(target.isPinned) });
        await syncAfterSessionListUpdate();
        setActionNotice(Boolean(target.isPinned) ? "Conversation unpinned" : "Conversation pinned");
      } catch (err) {
        setError(getApiErrorMessage(err, "Unable to update pin right now."));
      } finally {
        setProcessingSessionId(null);
        closeSessionMenu();
      }
    },
    [closeSessionMenu, syncAfterSessionListUpdate, updateSessionMetadata]
  );

  const archiveConversation = useCallback(
    async (target: ChatSessionItem) => {
      setProcessingSessionId(target.id);
      setError("");
      const archivingActive = sessionIdRef.current === target.id;
      try {
        await updateSessionMetadata(target, { archived: true, pinned: false });
        const refreshedSessions = await syncAfterSessionListUpdate();

        if (archivingActive) {
          clearStoredSession();
          setSessionId(undefined);
          setSessionToken(undefined);
          sessionIdRef.current = undefined;
          sessionTokenRef.current = undefined;
          setMessages([]);
          setTicketCreated(null);
          setPendingReadiness(null);

          if (refreshedSessions.length > 0) {
            await selectSession(refreshedSessions[0]);
          } else {
            await createFreshSession();
          }
        }
        setActionNotice("Conversation archived");
      } catch (err) {
        setError(getApiErrorMessage(err, "Unable to archive this conversation right now."));
      } finally {
        setProcessingSessionId(null);
        closeSessionMenu();
      }
    },
    [clearStoredSession, closeSessionMenu, createFreshSession, selectSession, syncAfterSessionListUpdate, updateSessionMetadata]
  );

  const renameConversation = useCallback(
    async () => {
      if (!renameTarget) return;
      const nextTitle = renameValue.trim();
      if (!nextTitle) {
        setError("Conversation title cannot be empty.");
        return;
      }

      setRenamingSessionId(renameTarget.id);
      setError("");
      try {
        await updateSessionMetadata(renameTarget, { title: nextTitle });
        await syncAfterSessionListUpdate();
        setActionNotice("Conversation renamed");
        setRenameTarget(null);
      } catch (err) {
        setError(getApiErrorMessage(err, "Unable to rename this conversation right now."));
      } finally {
        setRenamingSessionId(null);
      }
    },
    [renameTarget, renameValue, syncAfterSessionListUpdate, updateSessionMetadata]
  );

  const initialize = useCallback(async () => {
    if (!isAuthenticated || initializedRef.current) return;
    initializedRef.current = true;
    const listedSessions = await loadSessions();

    let storedToken: string | undefined;
    let storedSessionId: string | undefined;
    try {
      storedToken = initialSessionToken || window.localStorage.getItem(sessionTokenStorageKey) || undefined;
      storedSessionId = window.localStorage.getItem(sessionIdStorageKey) || undefined;
    } catch {
      storedToken = initialSessionToken;
      storedSessionId = undefined;
    }

    if (storedSessionId) {
      const match = listedSessions.find((item) => item.id === storedSessionId);
      if (match) {
        await selectSession(match);
        return;
      }
    }

    if (storedToken) {
      try {
        const res = await api.post<{ sessionId: string; sessionToken: string }>("/chatbot/session", {
          sessionToken: storedToken,
          audienceRole,
        });
        sessionIdRef.current = res.data.sessionId;
        sessionTokenRef.current = res.data.sessionToken;
        setSessionId(res.data.sessionId);
        setSessionToken(res.data.sessionToken);
        persistSessionLocally(res.data.sessionId, res.data.sessionToken);
        await loadMessages(res.data.sessionId);
        await loadSessions();
        return;
      } catch {
        // fall through to first history or fresh session
      }
    }

    if (listedSessions.length > 0) {
      await selectSession(listedSessions[0]);
      return;
    }

    await createFreshSession();
  }, [
    audienceRole,
    createFreshSession,
    initialSessionToken,
    isAuthenticated,
    loadMessages,
    loadSessions,
    persistSessionLocally,
    selectSession,
    sessionIdStorageKey,
    sessionTokenStorageKey,
  ]);

  useEffect(() => {
    if (!open) return;
    void initialize();
  }, [initialize, open]);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!isAuthenticated) {
      initializedRef.current = false;
      setMessages([]);
      setSessions([]);
      setSessionId(undefined);
      setSessionToken(undefined);
      setTicketCreated(null);
      setPendingReadiness(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    setSidebarOpen((prev) => (compactLayout ? false : prev || true));
  }, [compactLayout]);

  const appendAssistantPayload = (
    baseMessage: Message,
    payload: {
      kbArticles?: KbArticle[];
      ticketReadiness?: TicketReadiness | null;
    }
  ): Message => ({
    ...baseMessage,
    kbArticles: payload.kbArticles,
    ticketReadiness: payload.ticketReadiness ?? null,
  });

  const sendMessage = async (prefilled?: string) => {
    const content = (prefilled ?? input).trim();
    if (!content || loading) return;
    if (!sessionTokenRef.current && !sessionIdRef.current) {
      await initialize();
    }

    const tempUserMessage: Message = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMessage]);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const res = await api.post<{
        sessionId: string;
        sessionToken: string;
        message: Message;
        kbArticles?: KbArticle[];
        ticketReadiness?: TicketReadiness | null;
        shouldCreateTicket: boolean;
        ticketCreated: { id: string } | null;
      }>("/chatbot/message", {
        message: content,
        sessionToken: sessionTokenRef.current,
        audienceRole,
      });

      setSessionId(res.data.sessionId);
      setSessionToken(res.data.sessionToken);
      sessionIdRef.current = res.data.sessionId;
      sessionTokenRef.current = res.data.sessionToken;
      persistSessionLocally(res.data.sessionId, res.data.sessionToken);

      const assistantMessage = appendAssistantPayload(res.data.message, {
        kbArticles: res.data.kbArticles,
        ticketReadiness: res.data.ticketReadiness ?? null,
      });

      setMessages((prev) => [
        ...prev.filter((item) => item.id !== tempUserMessage.id),
        { ...tempUserMessage },
        assistantMessage,
      ]);
      setPendingReadiness(res.data.ticketReadiness ?? null);
      setTicketCreated(res.data.ticketCreated);
      await loadSessions();
    } catch (err) {
      setMessages((prev) => prev.filter((item) => item.id !== tempUserMessage.id));
      setError(getApiErrorMessage(err, "Sorry — I couldn't send that right now."));
    } finally {
      setLoading(false);
    }
  };

  const createTicket = async () => {
    if (!sessionIdRef.current || creatingTicket) return;
    setCreatingTicket(true);
    setError("");
    try {
      const res = await api.post<{ ticketId: string }>("/chatbot/create-ticket", {
        sessionId: sessionIdRef.current,
      });
      const nextTicket = { id: res.data.ticketId };
      setTicketCreated(nextTicket);
      setPendingReadiness(null);
      await loadMessages(sessionIdRef.current);
      await loadSessions();
      onTicketCreated?.(nextTicket.id);
    } catch (err) {
      setError(getApiErrorMessage(err, "I couldn't create the ticket. Please try again."));
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const renderMessageBubble = (message: Message) => {
    const isUser = message.role === "user";
    const isSystem = message.role === "system";

    return (
      <Box
        key={message.id}
        sx={{
          display: "flex",
          gap: 1.25,
          alignItems: "flex-start",
          justifyContent: isUser ? "flex-end" : "flex-start",
        }}
      >
        {!isUser && (
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: isSystem ? "warning.light" : "primary.light",
              color: isSystem ? "warning.dark" : "primary.dark",
            }}
          >
            {isSystem ? <ConfirmationNumberOutlinedIcon sx={{ fontSize: 18 }} /> : <SupportAgentRoundedIcon sx={{ fontSize: 18 }} />}
          </Avatar>
        )}

        <Paper
          elevation={0}
          sx={{
            maxWidth: "78%",
            borderRadius: 4,
            px: 1.75,
            py: 1.5,
            bgcolor: isUser ? "primary.main" : isSystem ? "warning.50" : "background.paper",
            color: isUser ? "primary.contrastText" : "text.primary",
            border: "1px solid",
            borderColor: isUser ? "primary.main" : "divider",
            boxShadow: isUser ? "0 16px 30px rgba(37,99,235,0.24)" : "0 16px 30px rgba(15,23,42,0.08)",
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
            {message.content}
          </Typography>

          {message.kbArticles && message.kbArticles.length > 0 && (
            <Stack spacing={1} sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 800, color: "text.secondary" }}>
                Knowledge Base Matches
              </Typography>
              {message.kbArticles.map((article) => (
                <Paper
                  key={article.id}
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    borderRadius: 3,
                    bgcolor: "grey.50",
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <MenuBookOutlinedIcon sx={{ fontSize: 16, color: "primary.main" }} />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {article.title}
                    </Typography>
                    {article.category ? <Chip size="small" label={article.category} /> : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                    {article.body}
                  </Typography>
                  <Button
                    size="small"
                    endIcon={<ArrowOutwardRoundedIcon />}
                    href={`/app/kb/${article.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open article
                  </Button>
                </Paper>
              ))}
            </Stack>
          )}

          {message.ticketReadiness && !message.ticketReadiness.ready && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 800, color: "text.secondary" }}>
                Still Needed For Ticket Creation
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
                {message.ticketReadiness.missingFields.map((field) => (
                  <Chip key={field} size="small" color="warning" variant="outlined" label={humanizeMissingField(field)} />
                ))}
              </Stack>
            </Box>
          )}

          <Typography
            variant="caption"
            sx={{
              display: "block",
              mt: 1,
              opacity: isUser ? 0.85 : 0.7,
            }}
          >
            {formatTimestamp(message.createdAt)}
          </Typography>
        </Paper>

        {isUser && (
          <Avatar
            sx={{
              width: 32,
              height: 32,
              bgcolor: "secondary.light",
              color: "secondary.dark",
            }}
          >
            <PersonRoundedIcon sx={{ fontSize: 18 }} />
          </Avatar>
        )}
      </Box>
    );
  };

  if (!isAuthenticated) return null;

  const sessionMenuOpen = Boolean(sessionMenuAnchorEl && sessionMenuTarget);
  const sessionMenuBusy =
    Boolean(sessionMenuTarget) &&
    (processingSessionId === sessionMenuTarget?.id ||
      deletingSessionId === sessionMenuTarget?.id ||
      renamingSessionId === sessionMenuTarget?.id);

  return (
    <>
      {!open && (
        <Tooltip title={roleCopy.title}>
          <IconButton
            onClick={() => setOpen(true)}
            sx={{
              position: "fixed",
              right: 24,
              bottom: 24,
              zIndex: 1400,
              width: 60,
              height: 60,
              bgcolor: "primary.main",
              color: "white",
              boxShadow: "0 24px 48px rgba(37,99,235,0.28)",
              "&:hover": { bgcolor: "primary.dark" },
            }}
          >
            <ChatIcon />
          </IconButton>
        </Tooltip>
      )}

      {open && (
        <>
          <Backdrop
            open={open}
            onClick={() => setOpen(false)}
            sx={{
              zIndex: 1390,
              background: "rgba(15, 23, 42, 0.28)",
              backdropFilter: "blur(10px)",
            }}
          />
          <Paper
            elevation={0}
            sx={{
              position: "fixed",
              inset: compactLayout ? 12 : "auto 24px 24px auto",
              width: compactLayout ? "auto" : 940,
              maxWidth: compactLayout ? "none" : "calc(100vw - 48px)",
              height: compactLayout ? "calc(100vh - 24px)" : 700,
              maxHeight: compactLayout ? "none" : "calc(100vh - 48px)",
              zIndex: 1400,
              display: "grid",
              gridTemplateColumns:
                !compactLayout && sidebarOpen ? "280px minmax(0,1fr)" : "minmax(0,1fr)",
              gridTemplateRows: "minmax(0,1fr)",
              overflow: "hidden",
              borderRadius: compactLayout ? 4 : 6,
              border: "1px solid",
              borderColor: "divider",
              boxShadow: "0 36px 110px rgba(15,23,42,0.22)",
              backgroundColor: "#fff",
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                position: compactLayout ? "absolute" : "relative",
                inset: compactLayout ? "0 auto 0 0" : "auto",
                width: compactLayout ? 286 : "auto",
                transform:
                  compactLayout && !sidebarOpen ? "translateX(-100%)" : "translateX(0)",
                transition: "transform 180ms ease",
                zIndex: compactLayout ? 2 : 1,
                borderRight: sidebarOpen ? "1px solid" : "none",
                borderColor: "divider",
                display: sidebarOpen ? "flex" : compactLayout ? "flex" : "none",
                flexDirection: "column",
                bgcolor: "grey.50",
                boxShadow: compactLayout ? "18px 0 40px rgba(15,23,42,0.16)" : "none",
                minHeight: 0,
              }}
            >
            <Box
              sx={{
                px: 2,
                py: 2,
                background:
                  "linear-gradient(180deg, rgba(37,99,235,0.08) 0%, rgba(255,255,255,0.96) 100%)",
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900, letterSpacing: -0.2 }}>
                    Conversations
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Private history for {audienceRole.toLowerCase()} access
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={sessions.length}
                  sx={{ fontWeight: 800, bgcolor: "rgba(37,99,235,0.08)", color: "primary.main" }}
                />
              </Stack>
              <Button
                fullWidth
                startIcon={<AddRoundedIcon />}
                variant="contained"
                onClick={() => void createFreshSession()}
                sx={{
                  py: 1.1,
                  borderRadius: 3,
                  boxShadow: "0 16px 28px rgba(37,99,235,0.18)",
                }}
              >
                New chat
              </Button>
            </Box>
            <Divider />
            <Box
              sx={{
                px: 2,
                py: 1.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
              }}
            >
              <Box>
                <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
                  ROLE
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  {audienceRole}
                </Typography>
              </Box>
              <Chip
                icon={<SupportAgentRoundedIcon sx={{ fontSize: 16 }} />}
                label={roleCopy.title}
                size="small"
                variant="outlined"
                sx={{
                  maxWidth: 160,
                  "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
                }}
              />
            </Box>
            <Divider />
            <Box sx={{ flex: 1, minHeight: 0, ...customScrollSx }}>
              {historyLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                  <CircularProgress size={22} />
                </Box>
              ) : sessions.length === 0 ? (
                <Box sx={{ px: 2, py: 3 }}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 3,
                      borderStyle: "dashed",
                      bgcolor: "rgba(255,255,255,0.82)",
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                      No conversation history yet
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Start a new chat and we’ll keep the thread here so you can jump back in anytime.
                    </Typography>
                  </Paper>
                </Box>
              ) : (
                <List disablePadding sx={{ px: 1.25, py: 1.25 }}>
                  {sessions.map((session) => (
                    <ListItemButton
                      key={session.id}
                      selected={session.id === sessionId}
                      onClick={() => void selectSession(session)}
                      sx={{
                        mb: 1,
                        px: 1.5,
                        py: 1.4,
                        alignItems: "flex-start",
                        border: "1px solid",
                        borderColor: session.id === sessionId ? "primary.main" : "rgba(148,163,184,0.18)",
                        borderRadius: 3,
                        backgroundColor: session.id === sessionId ? "rgba(37,99,235,0.08)" : "#fff",
                        boxShadow:
                          session.id === sessionId
                            ? "0 16px 28px rgba(37,99,235,0.12)"
                            : "0 6px 18px rgba(15,23,42,0.04)",
                        ".conversation-actions": {
                          opacity: session.id === sessionId ? 1 : 0.38,
                          transition: "opacity 160ms ease",
                        },
                        "&:hover": {
                          backgroundColor:
                            session.id === sessionId ? "rgba(37,99,235,0.1)" : "rgba(248,250,252,0.95)",
                          borderColor: session.id === sessionId ? "primary.main" : "rgba(37,99,235,0.28)",
                          ".conversation-actions": {
                            opacity: 1,
                          },
                        },
                      }}
                    >
                      <Stack spacing={1} sx={{ width: "100%" }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                            {session.isPinned ? (
                              <PushPinRoundedIcon sx={{ fontSize: 14, color: "primary.main" }} />
                            ) : null}
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 800,
                                lineHeight: 1.35,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {session.title || "New conversation"}
                            </Typography>
                          </Stack>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Chip
                              size="small"
                              label={session.id === sessionId ? "Open" : "Saved"}
                              color={session.id === sessionId ? "primary" : "default"}
                              variant={session.id === sessionId ? "filled" : "outlined"}
                              sx={{ height: 22, fontWeight: 700 }}
                            />
                            <Tooltip title="Conversation options">
                              <IconButton
                                size="small"
                                className="conversation-actions"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setSessionMenuAnchorEl(event.currentTarget);
                                  setSessionMenuTarget(session);
                                }}
                                disabled={processingSessionId === session.id}
                                sx={{
                                  width: 28,
                                  height: 28,
                                  border: "1px solid",
                                  borderColor:
                                    session.id === sessionId ? "rgba(37,99,235,0.22)" : "rgba(148,163,184,0.22)",
                                  bgcolor: session.id === sessionId ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.92)",
                                }}
                              >
                                <MoreHorizRoundedIcon sx={{ fontSize: 18 }} />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </Stack>

                        <Typography
                          variant="caption"
                          sx={{
                            color: "text.secondary",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            lineHeight: 1.45,
                          }}
                        >
                          {session.preview || "No preview yet"}
                        </Typography>

                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700 }}>
                            {formatRelativeTime(session.lastActivityAt)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "text.disabled" }}>
                            {formatTimestamp(session.lastActivityAt)}
                          </Typography>
                        </Stack>
                      </Stack>
                    </ListItemButton>
                  ))}
                </List>
              )}
            </Box>
            </Box>

            <Menu
              anchorEl={sessionMenuAnchorEl}
              open={sessionMenuOpen}
              onClose={closeSessionMenu}
              sx={{ zIndex: 1605 }}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
              PaperProps={{
                elevation: 0,
                sx: {
                  mt: 0.75,
                  minWidth: 220,
                  borderRadius: 3,
                  border: "1px solid",
                  borderColor: "divider",
                  boxShadow: "0 22px 44px rgba(15,23,42,0.16)",
                  overflow: "hidden",
                },
              }}
            >
              <MenuItem
                disabled={sessionMenuBusy}
                onClick={() => {
                  if (sessionMenuTarget) {
                    setRenameTarget(sessionMenuTarget);
                    setRenameValue(sessionMenuTarget.title || "");
                  }
                  closeSessionMenu();
                }}
                sx={{ py: 1.25, gap: 1.25, fontWeight: 600 }}
              >
                <EditOutlinedIcon sx={{ fontSize: 18 }} />
                Rename
              </MenuItem>
              <Divider />
              <MenuItem
                disabled={sessionMenuBusy}
                onClick={() => {
                  if (sessionMenuTarget) {
                    void togglePinConversation(sessionMenuTarget);
                  } else {
                    closeSessionMenu();
                  }
                }}
                sx={{ py: 1.25, gap: 1.25, fontWeight: 600 }}
              >
                <PushPinOutlinedIcon sx={{ fontSize: 18 }} />
                {sessionMenuTarget?.isPinned ? "Unpin chat" : "Pin chat"}
              </MenuItem>
              <MenuItem
                disabled={sessionMenuBusy}
                onClick={() => {
                  if (sessionMenuTarget) {
                    void archiveConversation(sessionMenuTarget);
                  } else {
                    closeSessionMenu();
                  }
                }}
                sx={{ py: 1.25, gap: 1.25, fontWeight: 600 }}
              >
                <ArchiveOutlinedIcon sx={{ fontSize: 18 }} />
                Archive
              </MenuItem>
              <Divider />
              <MenuItem
                disabled={sessionMenuBusy}
                onClick={() => {
                  if (sessionMenuTarget) {
                    setDeleteTarget(sessionMenuTarget);
                  }
                  closeSessionMenu();
                }}
                sx={{
                  py: 1.25,
                  gap: 1.25,
                  color: "error.main",
                  fontWeight: 700,
                }}
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                Delete conversation
              </MenuItem>
            </Menu>

            {compactLayout && sidebarOpen ? (
              <Box
                onClick={() => setSidebarOpen(false)}
                sx={{
                  position: "absolute",
                  inset: 0,
                  left: 286,
                  width: "calc(100vw - 286px)",
                  background: "rgba(15,23,42,0.18)",
                }}
              />
            ) : null}

            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                minWidth: 0,
                minHeight: 0,
                backgroundColor: "#fff",
              }}
            >
            <Box
              sx={{
                px: 2.25,
                py: 1.75,
                borderBottom: "1px solid",
                borderColor: "divider",
                backgroundColor: "#fff",
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                  <Avatar sx={{ bgcolor: "primary.main", width: 42, height: 42 }}>
                    <SmartToyOutlinedIcon />
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.15 }} noWrap>
                      {roleCopy.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {roleCopy.subtitle}
                    </Typography>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={1} alignItems="center">
                  <Tooltip title={sidebarOpen ? "Hide history" : "Show history"}>
                    <IconButton onClick={() => setSidebarOpen((prev) => !prev)}>
                      {compactLayout ? <MenuRoundedIcon /> : <HistoryRoundedIcon />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Close chat">
                    <IconButton onClick={() => setOpen(false)}>
                      <CloseIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Stack>
            </Box>

            {error ? (
              <Alert severity="error" sx={{ borderRadius: 0 }}>
                {error}
              </Alert>
            ) : null}

            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                px: { xs: 1.5, sm: 2.25 },
                py: 2,
                backgroundColor: "#f8fafc",
                ...customScrollSx,
              }}
            >
              {messages.length === 0 && !hydrating && (
                <Box
                  sx={{
                    borderRadius: 5,
                    border: "1px dashed",
                    borderColor: "divider",
                    p: 3,
                    backgroundColor: "#fff",
                  }}
                >
                  <Stack spacing={2}>
                    <Box>
                      <Typography variant="h5" sx={{ fontWeight: 900, mb: 0.75 }}>
                        Welcome back
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        We’ll keep your chat history here, suggest KB articles, and create a cleaner ticket only when the intake is complete.
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      {PROMPTS_BY_ROLE[audienceRole].map((prompt) => (
                        <Chip
                          key={prompt}
                          label={prompt}
                          onClick={() => setInput(prompt)}
                          variant="outlined"
                          sx={{ borderRadius: 99, fontWeight: 600 }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                </Box>
              )}

              {hydrating ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : (
                <Stack spacing={1.75}>
                  {messages.map(renderMessageBubble)}
                  {loading && (
                    <Box sx={{ display: "flex", gap: 1.25, alignItems: "flex-start" }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: "primary.light", color: "primary.dark" }}>
                        <AutoAwesomeOutlinedIcon sx={{ fontSize: 18 }} />
                      </Avatar>
                      <Paper
                        sx={{
                          px: 1.5,
                          py: 1.25,
                          borderRadius: 4,
                          border: "1px solid",
                          borderColor: "divider",
                        }}
                      >
                        <Stack direction="row" spacing={1} alignItems="center">
                          <CircularProgress size={16} />
                          <Typography variant="body2" color="text.secondary">
                            Thinking through that...
                          </Typography>
                        </Stack>
                      </Paper>
                    </Box>
                  )}
                  <div ref={messagesEndRef} />
                </Stack>
              )}
            </Box>

            <Divider />

            <Box sx={{ px: { xs: 1.5, sm: 2.25 }, py: 1.5, bgcolor: "background.paper" }}>
              {ticketCreated ? (
                <Alert
                  icon={<ConfirmationNumberOutlinedIcon fontSize="inherit" />}
                  severity="success"
                  sx={{ mb: 1.5 }}
                >
                  Ticket <strong>{ticketCreated.id.slice(0, 8).toUpperCase()}</strong> created successfully from this conversation.
                </Alert>
              ) : null}

              {pendingReadiness ? (
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    mb: 1.5,
                    borderRadius: 4,
                    bgcolor: pendingReadiness.ready ? "success.50" : "warning.50",
                  }}
                >
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.25}
                    alignItems={{ xs: "stretch", sm: "flex-start" }}
                    justifyContent="space-between"
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
                        {pendingReadiness.ready ? "Ticket intake is ready" : "Need a little more detail"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {pendingReadiness.guidance}
                      </Typography>
                      {!pendingReadiness.ready && pendingReadiness.missingFields.length > 0 ? (
                        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                          {pendingReadiness.missingFields.map((field) => (
                            <Chip key={field} size="small" label={humanizeMissingField(field)} variant="outlined" />
                          ))}
                        </Stack>
                      ) : null}
                    </Box>

                    {pendingReadiness.ready ? (
                      <Button
                        variant="contained"
                        startIcon={<ConfirmationNumberOutlinedIcon />}
                        onClick={() => void createTicket()}
                        disabled={creatingTicket}
                        sx={{ alignSelf: { xs: "stretch", sm: "auto" } }}
                      >
                        {creatingTicket ? "Creating..." : "Create Ticket"}
                      </Button>
                    ) : null}
                  </Stack>
                </Paper>
              ) : null}

              <Stack direction="row" spacing={1} alignItems="flex-end">
                <TextField
                  fullWidth
                  multiline
                  maxRows={4}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe the issue, ask for help, or search for a KB answer..."
                  disabled={loading || hydrating}
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      borderRadius: 3,
                      backgroundColor: "grey.50",
                    },
                  }}
                />
                <IconButton
                  color="primary"
                  onClick={() => void sendMessage()}
                  disabled={!input.trim() || loading || hydrating}
                  sx={{
                    width: 48,
                    height: 48,
                    borderRadius: 3,
                    bgcolor: "primary.main",
                    color: "white",
                    "&:hover": { bgcolor: "primary.dark" },
                    "&.Mui-disabled": { bgcolor: "action.disabledBackground", color: "action.disabled" },
                  }}
                >
                  <SendIcon />
                </IconButton>
              </Stack>
            </Box>
          </Box>
          </Paper>

          <Dialog
            open={Boolean(deleteTarget)}
            onClose={() => (deletingSessionId ? null : setDeleteTarget(null))}
            sx={{ zIndex: 1606 }}
            PaperProps={{
              sx: {
                borderRadius: 4,
                width: 420,
                maxWidth: "calc(100vw - 32px)",
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900 }}>Delete conversation?</DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                This will permanently remove{" "}
                <Box component="span" sx={{ fontWeight: 800, color: "text.primary" }}>
                  {deleteTarget?.title || "this conversation"}
                </Box>{" "}
                and its messages from your private chat history.
              </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.25 }}>
              <Button onClick={() => setDeleteTarget(null)} disabled={Boolean(deletingSessionId)}>
                Cancel
              </Button>
              <Button
                color="error"
                variant="contained"
                startIcon={<DeleteOutlineRoundedIcon />}
                disabled={!deleteTarget || Boolean(deletingSessionId)}
                onClick={() => {
                  if (deleteTarget) {
                    void deleteConversation(deleteTarget);
                  }
                }}
                sx={{
                  boxShadow: "none",
                }}
              >
                {deletingSessionId ? "Deleting..." : "Delete conversation"}
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={Boolean(renameTarget)}
            onClose={() => (renamingSessionId ? null : setRenameTarget(null))}
            sx={{ zIndex: 1606 }}
            PaperProps={{
              sx: {
                borderRadius: 4,
                width: 420,
                maxWidth: "calc(100vw - 32px)",
              },
            }}
          >
            <DialogTitle sx={{ fontWeight: 900 }}>Rename conversation</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                fullWidth
                label="Conversation name"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void renameConversation();
                  }
                }}
                disabled={Boolean(renamingSessionId)}
                sx={{ mt: 0.5 }}
              />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.25 }}>
              <Button onClick={() => setRenameTarget(null)} disabled={Boolean(renamingSessionId)}>
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={!renameValue.trim() || Boolean(renamingSessionId)}
                onClick={() => void renameConversation()}
              >
                {renamingSessionId ? "Saving..." : "Save name"}
              </Button>
            </DialogActions>
          </Dialog>

          <Snackbar
            open={Boolean(actionNotice)}
            autoHideDuration={2200}
            onClose={() => setActionNotice("")}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          >
            <Alert
              onClose={() => setActionNotice("")}
              severity="success"
              variant="filled"
              sx={{ width: "100%" }}
            >
              {actionNotice}
            </Alert>
          </Snackbar>
        </>
      )}
    </>
  );
};
