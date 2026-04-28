import { pool } from "../../config/db.js";
import { broadcastAuditLog } from "../../websocket/socket-server.js";

export interface AuditLogEntry {
  entityType: string;
  entityId: string;
  action: "created" | "updated" | "deleted" | "viewed" | "exported" | "printed" | "shared";
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  userId: string;
  userEmail: string;
  userName: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Log a single audit event
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const result = await pool.query(
      `INSERT INTO audit_logs 
       (entity_type, entity_id, action, field_name, old_value, new_value, 
        user_id, user_email, user_name, ip_address, user_agent, session_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, created_at`,
      [
        entry.entityType,
        entry.entityId,
        entry.action,
        entry.fieldName || null,
        entry.oldValue !== undefined ? String(entry.oldValue) : null,
        entry.newValue !== undefined ? String(entry.newValue) : null,
        entry.userId,
        entry.userEmail,
        entry.userName,
        entry.ipAddress || null,
        entry.userAgent || null,
        entry.sessionId || null,
        JSON.stringify(entry.metadata || {}),
      ]
    );

    // Broadcast real-time update
    broadcastAuditLog(entry.entityType, entry.entityId, {
      id: result.rows[0].id,
      ...entry,
      createdAt: result.rows[0].created_at,
    });
  } catch (error) {
    console.error("Failed to log audit entry:", error);
    // Don't throw - audit logging should not break main functionality
  }
}

/**
 * Log multiple changes for an entity update
 */
export async function logEntityUpdate(
  entityType: string,
  entityId: string,
  oldData: Record<string, any>,
  newData: Record<string, any>,
  userContext: {
    userId: string;
    userEmail: string;
    userName: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  },
  options?: {
    sensitiveFields?: string[]; // Fields to mask (passwords, tokens, etc.)
    ignoredFields?: string[]; // Fields to skip (updated_at, etc.)
    metadata?: Record<string, any>;
  }
): Promise<void> {
  const sensitiveFields = options?.sensitiveFields || ["password", "token", "secret", "api_key"];
  const ignoredFields = options?.ignoredFields || ["updated_at", "created_at", "id"];

  const changes: AuditLogEntry[] = [];

  // Compare all fields
  const allFields = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);

  for (const field of allFields) {
    // Skip ignored fields
    if (ignoredFields.includes(field)) continue;

    const oldValue = oldData?.[field];
    const newValue = newData?.[field];

    // Check if value changed
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      const isSensitive = sensitiveFields.some((sf) =>
        field.toLowerCase().includes(sf.toLowerCase())
      );

      changes.push({
        entityType,
        entityId,
        action: "updated",
        fieldName: field,
        oldValue: isSensitive ? "[REDACTED]" : JSON.stringify(oldValue),
        newValue: isSensitive ? "[REDACTED]" : JSON.stringify(newValue),
        ...userContext,
        metadata: options?.metadata,
      });
    }
  }

  // Log all changes
  for (const change of changes) {
    await logAudit(change);
  }
}

/**
 * Log entity creation
 */
export async function logEntityCreated(
  entityType: string,
  entityId: string,
  data: Record<string, any>,
  userContext: {
    userId: string;
    userEmail: string;
    userName: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  },
  metadata?: Record<string, any>
): Promise<void> {
  await logAudit({
    entityType,
    entityId,
    action: "created",
    newValue: JSON.stringify(data),
    ...userContext,
    metadata,
  });
}

/**
 * Log entity deletion
 */
export async function logEntityDeleted(
  entityType: string,
  entityId: string,
  data: Record<string, any>,
  userContext: {
    userId: string;
    userEmail: string;
    userName: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  },
  metadata?: Record<string, any>
): Promise<void> {
  await logAudit({
    entityType,
    entityId,
    action: "deleted",
    oldValue: JSON.stringify(data),
    ...userContext,
    metadata,
  });
}

/**
 * Log entity view/access
 */
export async function logEntityViewed(
  entityType: string,
  entityId: string,
  userContext: {
    userId: string;
    userEmail: string;
    userName: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  },
  metadata?: Record<string, any>
): Promise<void> {
  await logAudit({
    entityType,
    entityId,
    action: "viewed",
    ...userContext,
    metadata,
  });
}

/**
 * Log data export
 */
