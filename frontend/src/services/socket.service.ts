import { io, Socket } from "socket.io-client";

// Socket.io client instance
let socket: Socket | null = null;

// Event handlers registry
const eventHandlers: Map<string, Set<(data: any) => void>> = new Map();

const roomSubscriptions = {
  schedule: 0,
  metrics: new Map<string, number>(),
  workflows: new Map<string, number>(),
  audits: new Map<string, number>(),
  boards: new Map<string, number>(),
};

const incrementRoomCount = (map: Map<string, number>, key: string): number => {
  const next = (map.get(key) || 0) + 1;
  map.set(key, next);
  return next;
};

const decrementRoomCount = (map: Map<string, number>, key: string): number => {
  const current = map.get(key) || 0;
  const next = Math.max(0, current - 1);
  if (next === 0) {
    map.delete(key);
  } else {
    map.set(key, next);
  }
  return next;
};

const replayRoomSubscriptions = () => {
  if (!socket?.connected) return;

  if (roomSubscriptions.schedule > 0) {
    socket.emit("schedule:subscribe");
  }

  roomSubscriptions.metrics.forEach((count, dashboardId) => {
    if (count > 0) {
      socket?.emit("metrics:subscribe", { dashboardId });
    }
  });

  roomSubscriptions.workflows.forEach((count, executionId) => {
    if (count > 0) {
      socket?.emit("workflow:subscribe", { executionId });
    }
  });

  roomSubscriptions.audits.forEach((count, key) => {
    if (count > 0) {
      const [entityType, entityId] = key.split("::");
      socket?.emit("audit:subscribe", { entityType, entityId });
    }
  });

  roomSubscriptions.boards.forEach((count, boardId) => {
    if (count > 0) {
      socket?.emit("board:subscribe", { boardId });
    }
  });
};

/**
 * Initialize Socket.io connection
 */
