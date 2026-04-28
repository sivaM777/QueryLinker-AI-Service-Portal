import "dotenv/config";

import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import { pathToFileURL, fileURLToPath } from "url";
import path from "path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fs from "fs";

import { authRoutes } from "./api/auth/auth.routes.js";
import { ticketRoutes } from "./api/tickets/ticket.routes.js";
import { ticketProductivityRoutes } from "./api/tickets/ticket-productivity.routes.js";
import { kbRoutes } from "./api/kb/kb.routes.js";
import { userRoutes } from "./api/users/user.routes.js";
import { notificationRoutes } from "./api/notifications/notification.routes.js";
import { teamRoutes } from "./api/teams/team.routes.js";
import { emailRoutes } from "./api/integrations/email.routes.js";
import { emailMonitor } from "./services/integrations/email-monitor.service.js";
import { routingRoutes } from "./api/routing/routing.routes.js";
import { alertRulesRoutes } from "./api/alerts/alert-rules.routes.js";
import { chatbotRoutes } from "./api/chatbot/chatbot.routes.js";
import { glpiRoutes } from "./api/integrations/glpi.routes.js";
import { syncAllGlpiConfigs } from "./services/integrations/glpi-sync.service.js";
import { solmanRoutes } from "./api/integrations/solman.routes.js";
import { channelIntegrationRoutes } from "./api/integrations/channels.routes.js";
import { kbTrendRoutes } from "./api/kb/kb-trend.routes.js";
import { workflowRoutes } from "./api/workflows/workflow.routes.js";
import { approvalRoutes } from "./api/approvals/approval.routes.js";
import { automationRoutes } from "./api/automation/automation.routes.js";
import { autofixCatalogRoutes } from "./api/autofix/autofix-catalog.routes.js";
import { initSmsService } from "./services/notifications/sms.service.js";
import { env } from "./config/env.js";
import { checkSlaRisks } from "./services/tickets/sla-monitor.service.js";
import { autoCloseIdleTickets } from "./services/tickets/auto-close.service.js";
import { analyticsRoutes } from "./api/analytics/analytics.routes.js";
import { computeTrends } from "./services/analytics/trend.service.js";
import { generateKbSuggestions } from "./services/kb/kb-suggestions-generator.service.js";
import { computeRootCauseClusters } from "./services/analytics/root-cause.service.js";
import { auditRoutes } from "./api/audit/audit.routes.js";
import { visualWorkflowRoutes } from "./api/workflows/visual-workflow.routes.js";
import { startScheduledWorkflowRunner } from "./services/workflows/visual-workflow.service.js";
import { initializeSocketServer } from "./websocket/socket-server.js";
import { scheduleRoutes } from "./api/schedule/schedule.routes.js";
import { searchRoutes } from "./api/search/search.routes.js";
import { boardRoutes } from "./api/boards/board.routes.js";
import { accessCookieOptions, allowedOrigins, cookieSameSite, cookieSecure } from "./config/http.js";

export const server: FastifyInstance = Fastify({
  logger: true,
});

server.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (request, body: string, done) => {
    try {
      if (!body || body.trim() === "") {
        done(null, {});
        return;
      }
      done(null, JSON.parse(body));
    } catch (err) {
      done(err as Error);
    }
  }
);

server.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});

server.register(cookie, {
  parseOptions: {
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: cookieSecure,
  },
});
server.register(jwt, {
  secret: env.JWT_SECRET || "supersecret",
  cookie: {
    cookieName: "access_token",
    signed: false,
  },
});

server.register(multipart);

server.register(swagger, {
  openapi: {
    info: {
      title: "QueryLinker API",
      description: "Service desk API documentation",
      version: "1.0.0",
    },
  },
});

server.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: false,
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

server.register(fastifyStatic, {
  root: uploadsDir,
  prefix: "/uploads/",
});

server.addHook("onSend", async (request, reply, payload) => {
  if (request.method === "GET" && request.url.startsWith("/api/v1/")) {
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
  }
  return payload;
});

// Register routes
server.register(authRoutes, { prefix: "/api/v1/auth" });
server.register(ticketRoutes, { prefix: "/api/v1/tickets" });
server.register(ticketProductivityRoutes, { prefix: "/api/v1/tickets" });
server.register(kbRoutes, { prefix: "/api/v1/kb" });
server.register(userRoutes, { prefix: "/api/v1/users" });
server.register(teamRoutes, { prefix: "/api/v1/teams" });
server.register(notificationRoutes, { prefix: "/api/v1/notifications" });
server.register(searchRoutes, { prefix: "/api/v1/search" });
server.register(emailRoutes, { prefix: "/api/v1/integrations" });
server.register(routingRoutes, { prefix: "/api/v1" });
server.register(alertRulesRoutes, { prefix: "/api/v1" });
server.register(chatbotRoutes, { prefix: "/api/v1" });
server.register(glpiRoutes, { prefix: "/api/v1" });
server.register(solmanRoutes, { prefix: "/api/v1" });
server.register(channelIntegrationRoutes, { prefix: "/api/v1" });
server.register(kbTrendRoutes, { prefix: "/api/v1" });
server.register(workflowRoutes, { prefix: "/api/v1" });
server.register(approvalRoutes, { prefix: "/api/v1" });
server.register(automationRoutes, { prefix: "/api/v1" });
server.register(analyticsRoutes, { prefix: "/api/v1" });
server.register(autofixCatalogRoutes, { prefix: "/api/v1" });
server.register(auditRoutes, { prefix: "/api/v1" });
server.register(visualWorkflowRoutes, { prefix: "/api/v1" });
server.register(scheduleRoutes, { prefix: "/api/v1" });
server.register(boardRoutes, { prefix: "/api/v1/boards" });