export async function logDataExported(
  entityType: string,
  query: string,
  recordCount: number,
  format: string,
  userContext: {
    userId: string;
    userEmail: string;
    userName: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  }
): Promise<void> {
  await logAudit({
    entityType,
    entityId: "00000000-0000-0000-0000-000000000000",
    action: "exported",
    newValue: `Exported ${recordCount} records to ${format}`,
    ...userContext,
    metadata: { query, recordCount, format },
  });
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(filters: {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  fieldName?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ logs: any[]; total: number }> {
  const conditions: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (filters.entityType) {
    conditions.push(`entity_type = $${paramIndex++}`);
    values.push(filters.entityType);
  }
  if (filters.entityId) {
    conditions.push(`entity_id = $${paramIndex++}`);
    values.push(filters.entityId);
  }
  if (filters.userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    values.push(filters.userId);
  }
  if (filters.action) {
    conditions.push(`action = $${paramIndex++}`);
    values.push(filters.action);
  }
  if (filters.fieldName) {
    conditions.push(`field_name = $${paramIndex++}`);
    values.push(filters.fieldName);
  }
  if (filters.startDate) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`created_at <= $${paramIndex++}`);
    values.push(filters.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const logsQuery = `
    SELECT * FROM audit_logs 
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;
  values.push(limit, offset);

  const countQuery = `
    SELECT COUNT(*) as total FROM audit_logs ${whereClause}
  `;

  const [logsResult, countResult] = await Promise.all([
    pool.query(logsQuery, values),
    pool.query(countQuery, values.slice(0, -2)), // Remove limit/offset params
  ]);

  return {
    logs: logsResult.rows,
    total: parseInt(countResult.rows[0].total),
  };
}

/**
 * Get audit statistics
 */
export async function getAuditStats(days: number = 30): Promise<{
  totalChanges: number;
  changesByEntity: Record<string, number>;
  changesByUser: Array<{ userId: string; userName: string; count: number }>;
  changesByDay: Array<{ date: string; count: number }>;
}> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [totalResult, entityResult, userResult, dayResult] = await Promise.all([
    pool.query(
      "SELECT COUNT(*) as count FROM audit_logs WHERE created_at >= $1",
      [startDate]
    ),
    pool.query(
      `SELECT entity_type, COUNT(*) as count 
       FROM audit_logs 
       WHERE created_at >= $1 
       GROUP BY entity_type`,
      [startDate]
    ),
    pool.query(
      `SELECT user_id, user_name, COUNT(*) as count 
       FROM audit_logs 
       WHERE created_at >= $1 AND user_id IS NOT NULL
       GROUP BY user_id, user_name 
       ORDER BY count DESC 
       LIMIT 10`,
      [startDate]
    ),
    pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM audit_logs 
       WHERE created_at >= $1 
       GROUP BY DATE(created_at) 
       ORDER BY date`,
      [startDate]
    ),
  ]);

  const changesByEntity: Record<string, number> = {};
  entityResult.rows.forEach((row: { entity_type: string; count: string }) => {
    changesByEntity[row.entity_type] = parseInt(row.count);
  });

  return {
    totalChanges: parseInt(totalResult.rows[0].count),
    changesByEntity,
    changesByUser: userResult.rows.map((row: { user_id: string; user_name: string; count: string }) => ({
      userId: row.user_id,
      userName: row.user_name,
      count: parseInt(row.count),
    })),
    changesByDay: dayResult.rows.map((row: { date: string; count: string }) => ({
      date: row.date,
      count: parseInt(row.count),
    })),
  };
}

/**
 * Export audit logs to CSV format
 */
export async function exportAuditLogsToCSV(
  filters: Parameters<typeof queryAuditLogs>[0]
): Promise<string> {
  const { logs } = await queryAuditLogs({ ...filters, limit: 10000 });

  const headers = [
    "Timestamp",
    "Entity Type",
    "Entity ID",
    "Action",
    "Field Name",
    "Old Value",
    "New Value",
    "User",
    "Email",
    "IP Address",
  ];

  const rows = logs.map((log) => [
    log.created_at,
    log.entity_type,
    log.entity_id,
    log.action,
    log.field_name || "",
    log.old_value || "",
    log.new_value || "",
    log.user_name,
    log.user_email,
    log.ip_address || "",
  ]);

  // Convert to CSV
  const csv = [headers.join(","), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");

  return csv;
}

/**
 * Get entity change history
 */
export async function getEntityHistory(
  entityType: string,
  entityId: string,
  options?: { limit?: number; includeViewed?: boolean }
): Promise<any[]> {
  const limit = options?.limit || 50;
  const actionFilter = options?.includeViewed ? "" : "AND action != 'viewed'";

  const result = await pool.query(
    `SELECT * FROM audit_logs 
     WHERE entity_type = $1 AND entity_id = $2 ${actionFilter}
     ORDER BY created_at DESC
     LIMIT $3`,
    [entityType, entityId, limit]
  );

  return result.rows;
}
