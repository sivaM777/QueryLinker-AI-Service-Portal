import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { pool } from "../config/db.js";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { allowedOrigins } from "../config/http.js";

// Socket.io server instance
let io: SocketIOServer | null = null;

// Connected users map: socketId -> user info
const connectedUsers = new Map<string, {
  userId: string;
  email: string;
  name: string;
  role: string;
  organizationId?: string | null;
  currentTicketId?: string;
  currentPage?: string;
}>();

async function setAvailabilityOnlineIfOffline(userId: string) {
  try {
    await pool.query(
      "UPDATE users SET availability_status = 'ONLINE', updated_at = now() WHERE id = $1 AND (availability_status IS NULL OR availability_status = 'OFFLINE')",
      [userId]
    );
  } catch (error) {
    console.error("Failed to set availability online:", error);
  }
}

async function setAvailabilityOffline(userId: string) {
  try {
    await pool.query("UPDATE users SET availability_status = 'OFFLINE', updated_at = now() WHERE id = $1", [userId]);
  } catch (error) {
    console.error("Failed to set availability offline:", error);
  }
}

// Ticket presence: ticketId -> Set of userIds
const ticketPresence = new Map<string, Set<string>>();

// Field locks: ticketId:fieldName -> { userId, socketId, lockedAt }
const fieldLocks = new Map<string, {
  userId: string;
  socketId: string;
  lockedAt: Date;
  fieldName: string;
}>();