export function initializeSocket(): Socket {
  if (socket?.connected) {
    return socket;
  }

  const rawApiUrl = import.meta.env.VITE_API_URL || "/api/v1";
  const API_URL =
    rawApiUrl.startsWith("http://") || rawApiUrl.startsWith("https://")
      ? new URL(rawApiUrl).origin
      : window.location.origin;

  socket = io(API_URL, {
    path: "/socket.io",
    withCredentials: true,
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on("connect", () => {
    console.log("Socket connected:", socket?.id);
    replayRoomSubscriptions();
  });

  socket.on("disconnect", (reason: string) => {
    console.log("Socket disconnected:", reason);
  });

  socket.on("connect_error", (error: Error) => {
    console.error("Socket connection error:", error);
  });

  // Global event handler for broadcasting to registered listeners
  socket.onAny((eventName: string, data: unknown) => {
    const handlers = eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach((handler: (data: unknown) => void) => {
        try {
          handler(data);
        } catch (err: unknown) {
          console.error(`Error in event handler for ${eventName}:`, err);
        }
      });
    }
  });

  return socket;
}

/**
 * Get or create socket instance
 */
export function getSocket(): Socket | null {
  if (!socket) {
    return initializeSocket();
  }
  return socket;
}

/**
 * Subscribe to a socket event
 */
export function subscribeToEvent(eventName: string, handler: (data: any) => void): () => void {
  if (!eventHandlers.has(eventName)) {
    eventHandlers.set(eventName, new Set());
  }

  eventHandlers.get(eventName)!.add(handler);

  // Return unsubscribe function
  return () => {
    const handlers = eventHandlers.get(eventName);
    if (handlers) {
      handlers.delete(handler);
    }
  };
}

/**
 * Unsubscribe from a socket event
 */
export function unsubscribeFromEvent(eventName: string, handler: (data: any) => void): void {
  const handlers = eventHandlers.get(eventName);
  if (handlers) {
    handlers.delete(handler);
  }
}

/**
 * Emit an event to the server
 */
export function emitEvent(eventName: string, data?: any): void {
  const s = getSocket();
  if (s) {
    s.emit(eventName, data);
  }
}

// ==================== TICKET PRESENCE ====================

/**
 * Join a ticket room for real-time presence
 */
export function joinTicket(ticketId: string): void {
  emitEvent("ticket:join", { ticketId });
}

/**
 * Leave a ticket room
 */
export function leaveTicket(ticketId: string): void {
  emitEvent("ticket:leave", { ticketId });
}

/**
 * Subscribe to user joined event
 */
export function onUserJoined(handler: (data: { userId: string; name: string; role: string }) => void): () => void {
  return subscribeToEvent("ticket:user-joined", handler);
}

/**
 * Subscribe to user left event
 */
export function onUserLeft(handler: (data: { userId: string; name: string }) => void): () => void {
  return subscribeToEvent("ticket:user-left", handler);
}

/**
 * Subscribe to active users updates
 */
export function onActiveUsersUpdate(
  handler: (users: Array<{ userId: string; name: string; role: string; status: string }>) => void
): () => void {
  return subscribeToEvent("ticket:active-users", handler);
}

/**
 * Subscribe to field locked event
 */
export function onFieldLocked(handler: (data: { fieldName: string; userId: string; userName: string }) => void): () => void {
  return subscribeToEvent("field:locked", handler);
}

/**
 * Subscribe to field unlocked event
 */
export function onFieldUnlocked(handler: (data: { fieldName: string }) => void): () => void {
  return subscribeToEvent("field:unlocked", handler);
}

/**
 * Lock a field for editing
 */
export function lockField(ticketId: string, fieldName: string): void {
  emitEvent("field:focus", { ticketId, fieldName });
}

/**
 * Unlock a field
 */
export function unlockField(ticketId: string, fieldName: string): void {
  emitEvent("field:blur", { ticketId, fieldName });
}

/**
 * Send typing indicator
 */
export function sendTypingStart(ticketId: string, fieldName: string): void {
  emitEvent("typing:start", { ticketId, fieldName });
}

/**
 * Send typing stop
 */
export function sendTypingStop(ticketId: string, fieldName: string): void {
  emitEvent("typing:stop", { ticketId, fieldName });
}

// ==================== WORKFLOW EXECUTION ====================

/**
 * Subscribe to workflow execution updates
 */
export function subscribeToWorkflow(executionId: string, handler: (data: any) => void): () => void {
  const s = getSocket();
  const subscriptionCount = incrementRoomCount(roomSubscriptions.workflows, executionId);
  if (s && subscriptionCount === 1) {
    s.emit("workflow:subscribe", { executionId });
  }

  const unsubscribe = subscribeToEvent(`workflow:${executionId}`, handler);

  return () => {
    unsubscribe();
    const s = getSocket();
    const remainingCount = decrementRoomCount(roomSubscriptions.workflows, executionId);
    if (s && remainingCount === 0) {
      s.emit("workflow:unsubscribe", { executionId });
    }
  };
}

/**
 * Subscribe to general workflow updates
 */
export function onWorkflowUpdate(handler: (data: any) => void): () => void {
  return subscribeToEvent("workflow:update", handler);
}

// ==================== AUDIT LOGS ====================

/**
 * Subscribe to audit log updates for an entity
 */
export function subscribeToAudit(
  entityType: string,
  entityId: string,
  handler: (log: any) => void
): () => void {
  const s = getSocket();
  const auditKey = `${entityType}::${entityId}`;
  const subscriptionCount = incrementRoomCount(roomSubscriptions.audits, auditKey);
  if (s && subscriptionCount === 1) {
    s.emit("audit:subscribe", { entityType, entityId });
  }

  const unsubscribe = subscribeToEvent(`audit:${entityType}:${entityId}`, handler);

  return () => {
    unsubscribe();
    const s = getSocket();
    const remainingCount = decrementRoomCount(roomSubscriptions.audits, auditKey);
    if (s && remainingCount === 0) {
      s.emit("audit:unsubscribe", { entityType, entityId });
    }
  };
}

/**
 * Subscribe to new audit log events
 */
export function onNewAuditLog(handler: (log: any) => void): () => void {
  return subscribeToEvent("audit:new", handler);
}

// ==================== METRICS STREAM ====================

/**
 * Subscribe to metrics updates
 */
export function subscribeToMetrics(dashboardId: string, handler: (metrics: any) => void): () => void {
  const s = getSocket();
  const subscriptionCount = incrementRoomCount(roomSubscriptions.metrics, dashboardId);
  if (s && subscriptionCount === 1) {
    s.emit("metrics:subscribe", { dashboardId });
  }

  const unsubscribe = subscribeToEvent("metrics:update", handler);

  return () => {
    unsubscribe();
    const s = getSocket();
    const remainingCount = decrementRoomCount(roomSubscriptions.metrics, dashboardId);
    if (s && remainingCount === 0) {
      s.emit("metrics:unsubscribe", { dashboardId });
    }
  };
}

/**
 * Subscribe to general metrics updates
 */
export function onMetricsUpdate(handler: (metrics: any) => void): () => void {
  return subscribeToEvent("metrics:update", handler);
}

// ==================== SCHEDULE STREAM ====================

export function subscribeToScheduleUpdates(handler: (payload: any) => void): () => void {
  const s = getSocket();
  roomSubscriptions.schedule += 1;
  if (s && roomSubscriptions.schedule === 1) {
    s.emit("schedule:subscribe");
  }

  const unsubscribe = subscribeToEvent("schedule:update", handler);

  return () => {
    unsubscribe();
    const current = getSocket();
    roomSubscriptions.schedule = Math.max(0, roomSubscriptions.schedule - 1);
    if (current && roomSubscriptions.schedule === 0) {
      current.emit("schedule:unsubscribe");
    }
  };
}

// ==================== BOARD STREAM ====================

export function subscribeToBoard(boardId: string, handler: (payload: any) => void): () => void {
  const s = getSocket();
  const subscriptionCount = incrementRoomCount(roomSubscriptions.boards, boardId);
  if (s && subscriptionCount === 1) {
    s.emit("board:subscribe", { boardId });
  }

  const unsubs = [
    subscribeToEvent("board:board-updated", handler),
    subscribeToEvent("board:card-created", handler),
    subscribeToEvent("board:card-updated", handler),
    subscribeToEvent("board:card-moved", handler),
    subscribeToEvent("board:card-deleted", handler),
    subscribeToEvent("board:comment-added", handler),
    subscribeToEvent("board:attachment-added", handler),
  ];

  return () => {
    unsubs.forEach((unsubscribe) => unsubscribe());
    const current = getSocket();
    const remainingCount = decrementRoomCount(roomSubscriptions.boards, boardId);
    if (current && remainingCount === 0) {
      current.emit("board:unsubscribe", { boardId });
    }
  };
}

// ==================== USER PRESENCE ====================

/**
 * Subscribe to user online status
 */
export function onUserOnline(handler: (user: { userId: string; name: string; role: string }) => void): () => void {
  return subscribeToEvent("user:online", handler);
}

/**
 * Subscribe to user offline status
 */
export function onUserOffline(handler: (data: { userId: string }) => void): () => void {
  return subscribeToEvent("user:offline", handler);
}

export function onNotificationNew(
  handler: (notification: {
    id: string;
    ticket_id: string | null;
    type: string;
    title: string;
    body: string;
    action_url: string | null;
    read_at: string | null;
    created_at: string;
  }) => void
): () => void {
  return subscribeToEvent("notification:new", handler);
}

/**
 * Get list of online users
 */
export function getOnlineUsers(handler: (users: Array<{ userId: string; name: string; role: string }>) => void): () => void {
  return subscribeToEvent("users:online", handler);
}

// ==================== SOCKET HEALTH ====================

/**
 * Check if socket is connected
 */
export function isSocketConnected(): boolean {
  return socket?.connected || false;
}

/**
 * Disconnect socket
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Reconnect socket
 */
export function reconnectSocket(): void {
  disconnectSocket();
  initializeSocket();
}

// Auto-initialize on import
initializeSocket();