// Health check
server.get("/health", async () => ({ status: "ok" }));
server.get("/api/v1/runtime", async () => ({
  apiBaseUrl: env.PUBLIC_API_URL || null,
  webBaseUrl: env.PUBLIC_WEB_URL || null,
  cookie: {
    sameSite: cookieSameSite,
    secure: cookieSecure,
    domain: accessCookieOptions.domain ?? null,
  },
}));

const start = async () => {
  try {
    const port = Number(process.env.PORT ?? 8000);
    initializeSocketServer(server.server);
    await server.listen({ port, host: "0.0.0.0" });
    server.log.info(`Server listening on http://0.0.0.0:${port}`);

    // Initialize SMS service
    if (env.SMS_PROVIDER) {
      initSmsService({
        provider: env.SMS_PROVIDER as any,
        twilioAccountSid: env.TWILIO_ACCOUNT_SID,
        twilioAuthToken: env.TWILIO_AUTH_TOKEN,
        twilioFromNumber: env.TWILIO_FROM_NUMBER,
        awsAccessKeyId: env.AWS_ACCESS_KEY_ID,
        awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        awsRegion: env.AWS_REGION,
        customApiUrl: env.SMS_CUSTOM_API_URL,
        customApiKey: env.SMS_CUSTOM_API_KEY,
      });
      server.log.info("SMS service initialized");
    }

    // Start email monitoring service
    try {
      await emailMonitor.start();
      server.log.info("Email monitoring service started");
    } catch (err) {
      server.log.warn(`Failed to start email monitoring: ${err instanceof Error ? err.message : String(err)}`);
    }

    // GLPI auto-sync every 5 minutes
    setInterval(() => {
      void syncAllGlpiConfigs().catch((e) =>
        server.log.warn(`GLPI auto-sync failed: ${e instanceof Error ? e.message : String(e)}`)
      );
    }, 5 * 60 * 1000);
    void syncAllGlpiConfigs().catch(() => undefined);

    // Phase 2/1 scheduled jobs (simple in-process scheduler)
    // SLA risk check every 10 minutes
    setInterval(() => {
      void checkSlaRisks().catch((e) => server.log.warn(`SLA risk check failed: ${e instanceof Error ? e.message : String(e)}`));
    }, 10 * 60 * 1000);
    void checkSlaRisks().catch(() => undefined);

    // Idle auto-close check daily
    setInterval(() => {
      void autoCloseIdleTickets().catch((e) =>
        server.log.warn(`Auto-close job failed: ${e instanceof Error ? e.message : String(e)}`)
      );
    }, 24 * 60 * 60 * 1000);

    // Trend detection hourly
    setInterval(() => {
      void computeTrends().catch((e) =>
        server.log.warn(`Trend detection failed: ${e instanceof Error ? e.message : String(e)}`)
      );
    }, 60 * 60 * 1000);
    void computeTrends().catch(() => undefined);

    // KB suggestions daily
    setInterval(() => {
      void generateKbSuggestions(10).catch((e) =>
        server.log.warn(`KB suggestion generation failed: ${e instanceof Error ? e.message : String(e)}`)
      );
    }, 24 * 60 * 60 * 1000);
    void generateKbSuggestions(10).catch(() => undefined);

    // Root-cause clustering every 6 hours
    setInterval(() => {
      void computeRootCauseClusters().catch((e) =>
        server.log.warn(`Root-cause clustering failed: ${e instanceof Error ? e.message : String(e)}`)
      );
    }, 6 * 60 * 60 * 1000);
    void computeRootCauseClusters().catch(() => undefined);

    startScheduledWorkflowRunner();
    server.log.info("Visual workflow scheduler started");
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

let started = false;
const startOnce = () => {
  if (started) return;
  started = true;
  void start();
};

// When this module is executed directly via `node dist/server.js`, start the server.
// This is ESM-safe (no `require.main`).
if (process.argv[1]) {
  const argvUrl = pathToFileURL(process.argv[1]).href;
  if (import.meta.url === argvUrl) {
    startOnce();
  }
}

// Support `tsx watch src/server.ts` where process.argv[1] points to tsx.
if (process.argv.some((a: string) => /server\.(ts|js)$/.test(a))) {
  startOnce();
}
