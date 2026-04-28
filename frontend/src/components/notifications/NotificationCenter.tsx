import React from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import {
  AssignmentTurnedIn as ApprovalIcon,
  Campaign as BroadcastIcon,
  ChatBubbleOutline as CommentIcon,
  Close as CloseIcon,
  Notifications as NotificationsIcon,
  PriorityHigh as PriorityIcon,
  SyncAlt as StatusIcon,
  EventBusy as TimeOffIcon,
  TaskAlt as CreatedIcon,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "../../services/api";
import { onNotificationNew } from "../../services/socket.service";

type NotificationRow = {
  id: string;
  ticket_id: string | null;
  actor_user_id: string | null;
  audience_role: "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN" | null;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

const iconForType = (type: string) => {
  switch (type) {
    case "APPROVAL_REQUESTED":
      return <ApprovalIcon fontSize="small" />;
    case "TICKET_COMMENTED":
      return <CommentIcon fontSize="small" />;
    case "TICKET_SLA_RISK":
    case "SLA_FIRST_RESPONSE_BREACH":
    case "SLA_RESOLUTION_BREACH":
      return <PriorityIcon fontSize="small" />;
    case "TICKET_STATUS_CHANGED":
      return <StatusIcon fontSize="small" />;
    case "TIME_OFF_REQUESTED":
    case "TIME_OFF_APPROVED":
    case "TIME_OFF_DENIED":
      return <TimeOffIcon fontSize="small" />;
    case "TICKET_CREATED":
      return <CreatedIcon fontSize="small" />;
    default:
      return <BroadcastIcon fontSize="small" />;
  }
};

const colorForType = (type: string) => {
  switch (type) {
    case "APPROVAL_REQUESTED":
      return { bg: "#dbeafe", fg: "#1d4ed8" };
    case "TICKET_SLA_RISK":
    case "SLA_FIRST_RESPONSE_BREACH":
    case "SLA_RESOLUTION_BREACH":
      return { bg: "#fee2e2", fg: "#dc2626" };
    case "TICKET_COMMENTED":
      return { bg: "#ede9fe", fg: "#7c3aed" };
    case "TICKET_STATUS_CHANGED":
      return { bg: "#dcfce7", fg: "#166534" };
    case "TIME_OFF_REQUESTED":
      return { bg: "#dbeafe", fg: "#1d4ed8" };
    case "TIME_OFF_APPROVED":
      return { bg: "#dcfce7", fg: "#166534" };
    case "TIME_OFF_DENIED":
      return { bg: "#fee2e2", fg: "#dc2626" };
    default:
      return { bg: "#e2e8f0", fg: "#334155" };
  }
};

const formatWhen = (value: string) => {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(1, Math.round(diffMs / 60000));
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)} hr ago`;
  return date.toLocaleDateString();
};

export const NotificationCenter: React.FC = () => {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [items, setItems] = React.useState<NotificationRow[]>([]);

  const open = Boolean(anchorEl);

  const fetchUnreadCount = React.useCallback(async () => {
    try {
      const res = await api.get<{ count: number }>("/notifications/unread-count");
      setUnreadCount(Number(res.data?.count ?? 0));
    } catch {
      return;
    }
  }, []);

  const fetchNotifications = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get<NotificationRow[]>("/notifications", { params: { limit: 12 } });
      setItems(res.data || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to load notifications"));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchUnreadCount();
    const intervalId = window.setInterval(() => {
      if (!document.hidden) {
        void fetchUnreadCount();
      }
    }, 30000);

    const unsubscribe = onNotificationNew((notification) => {
      setUnreadCount((current) => current + (notification.read_at ? 0 : 1));
      setItems((current) => [notification as NotificationRow, ...current.filter((item) => item.id !== notification.id)].slice(0, 12));
    });

    return () => {
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [fetchUnreadCount]);

  React.useEffect(() => {
    if (!open) return;
    void fetchUnreadCount();
    void fetchNotifications();
  }, [open, fetchNotifications, fetchUnreadCount]);

  const openMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const closeMenu = () => setAnchorEl(null);

  const markAsRead = async (id: string) => {
    try {
      const res = await api.post<NotificationRow>(`/notifications/${id}/read`);
      const updated = res.data;
      setItems((current) => current.map((item) => (item.id === id ? updated : item)));
      setUnreadCount((current) => Math.max(0, current - 1));
    } catch {
      return;
    }
  };

  const onClickItem = async (item: NotificationRow) => {
    if (!item.read_at) {
      await markAsRead(item.id);
    }
    closeMenu();
    if (item.action_url) {
      navigate(item.action_url);
      return;
    }
    if (item.ticket_id) {
      navigate(item.audience_role === "EMPLOYEE" ? `/app/tickets/${item.ticket_id}` : `/admin/tickets/${item.ticket_id}`);
    }
  };

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read-all");
      setItems((current) =>
        current.map((item) => ({
          ...item,
          read_at: item.read_at ?? new Date().toISOString(),
        }))
      );
      setUnreadCount(0);
    } catch {
      return;
    }
  };

  const clearAll = async () => {
    try {
      await api.delete("/notifications/clear");
      setItems([]);
      setUnreadCount(0);
    } catch {
      return;
    }
  };

  const deleteOne = async (id: string) => {
    try {
      await api.delete(`/notifications/${id}`);
      let removedUnread = false;
      setItems((current) => {
        const removed = current.find((item) => item.id === id);
        removedUnread = Boolean(removed && !removed.read_at);
        return current.filter((item) => item.id !== id);
      });
      if (removedUnread) {
        setUnreadCount((current) => Math.max(0, current - 1));
      }
    } catch {
      return;
    }
  };

  return (
    <>
      <IconButton
        onClick={openMenu}
        sx={{
          ml: 1,
          bgcolor: "rgba(0,0,0,0.04)",
          color: "text.secondary",
          borderRadius: 999,
          "&:hover": { bgcolor: "rgba(0,0,0,0.08)" },
        }}
      >
        <Badge badgeContent={unreadCount} color="error">
          <NotificationsIcon />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{ sx: { width: 440, maxWidth: "92vw", borderRadius: 3 } }}
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            Notifications
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Personal, team, and role-based updates relevant to your work.
          </Typography>
        </Box>
        <Divider />

        {loading && (
          <MenuItem disabled sx={{ justifyContent: "center", py: 2 }}>
            <CircularProgress size={18} />
          </MenuItem>
        )}
        {error && !loading && <MenuItem disabled>{error}</MenuItem>}
        {!loading && !error && items.length === 0 && <MenuItem disabled>No notifications</MenuItem>}

        <Box sx={{ maxHeight: 460, overflowY: "auto" }}>
          {items.map((item) => {
            const palette = colorForType(item.type);
            return (
              <MenuItem
                key={item.id}
                onClick={() => void onClickItem(item)}
                sx={{ alignItems: "flex-start", gap: 1.25, px: 2, py: 1.4 }}
              >
                <Avatar sx={{ width: 36, height: 36, bgcolor: palette.bg, color: palette.fg, mt: 0.25 }}>
                  {iconForType(item.type)}
                </Avatar>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.35 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: item.read_at ? 700 : 800 }} noWrap>
                      {item.title}
                    </Typography>
                    {!item.read_at ? <Badge variant="dot" color="error" /> : null}
                  </Box>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      lineHeight: 1.35,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.body}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: "block" }}>
                    {formatWhen(item.created_at)}
                  </Typography>
                </Box>

                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteOne(item.id);
                  }}
                  sx={{ mt: 0.25, opacity: 0.55, "&:hover": { opacity: 1, bgcolor: "action.hover" } }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </MenuItem>
            );
          })}
        </Box>

        <Divider />
        <Box sx={{ px: 2, py: 1, display: "flex", gap: 1 }}>
          <Button size="small" variant="text" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
            Mark all as read
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="text" color="error" onClick={() => void clearAll()} disabled={items.length === 0}>
            Clear all
          </Button>
        </Box>
      </Menu>
    </>
  );
};