export function initializeSocketServer(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
    path: "/socket.io",
  });

  io.use(async (socket: Socket, next) => {
    try {
      const cookies = socket.handshake.headers.cookie || "";
      if (!cookies) return next(new Error("Authentication required"));

      const parsed = parseCookie(cookies);
      const token = parsed["access_token"];
      if (!token) return next(new Error("Authentication required"));

      let payload: any;
      try {
        payload = jwt.verify(token, env.JWT_SECRET || "supersecret");
      } catch {
        return next(new Error("Invalid session"));
      }

      const result = await pool.query(
        `SELECT u.id, u.email, u.name, u.role, u.organization_id
         FROM users u
         WHERE u.id = $1`,
        [payload?.id]
      );

      if (result.rows.length === 0) {
        return next(new Error("Invalid session"));
      }

      const user = result.rows[0];
      socket.data.user = user;
      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user;
    console.log(`User connected: ${user.email} (${socket.id})`);
    socket.join(`user:${user.id}`);

    // Store connected user
    connectedUsers.set(socket.id, {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organization_id ?? null,
    });

    // Update availability if currently offline
    void setAvailabilityOnlineIfOffline(user.id);

    // Broadcast user online status
    socket.broadcast.emit("user:online", {
      userId: user.id,
      name: user.name,
      role: user.role,
    });

    // Send current online users to the new connection
    const onlineUsers = Array.from(connectedUsers.values()).map(u => ({
      userId: u.userId,
      name: u.name,
      role: u.role,
    }));
    socket.emit("users:online", onlineUsers);

    // === TICKET PRESENCE & COLLISION DETECTION ===
    
    socket.on("ticket:join", async ({ ticketId }: { ticketId: string }) => {
      const userInfo = connectedUsers.get(socket.id);
      if (!userInfo) return;

      // Leave previous ticket room
      if (userInfo.currentTicketId) {
        socket.leave(`ticket:${userInfo.currentTicketId}`);
        const prevPresence = ticketPresence.get(userInfo.currentTicketId);
        if (prevPresence) {
          prevPresence.delete(userInfo.userId);
          // Release all field locks for this user
          releaseUserFieldLocks(userInfo.currentTicketId, socket.id);
        }
      }

      // Join new ticket room
      socket.join(`ticket:${ticketId}`);
      userInfo.currentTicketId = ticketId;

      // Add to ticket presence
      if (!ticketPresence.has(ticketId)) {
        ticketPresence.set(ticketId, new Set());
      }
      ticketPresence.get(ticketId)!.add(userInfo.userId);

      // Update database
      await updateUserPresence(userInfo.userId, ticketId, "viewing", socket.id);

      // Notify others in the ticket
      socket.to(`ticket:${ticketId}`).emit("ticket:user-joined", {
        userId: userInfo.userId,
        name: userInfo.name,
        role: userInfo.role,
        timestamp: new Date().toISOString(),
      });

      // Send current active users to the joining user
      const activeUsers = await getTicketActiveUsers(ticketId);
      socket.emit("ticket:active-users", activeUsers);

      // Send current field locks
      const locks = getTicketFieldLocks(ticketId);
      socket.emit("ticket:field-locks", locks);
    });

    socket.on("ticket:leave", async ({ ticketId }: { ticketId: string }) => {
      const userInfo = connectedUsers.get(socket.id);
      if (!userInfo) return;

      socket.leave(`ticket:${ticketId}`);
      
      const presence = ticketPresence.get(ticketId);
      if (presence) {
        presence.delete(userInfo.userId);
      }

      // Release all field locks
      releaseUserFieldLocks(ticketId, socket.id);

      // Update database
      await clearUserPresence(userInfo.userId);

      // Notify others
      socket.to(`ticket:${ticketId}`).emit("ticket:user-left", {
        userId: userInfo.userId,
        name: userInfo.name,
        timestamp: new Date().toISOString(),
      });

      userInfo.currentTicketId = undefined;
    });

    // Field focus/lock
    socket.on("field:focus", async ({ ticketId, fieldName }: { ticketId: string; fieldName: string }) => {
      const userInfo = connectedUsers.get(socket.id);
      if (!userInfo) return;

      const lockKey = `${ticketId}:${fieldName}`;
      const existingLock = fieldLocks.get(lockKey);

      if (existingLock && existingLock.socketId !== socket.id) {
        // Field is locked by someone else
        socket.emit("field:lock-failed", {
          fieldName,
          lockedBy: existingLock.userId,
          message: "Field is currently being edited by another user",
        });
        return;
      }

      // Lock the field
      fieldLocks.set(lockKey, {
        userId: userInfo.userId,
        socketId: socket.id,
        lockedAt: new Date(),
        fieldName,
      });

      // Update database
      await lockField(ticketId, fieldName, userInfo.userId);

      // Notify others
      socket.to(`ticket:${ticketId}`).emit("field:locked", {
        fieldName,
        userId: userInfo.userId,
        userName: userInfo.name,
      });

      socket.emit("field:lock-success", { fieldName });
    });

    socket.on("field:blur", async ({ ticketId, fieldName }: { ticketId: string; fieldName: string }) => {
      const lockKey = `${ticketId}:${fieldName}`;
      const existingLock = fieldLocks.get(lockKey);

      if (existingLock && existingLock.socketId === socket.id) {
        fieldLocks.delete(lockKey);
        
        // Update database
        await unlockField(ticketId, fieldName);

        // Notify others
        socket.to(`ticket:${ticketId}`).emit("field:unlocked", {
          fieldName,
        });
      }
    });

    // Typing indicator
    socket.on("typing:start", ({ ticketId, fieldName }: { ticketId: string; fieldName: string }) => {
      const userInfo = connectedUsers.get(socket.id);
      if (!userInfo) return;

      socket.to(`ticket:${ticketId}`).emit("typing:user", {
        userId: userInfo.userId,
        userName: userInfo.name,
        fieldName,
      });
    });

    socket.on("typing:stop", ({ ticketId, fieldName }: { ticketId: string; fieldName: string }) => {
      const userInfo = connectedUsers.get(socket.id);
      if (!userInfo) return;

      socket.to(`ticket:${ticketId}`).emit("typing:stop", {
        userId: userInfo.userId,
        fieldName,
      });
    });

    // === WORKFLOW EXECUTION UPDATES ===
    
    socket.on("workflow:subscribe", ({ executionId }: { executionId: string }) => {
      socket.join(`workflow:${executionId}`);
    });

    socket.on("workflow:unsubscribe", ({ executionId }: { executionId: string }) => {
      socket.leave(`workflow:${executionId}`);
    });

    // === METRICS STREAM ===
    
    socket.on("metrics:subscribe", ({ dashboardId }: { dashboardId: string }) => {
      socket.join(`metrics:${dashboardId}`);
    });

    socket.on("metrics:unsubscribe", ({ dashboardId }: { dashboardId: string }) => {
      socket.leave(`metrics:${dashboardId}`);
    });

    // === SCHEDULE STREAM ===

    socket.on("schedule:subscribe", () => {
      const room = `schedule:${user.organization_id || "global"}`;
      socket.join(room);
    });

    socket.on("schedule:unsubscribe", () => {
      const room = `schedule:${user.organization_id || "global"}`;
      socket.leave(room);
    });

    // === AUDIT LOG STREAM ===
    
    socket.on("audit:subscribe", ({ entityType, entityId }: { entityType: string; entityId: string }) => {
      socket.join(`audit:${entityType}:${entityId}`);
    });

    socket.on("audit:unsubscribe", ({ entityType, entityId }: { entityType: string; entityId: string }) => {
      socket.leave(`audit:${entityType}:${entityId}`);
    });

    // === BOARD STREAM ===

    socket.on("board:subscribe", ({ boardId }: { boardId: string }) => {
      if (!boardId) return;
      socket.join(`board:${boardId}`);
    });

    socket.on("board:unsubscribe", ({ boardId }: { boardId: string }) => {
      if (!boardId) return;
      socket.leave(`board:${boardId}`);
    });

    // === DISCONNECT HANDLING ===
    
    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${user.email} (${socket.id})`);
      
      const userInfo = connectedUsers.get(socket.id);
      if (userInfo) {
        // Leave ticket room if in one
        if (userInfo.currentTicketId) {
          const presence = ticketPresence.get(userInfo.currentTicketId);
          if (presence) {
            presence.delete(userInfo.userId);
          }
          
          releaseUserFieldLocks(userInfo.currentTicketId, socket.id);
          
          socket.to(`ticket:${userInfo.currentTicketId}`).emit("ticket:user-left", {
            userId: userInfo.userId,
            name: userInfo.name,
            timestamp: new Date().toISOString(),
          });
        }

        // Clear database presence
        await clearUserPresence(userInfo.userId);
        
        // Remove from connected users
        connectedUsers.delete(socket.id);

        // If no other sockets for this user, mark offline
        const stillOnline = Array.from(connectedUsers.values()).some((u) => u.userId === userInfo.userId);
        if (!stillOnline) {
          await setAvailabilityOffline(userInfo.userId);
        }
        
        // Broadcast offline status
        socket.broadcast.emit("user:offline", {
          userId: userInfo.userId,
        });
      }
    });
  });

  return io;
}

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  header.split(";").forEach((part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) return;
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!key) return;
    out[key] = decodeURIComponent(value || "");
  });
  return out;
}

// Helper functions
function releaseUserFieldLocks(ticketId: string, socketId: string): void {
  const locksToRelease: string[] = [];
  
  fieldLocks.forEach((lock, key) => {
    if (key.startsWith(`${ticketId}:`) && lock.socketId === socketId) {
      locksToRelease.push(key);
    }
  });
  
  locksToRelease.forEach(key => {
    const lock = fieldLocks.get(key);
    fieldLocks.delete(key);
    
    if (lock && io) {
      const fieldName = key.split(":")[1];
      io.to(`ticket:${ticketId}`).emit("field:unlocked", { fieldName });
    }
  });
}

function getTicketFieldLocks(ticketId: string): Array<{ fieldName: string; userId: string; userName: string }> {
  const locks: Array<{ fieldName: string; userId: string; userName: string }> = [];
  
  fieldLocks.forEach((lock, key) => {
    if (key.startsWith(`${ticketId}:`)) {
      const user = connectedUsers.get(lock.socketId);
      locks.push({
        fieldName: lock.fieldName,
        userId: lock.userId,
        userName: user?.name || "Unknown",
      });
    }
  });
  
  return locks;
}

async function updateUserPresence(userId: string, ticketId: string, status: string, socketId: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO user_presence (user_id, ticket_id, status, socket_id, last_activity)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) 
       DO UPDATE SET ticket_id = $2, status = $3, socket_id = $4, last_activity = NOW()`,
      [userId, ticketId, status, socketId]
    );
  } catch (error) {
    console.error("Failed to update user presence:", error);
  }
}

