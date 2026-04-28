import { pool } from "../../config/db.js";

export interface PresenceData {
  userId: string;
  ticketId?: string;
  pagePath?: string;
  status: "online" | "away" | "busy" | "offline";
  lastActivity: Date;
  socketId: string;
  metadata?: Record<string, any>;
}

export interface FieldLock {
  ticketId: string;
  fieldName: string;
  lockedBy: string;
  userName: string;
  userEmail: string;
  lockedAt: Date;
  expiresAt: Date;
}

export interface ConflictData {
  ticketId: string;
  fieldName: string;
  userAId: string;
  userBId: string;
  conflictType: "simultaneous_edit" | "overwrite" | "field_lock_timeout";
  resolution?: "merged" | "user_a_won" | "user_b_won" | "discarded";
}

/**
 * Get all active users on a specific ticket
 */
export async function getTicketPresence(ticketId: string): Promise<
  Array<{
    userId: string;
    name: string;
    email: string;
    role: string;
    status: string;
    lastActivity: Date;
  }>
> {
  const result = await pool.query(
    `SELECT 
      u.id as user_id,
      u.name,
      u.email,
      u.role,
      p.status,
      p.last_activity
    FROM user_presence p
    JOIN users u ON p.user_id = u.id
    WHERE p.ticket_id = $1
    ORDER BY p.last_activity DESC`,
    [ticketId]
  );

  return result.rows;
}

/**
 * Get all field locks for a ticket
 */
export async function getTicketFieldLocks(ticketId: string): Promise<FieldLock[]> {
  const result = await pool.query(
    `SELECT 
      fl.ticket_id,
      fl.field_name,
      fl.locked_by,
      u.name as user_name,
      u.email as user_email,
      fl.locked_at,
      fl.expires_at
    FROM field_locks fl
    JOIN users u ON fl.locked_by = u.id
    WHERE fl.ticket_id = $1 AND fl.expires_at > NOW()`,
    [ticketId]
  );

  return result.rows;
}

/**
 * Check if a field is locked by another user
 */
export async function isFieldLocked(
  ticketId: string,
  fieldName: string,
  requestingUserId: string
): Promise<{ locked: boolean; lockedBy?: string; userName?: string }> {
  const result = await pool.query(
    `SELECT 
      fl.locked_by,
      u.name as user_name
    FROM field_locks fl
    JOIN users u ON fl.locked_by = u.id
    WHERE fl.ticket_id = $1 
      AND fl.field_name = $2 
      AND fl.expires_at > NOW()
      AND fl.locked_by != $3`,
    [ticketId, fieldName, requestingUserId]
  );

  if (result.rows.length > 0) {
    return {
      locked: true,
      lockedBy: result.rows[0].locked_by,
      userName: result.rows[0].user_name,
    };
  }

  return { locked: false };
}

/**
 * Lock a field for editing
 */
export async function lockField(
  ticketId: string,
  fieldName: string,
  userId: string,
  socketId: string,
  durationMinutes: number = 5
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if already locked by someone else
    const existing = await pool.query(
      `SELECT locked_by FROM field_locks 
       WHERE ticket_id = $1 AND field_name = $2 AND expires_at > NOW()`,
      [ticketId, fieldName]
    );

    if (existing.rows.length > 0 && existing.rows[0].locked_by !== userId) {
      return { success: false, error: "Field is already locked by another user" };
    }

    // Lock or extend lock
    await pool.query(
      `INSERT INTO field_locks (ticket_id, field_name, locked_by, socket_id, locked_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '${durationMinutes} minutes')
       ON CONFLICT (ticket_id, field_name) 
       DO UPDATE SET 
         locked_by = $3,
         socket_id = $4,
         locked_at = NOW(),
         expires_at = NOW() + INTERVAL '${durationMinutes} minutes'`,
      [ticketId, fieldName, userId, socketId]
    );

    return { success: true };
  } catch (error) {
    console.error("Error locking field:", error);
    return { success: false, error: "Failed to lock field" };
  }
}

/**
 * Unlock a field
 */
export async function unlockField(
  ticketId: string,
  fieldName: string,
  userId: string
): Promise<{ success: boolean }> {
  try {
    await pool.query(
      `DELETE FROM field_locks 
       WHERE ticket_id = $1 AND field_name = $2 AND locked_by = $3`,
      [ticketId, fieldName, userId]
    );

    return { success: true };
  } catch (error) {
    console.error("Error unlocking field:", error);
    return { success: false };
  }
}

