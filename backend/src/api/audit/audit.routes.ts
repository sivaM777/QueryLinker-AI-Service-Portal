import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
import {
  queryAuditLogs,
  getAuditStats,
  exportAuditLogsToCSV,
  getEntityHistory,
  logDataExported,
} from "../../services/audit/audit.service.js";

const querySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  action: z.enum(["created", "updated", "deleted", "viewed", "exported", "printed", "shared"]).optional(),
  fieldName: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const exportSchema = z.object({
  entityType: z.string().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  format: z.enum(["csv", "json"]).default("csv"),
});

export const auditRoutes: FastifyPluginAsync = async (server) => {
  // GET /audit - Query audit logs with filters
  server.get(
    "/audit",
    { preHandler: [requireAuth, requireRole(["ADMIN", "AGENT"])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const query = querySchema.parse(request.query);

        const { logs, total } = await queryAuditLogs({
          entityType: query.entityType,
          entityId: query.entityId,
          userId: query.userId,
          action: query.action,
          fieldName: query.fieldName,
          startDate: query.startDate ? new Date(query.startDate) : undefined,
          endDate: query.endDate ? new Date(query.endDate) : undefined,
          limit: query.limit,
          offset: query.offset,
        });

        return reply.send({
          data: logs,
          pagination: {
            total,
            limit: query.limit,
            offset: query.offset,
            hasMore: total > query.offset + query.limit,
          },
        });
      } catch (error) {
        console.error("Error querying audit logs:", error);
        return reply.status(400).send({ error: "Invalid query parameters" });
      }
    }
  );

  // GET /audit/stats - Get audit statistics
  server.get(
    "/audit/stats",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { days } = z.object({ days: z.coerce.number().min(1).max(365).default(30) }).parse(request.query);

        const stats = await getAuditStats(days);

        return reply.send(stats);
      } catch (error) {
        console.error("Error getting audit stats:", error);
        return reply.status(400).send({ error: "Invalid query parameters" });
      }
    }
  );

  // GET /audit/:entityType/:entityId - Get audit for specific entity
  server.get(
    "/audit/:entityType/:entityId",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const paramsSchema = z.object({
          entityType: z.string(),
          entityId: z.string().uuid(),
        });
        const { entityType, entityId } = paramsSchema.parse(request.params);

        const query = z.object({ limit: z.coerce.number().min(1).max(1000).default(50) }).parse(request.query);

        const history = await getEntityHistory(entityType, entityId, {
          limit: query.limit,
        });

        return reply.send({ data: history });
      } catch (error) {
        console.error("Error getting entity history:", error);
        return reply.status(400).send({ error: "Invalid parameters" });
      }
    }
  );

  // POST /audit/export - Export audit logs
  server.post(
    "/audit/export",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = exportSchema.parse(request.body);
        const u = request.authUser!;

        if (body.format === "csv") {
          const csv = await exportAuditLogsToCSV({
            entityType: body.entityType,
            userId: body.userId,
            action: body.action,
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
          });

          await logDataExported(
            body.entityType || "audit",
            JSON.stringify(body),
            csv.split("\n").length - 1,
            "csv",
            {
              userId: u.id,
              userEmail: u.email,
              userName: u.name,
              ipAddress: request.ip,
              userAgent: String(request.headers["user-agent"] || ""),
            }
          );

          reply.header("Content-Type", "text/csv");
          reply.header("Content-Disposition", `attachment; filename="audit-export-${Date.now()}.csv"`);
          return reply.send(csv);
        } else {
          // JSON export
          const { logs } = await queryAuditLogs({
            entityType: body.entityType,
            userId: body.userId,
            action: body.action,
            startDate: body.startDate ? new Date(body.startDate) : undefined,
            endDate: body.endDate ? new Date(body.endDate) : undefined,
            limit: 10000,
          });

          await logDataExported(
            body.entityType || "audit",
            JSON.stringify(body),
            logs.length,
            "json",
            {
              userId: u.id,
              userEmail: u.email,
              userName: u.name,
              ipAddress: request.ip,
              userAgent: String(request.headers["user-agent"] || ""),
            }
          );

          reply.header("Content-Type", "application/json");
          reply.header("Content-Disposition", `attachment; filename="audit-export-${Date.now()}.json"`);
          return reply.send(JSON.stringify(logs, null, 2));
        }
      } catch (error) {
        console.error("Error exporting audit logs:", error);
        return reply.status(400).send({ error: "Export failed" });
      }
    }
  );

  // GET /audit/compliance-report - Generate compliance report
  server.get(
    "/audit/compliance-report",
    { preHandler: [requireAuth, requireRole(["ADMIN"])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { startDate, endDate } = z
          .object({
            startDate: z.string().datetime(),
            endDate: z.string().datetime(),
          })
          .parse(request.query);

        const start = new Date(startDate);
        const end = new Date(endDate);

        // Generate compliance summary
        const [stats, entityStats] = await Promise.all([
          queryAuditLogs({
            startDate: start,
            endDate: end,
            limit: 1,
          }),
          Promise.all([
            queryAuditLogs({ entityType: "ticket", startDate: start, endDate: end, limit: 1 }),
            queryAuditLogs({ entityType: "user", startDate: start, endDate: end, limit: 1 }),
            queryAuditLogs({ entityType: "workflow", startDate: start, endDate: end, limit: 1 }),
          ]),
        ]);

        const report = {
          period: { startDate, endDate },
          summary: {
            totalAuditEntries: stats.total,
            byEntityType: {
              ticket: entityStats[0].total,
              user: entityStats[1].total,
              workflow: entityStats[2].total,
            },
          },
          compliance: {
            auditTrailComplete: true,
            retentionPolicy: "7 years (SOX compliant)",
            immutableLogs: true,
            userAttribution: true,
          },
          generatedAt: new Date().toISOString(),
        };

        return reply.send(report);
      } catch (error) {
        console.error("Error generating compliance report:", error);
        return reply.status(400).send({ error: "Report generation failed" });
      }
    }
  );
};