async function clearUserPresence(userId: string): Promise<void> {
  try {
    await pool.query("DELETE FROM user_presence WHERE user_id = $1", [userId]);
  } catch (error) {
    console.error("Failed to clear user presence:", error);
  }
}

async function lockField(ticketId: string, fieldName: string, userId: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO field_locks (ticket_id, field_name, locked_by, locked_at, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '5 minutes')
       ON CONFLICT (ticket_id, field_name) 
       DO UPDATE SET locked_by = $3, locked_at = NOW(), expires_at = NOW() + INTERVAL '5 minutes'`,
      [ticketId, fieldName, userId]
    );
  } catch (error) {
    console.error("Failed to lock field:", error);
  }
}

async function unlockField(ticketId: string, fieldName: string): Promise<void> {
  try {
    await pool.query(
      "DELETE FROM field_locks WHERE ticket_id = $1 AND field_name = $2",
      [ticketId, fieldName]
    );
  } catch (error) {
    console.error("Failed to unlock field:", error);
  }
}

async function getTicketActiveUsers(ticketId: string): Promise<Array<{ userId: string; name: string; role: string; status: string }>> {
  try {
    const result = await pool.query(
      `SELECT u.id as user_id, u.name, u.role, p.status
       FROM user_presence p
       JOIN users u ON p.user_id = u.id
       WHERE p.ticket_id = $1`,
      [ticketId]
    );
    return result.rows;
  } catch (error) {
    console.error("Failed to get ticket active users:", error);
    return [];
  }
}

// Broadcast functions for other services to use
export function broadcastWorkflowUpdate(executionId: string, data: any): void {
  if (io) {
    const payload = { executionId, ...data };
    io.to(`workflow:${executionId}`).emit(`workflow:${executionId}`, payload);
    io.to(`workflow:${executionId}`).emit("workflow:update", payload);
  }
}

export function broadcastAuditLog(entityType: string, entityId: string, log: any): void {
  if (io) {
    io.to(`audit:${entityType}:${entityId}`).emit("audit:new", log);
  }
}

export function broadcastMetrics(dashboardId: string, metrics: any): void {
  if (io) {
    io.to(`metrics:${dashboardId}`).emit("metrics:update", metrics);
  }
}

export function broadcastScheduleUpdate(
  organizationId: string | null | undefined,
  payload: any
): void {
  if (io) {
    io.to(`schedule:${organizationId || "global"}`).emit("schedule:update", payload);
  }
}

export function getIO(): SocketIOServer | null {
  return io;
}

// Cleanup expired locks periodically
setInterval(async () => {
  try {
    const result = await pool.query(
      "DELETE FROM field_locks WHERE expires_at < NOW() RETURNING ticket_id, field_name"
    );
    
    // Notify about expired locks
    if (io && result.rows.length > 0) {
      result.rows.forEach(row => {
        io!.to(`ticket:${row.ticket_id}`).emit("field:unlocked", {
          fieldName: row.field_name,
          reason: "expired",
        });
      });
    }
  } catch (error) {
    console.error("Failed to cleanup expired locks:", error);
  }
}, 60000); // Run every minute

// Cleanup stale presence records
setInterval(async () => {
  try {
    await pool.query("DELETE FROM user_presence WHERE last_activity < NOW() - INTERVAL '10 minutes'");
  } catch (error) {
    console.error("Failed to cleanup stale presence:", error);
  }
}, 300000); // Run every 5 minutes