/**
 * Record a conflict for analysis
 */
export async function recordConflict(conflict: ConflictData): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO conflict_history 
       (ticket_id, field_name, user_a_id, user_b_id, conflict_type, resolution)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        conflict.ticketId,
        conflict.fieldName,
        conflict.userAId,
        conflict.userBId,
        conflict.conflictType,
        conflict.resolution,
      ]
    );
  } catch (error) {
    console.error("Error recording conflict:", error);
  }
}

/**
 * Get conflict statistics
 */
export async function getConflictStats(
  days: number = 30
): Promise<{
  totalConflicts: number;
  byType: Record<string, number>;
  byField: Record<string, number>;
  resolutionRate: number;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [totalResult, typeResult, fieldResult, resolvedResult] = await Promise.all([
    pool.query(
      "SELECT COUNT(*) as count FROM conflict_history WHERE created_at >= $1",
      [startDate]
    ),
    pool.query(
      `SELECT conflict_type, COUNT(*) as count 
       FROM conflict_history 
       WHERE created_at >= $1 
       GROUP BY conflict_type`,
      [startDate]
    ),
    pool.query(
      `SELECT field_name, COUNT(*) as count 
       FROM conflict_history 
       WHERE created_at >= $1 
       GROUP BY field_name 
       ORDER BY count DESC 
       LIMIT 10`,
      [startDate]
    ),
    pool.query(
      `SELECT COUNT(*) as count 
       FROM conflict_history 
       WHERE created_at >= $1 AND resolution IS NOT NULL`,
      [startDate]
    ),
  ]);

  const totalConflicts = parseInt(totalResult.rows[0].count);
  const resolvedConflicts = parseInt(resolvedResult.rows[0].count);

  const byType: Record<string, number> = {};
  typeResult.rows.forEach((row: { conflict_type: string; count: string }) => {
    byType[row.conflict_type] = parseInt(row.count);
  });

  const byField: Record<string, number> = {};
  fieldResult.rows.forEach((row: { field_name: string; count: string }) => {
    byField[row.field_name] = parseInt(row.count);
  });

  return {
    totalConflicts,
    byType,
    byField,
    resolutionRate: totalConflicts > 0 ? (resolvedConflicts / totalConflicts) * 100 : 0,
  };
}

/**
 * Cleanup expired locks and stale presence
 */
export async function cleanupExpiredData(): Promise<{
  locksRemoved: number;
  presenceRemoved: number;
}> {
  const [locksResult, presenceResult] = await Promise.all([
    pool.query("DELETE FROM field_locks WHERE expires_at < NOW() RETURNING id"),
    pool.query(
      "DELETE FROM user_presence WHERE last_activity < NOW() - INTERVAL '10 minutes' RETURNING user_id"
    ),
  ]);

  return {
    locksRemoved: locksResult.rowCount || 0,
    presenceRemoved: presenceResult.rowCount || 0,
  };
}

/**
 * Get system-wide presence stats
 */
export async function getSystemPresenceStats(): Promise<{
  totalOnline: number;
  byTicket: Array<{ ticketId: string; count: number }>;
  byPage: Array<{ pagePath: string; count: number }>;
}> {
  const [onlineResult, byTicketResult, byPageResult] = await Promise.all([
    pool.query("SELECT COUNT(*) as count FROM user_presence WHERE status = 'online'"),
    pool.query(
      `SELECT ticket_id, COUNT(*) as count 
       FROM user_presence 
       WHERE ticket_id IS NOT NULL 
       GROUP BY ticket_id 
       ORDER BY count DESC 
       LIMIT 10`
    ),
    pool.query(
      `SELECT page_path, COUNT(*) as count 
       FROM user_presence 
       WHERE page_path IS NOT NULL 
       GROUP BY page_path 
       ORDER BY count DESC 
       LIMIT 10`
    ),
  ]);

  return {
    totalOnline: parseInt(onlineResult.rows[0].count),
    byTicket: byTicketResult.rows.map((row: { ticket_id: string; count: string }) => ({
      ticketId: row.ticket_id,
      count: parseInt(row.count),
    })),
    byPage: byPageResult.rows.map((row: { page_path: string; count: string }) => ({
      pagePath: row.page_path,
      count: parseInt(row.count),
    })),
  };
}
