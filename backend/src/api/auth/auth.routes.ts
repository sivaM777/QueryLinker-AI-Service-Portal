import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import crypto from "crypto";
import {
  type DbUser,
  findUserByEmail,
  findUserById,
  verifyPassword,
  toPublicUser,
  createRefreshToken,
  revokeRefreshToken,
} from "../../services/auth/auth.service.js";
import { requireAuth } from "../../middlewares/auth.js";
import { pool } from "../../config/db.js";
import {
  buildAzureAuthorizationUrl,
  exchangeAzureCode,
  resolveAzureUser,
  validateAzureIdToken,
} from "../../services/integrations/azure-auth.service.js";
import {
  ensureDemoWorkspace,
  registerOrganizationWorkspace,
} from "../../services/organizations/saas-onboarding.service.js";
import {
  accessCookieOptions,
  refreshCookieOptions,
  oauthCookieOptions,
} from "../../config/http.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tab_id: z.string().min(1).optional(),
  current_url: z.string().min(1).optional(),
});

const demoLoginSchema = z.object({
  role: z.enum(["EMPLOYEE", "AGENT", "MANAGER", "ADMIN"]).default("ADMIN"),
  tab_id: z.string().min(1).optional(),
  current_url: z.string().min(1).optional(),
});

const registerOrganizationSchema = z.object({
  company_name: z.string().trim().min(2).max(120),
  domain: z.string().trim().min(3).max(120),
  admin_name: z.string().trim().min(2).max(120),
  admin_email: z.string().email(),
  password: z.string().min(8).max(200),
  tab_id: z.string().min(1).optional(),
  current_url: z.string().min(1).optional(),
});

const sessionTouchSchema = z
  .object({
    tab_id: z.string().min(1).optional(),
    current_url: z.string().min(1).optional(),
  })
  .optional();

const accessCookieName = "access_token";
const refreshCookieName = "refresh_token";
const refreshTtlDays = env.REFRESH_TOKEN_TTL_DAYS;
const accessTtl = env.ACCESS_TOKEN_TTL;

const mobileClientHeader = "x-client-platform";
const mobileClientValue = "mobile";
const azureStateCookieName = "azure_oauth_state";
const azureContextCookieName = "azure_oauth_ctx";

const refreshBodySchema = z
  .object({
    refresh_token: z.string().min(1).optional(),
    tab_id: z.string().min(1).optional(),
    current_url: z.string().min(1).optional(),
  })
  .optional();

const normalizeSessionUrl = (value?: string | null) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("/login")) return null;
  return trimmed;
};

const createOrReplaceActiveSession = async (input: {
  userId: string;
  tabId?: string | null;
  currentUrl?: string | null;
  sessionId?: string;
}) => {
  const sessionId = input.sessionId ?? crypto.randomUUID();
  await pool.query(
    `UPDATE users
     SET active_session_id = $2,
         active_session_seen_at = now(),
         active_session_tab_id = $3,
         active_session_url = $4,
         availability_status = CASE
           WHEN availability_status IS NULL OR availability_status = 'OFFLINE' THEN 'ONLINE'
           ELSE availability_status
         END,
         updated_at = now()
     WHERE id = $1`,
    [input.userId, sessionId, input.tabId ?? null, normalizeSessionUrl(input.currentUrl)]
  );
  return sessionId;
};

const getRoleHomePath = (role: DbUser["role"]) => {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "MANAGER") return "/admin/manager";
  if (role === "AGENT") return "/admin/agent-dashboard";
  return "/app";
};

const issueBrowserSession = async (args: {
  user: DbUser;
  reply: any;
  tabId?: string | null;
  currentUrl?: string | null;
  setCookies?: boolean;
}) => {
  const sessionId = await createOrReplaceActiveSession({
    userId: args.user.id,
    tabId: args.tabId,
    currentUrl: args.currentUrl,
  });

  const publicUser = toPublicUser(args.user);
  const token = await args.reply.jwtSign({ ...publicUser, session_id: sessionId }, { expiresIn: accessTtl });
  const refresh = await createRefreshToken(args.user.id, refreshTtlDays);

  if (args.setCookies !== false) {
    args.reply.setCookie(accessCookieName, token, {
      ...accessCookieOptions,
      maxAge: parseInt(accessTtl) * 60,
    });
    args.reply.setCookie(refreshCookieName, refresh.token, {
      ...refreshCookieOptions,
      maxAge: refreshTtlDays * 24 * 60 * 60,
    });
  }

  return { publicUser, token, refreshToken: refresh.token, sessionId };
};

const parseAzureContext = (raw?: string | null) => {
  if (!raw) return { tabId: null, currentUrl: null };
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      tab_id?: string;
      current_url?: string;
    };
    return {
      tabId: parsed.tab_id ?? null,
      currentUrl: normalizeSessionUrl(parsed.current_url) ?? null,
    };
  } catch {
    return { tabId: null, currentUrl: null };
  }
};

const buildWebRedirect = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const webBaseUrl = env.PUBLIC_WEB_URL?.trim().replace(/\/+$/, "");
  return webBaseUrl ? `${webBaseUrl}${normalizedPath}` : normalizedPath;
};

export const authRoutes: FastifyPluginAsync = async (server) => {
  server.post("/demo-login", async (request, reply) => {
    const body = demoLoginSchema.parse(request.body);
    const demo = await ensureDemoWorkspace();
    const email = demo.roleEmails[body.role];
    const user = await findUserByEmail(email);
    if (!user) return reply.code(500).send({ message: "Demo user could not be created" });

    const { publicUser } = await issueBrowserSession({
      user,
      reply,
      tabId: body.tab_id,
      currentUrl: body.current_url,
    });
    return reply.send({ user: publicUser, demo: true });
  });

  server.post("/register-organization", async (request, reply) => {
    const body = registerOrganizationSchema.parse(request.body);
    try {
      const created = await registerOrganizationWorkspace({
        companyName: body.company_name,
        domain: body.domain,
        adminName: body.admin_name,
        adminEmail: body.admin_email,
        adminPassword: body.password,
      });
      const { publicUser } = await issueBrowserSession({
        user: created.admin,
        reply,
        tabId: body.tab_id,
        currentUrl: body.current_url,
      });
      return reply.code(201).send({
        user: publicUser,
        organization: {
          id: created.organizationId,
          name: body.company_name,
          domain: body.domain,
        },
      });
    } catch (error: any) {
      return reply.code(error?.statusCode ?? 500).send({
        message: error instanceof Error ? error.message : "Organization registration failed",
      });
    }
  });

  server.post("/login", async (request, reply) => {
    const body = loginSchema.parse(request.body);

    const isMobileClient =
      String((request.headers as Record<string, unknown>)[mobileClientHeader] ?? "").toLowerCase() ===
      mobileClientValue;

    const user = await findUserByEmail(body.email);
    if (!user) {
      return reply.code(401).send({ message: "Invalid credentials" });
    }

    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) {
      return reply.code(401).send({ message: "Invalid credentials" });
    }

    const { publicUser, token, refreshToken } = await issueBrowserSession({
      user,
      reply,
      tabId: body.tab_id,
      currentUrl: body.current_url,
      setCookies: !isMobileClient,
    });

    if (!isMobileClient) {
      return reply.send({ user: publicUser });
    }

    return reply.send({ token, user: publicUser, refresh_token: refreshToken });
  });

  server.get("/azure/start", async (request, reply) => {
    const query = z
      .object({
        tab_id: z.string().min(1).optional(),
        current_url: z.string().min(1).optional(),
      })
      .parse(request.query);

    const state = crypto.randomUUID();
    const encodedContext = Buffer.from(
      JSON.stringify({
        tab_id: query.tab_id ?? null,
        current_url: normalizeSessionUrl(query.current_url) ?? null,
      }),
      "utf8"
    ).toString("base64url");

    reply.setCookie(azureStateCookieName, state, {
      ...oauthCookieOptions,
      maxAge: 10 * 60,
    });
    reply.setCookie(azureContextCookieName, encodedContext, {
      ...oauthCookieOptions,
      maxAge: 10 * 60,
    });

    return reply.redirect(buildAzureAuthorizationUrl(state));
  });

  server.get("/azure/callback", async (request, reply) => {
    const query = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
      })
      .parse(request.query);

    const clearAzureCookies = () => {
      reply.clearCookie(azureStateCookieName, { path: "/api/v1/auth" });
      reply.clearCookie(azureContextCookieName, { path: "/api/v1/auth" });
    };

    if (query.error) {
      clearAzureCookies();
      return reply.redirect(
        buildWebRedirect(`/login?azure_error=${encodeURIComponent(query.error_description || query.error)}`)
      );
    }

    const storedState = request.cookies?.[azureStateCookieName];
    const storedContext = request.cookies?.[azureContextCookieName];
    if (!query.code || !query.state || !storedState || query.state !== storedState) {
      clearAzureCookies();
      return reply.redirect(buildWebRedirect("/login?azure_error=Azure%20sign-in%20state%20validation%20failed"));
    }

    const { tabId, currentUrl } = parseAzureContext(storedContext);
    clearAzureCookies();

    try {
      const tokens = await exchangeAzureCode(query.code);
      const identity = validateAzureIdToken(tokens.id_token);
      const user = await resolveAzureUser(identity);
      await issueBrowserSession({
        user,
        reply,
        tabId,
        currentUrl,
      });

      return reply.redirect(buildWebRedirect(currentUrl || getRoleHomePath(user.role)));
    } catch (error: any) {
      return reply.redirect(
        buildWebRedirect(
          `/login?azure_error=${encodeURIComponent(error instanceof Error ? error.message : "Azure sign-in failed")}`
        )
      );
    }
  });

  server.get("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const u = request.authUser;
    if (!u) return reply.code(401).send({ message: "Unauthorized" });

    const dbUser = await findUserById(u.id);
    if (!dbUser) return reply.code(401).send({ message: "Unauthorized" });

    // Keep status and session fresh for active sessions
    await pool.query(
      `UPDATE users
       SET availability_status = CASE
             WHEN availability_status IS NULL OR availability_status = 'OFFLINE' THEN 'ONLINE'
             ELSE availability_status
           END,
           active_session_seen_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [dbUser.id]
    );

    return reply.send(toPublicUser(dbUser));
  });

  server.post("/refresh", async (request, reply) => {
    const parsed = refreshBodySchema.parse(request.body);
    const raw = request.cookies?.[refreshCookieName] ?? parsed?.refresh_token;
    if (!raw) return reply.code(401).send({ message: "Unauthorized" });

    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const existingToken = await pool.query<{
      id: string;
      user_id: string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      "SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1",
      [tokenHash]
    );
    const tokenRow = existingToken.rows[0];
    if (!tokenRow) return reply.code(401).send({ message: "Unauthorized" });
    if (tokenRow.revoked_at) return reply.code(401).send({ message: "Unauthorized" });
    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) return reply.code(401).send({ message: "Unauthorized" });

    const dbUser = await findUserById(tokenRow.user_id);
    if (!dbUser) return reply.code(401).send({ message: "Unauthorized" });

    const incomingTabId = parsed?.tab_id ?? null;
    const incomingUrl = parsed?.current_url ?? null;
    const sessionId = await createOrReplaceActiveSession({
      userId: dbUser.id,
      tabId: incomingTabId,
      currentUrl: incomingUrl,
    });

    await pool.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [tokenRow.id]);
    const rotated = await createRefreshToken(dbUser.id, refreshTtlDays);

    const publicUser = toPublicUser(dbUser);
    const token = await reply.jwtSign(
      { ...publicUser, session_id: sessionId },
      { expiresIn: accessTtl }
    );

    const isMobileClient =
      String((request.headers as Record<string, unknown>)[mobileClientHeader] ?? "").toLowerCase() ===
      mobileClientValue;

    if (!isMobileClient) {
      reply.setCookie(accessCookieName, token, {
        ...accessCookieOptions,
        maxAge: parseInt(accessTtl) * 60,
      });
      reply.setCookie(refreshCookieName, rotated.token, {
        ...refreshCookieOptions,
        maxAge: refreshTtlDays * 24 * 60 * 60,
      });
      return reply.send({ user: publicUser });
    }

    return reply.send({ token, user: publicUser, refresh_token: rotated.token });
  });

  server.post("/release", async (request, reply) => {
    const body = sessionTouchSchema.parse(request.body);
    try {
      const accessToken = request.cookies?.[accessCookieName];
      if (accessToken) {
        try {
          const decoded = await server.jwt.verify<{ id: string; session_id?: string | null }>(accessToken);
          if (decoded?.id && decoded.session_id) {
            await pool.query(
              `UPDATE users
               SET availability_status = 'OFFLINE',
                   updated_at = now(),
                   active_session_id = NULL,
                   active_session_seen_at = NULL,
                   active_session_tab_id = NULL,
                   active_session_url = NULL
               WHERE id = $1
                 AND active_session_id = $2
                 AND ($3::text IS NULL OR active_session_tab_id = $3)`,
              [decoded.id, decoded.session_id, body?.tab_id ?? null]
            );
            return reply.send({ ok: true });
          }
        } catch {
          // Fall through to refresh-token based cleanup below.
        }
      }

      const refreshToken = request.cookies?.[refreshCookieName];
      if (refreshToken && body?.tab_id) {
        const tokenHash = crypto.createHash("sha256").update(refreshToken).digest("hex");
        const tokenRes = await pool.query<{ user_id: string }>(
          "SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL",
          [tokenHash]
        );
        const refreshUserId = tokenRes.rows[0]?.user_id;
        if (refreshUserId) {
          await pool.query(
            `UPDATE users
             SET availability_status = 'OFFLINE',
                 updated_at = now(),
                 active_session_id = NULL,
                 active_session_seen_at = NULL,
                 active_session_tab_id = NULL,
                 active_session_url = NULL
             WHERE id = $1
               AND active_session_tab_id = $2`,
            [refreshUserId, body.tab_id]
          );
        }
      }
    } catch {
      return reply.send({ ok: true });
    }

    return reply.send({ ok: true });
  });

  server.post("/logout", async (request, reply) => {
    const parsed = refreshBodySchema.parse(request.body);
    const raw = request.cookies?.[refreshCookieName] ?? parsed?.refresh_token;

    // Best-effort: resolve user id from refresh token before revocation
    let refreshUserId: string | null = null;
    if (raw) {
      try {
        const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
        const res = await pool.query<{ user_id: string }>(
          "SELECT user_id FROM refresh_tokens WHERE token_hash = $1",
          [tokenHash]
        );
        refreshUserId = res.rows[0]?.user_id ?? null;
      } catch {
        refreshUserId = null;
      }
    }

    if (raw) {
      await revokeRefreshToken(raw);
    }

    // Best-effort: mark user offline if access token is valid
    try {
      const accessToken = request.cookies?.[accessCookieName];
      if (accessToken) {
        const decoded = await server.jwt.verify<{ id: string; session_id?: string | null }>(accessToken);
        if (decoded?.id) {
          await pool.query(
            `UPDATE users
             SET availability_status = 'OFFLINE',
                 updated_at = now(),
                 active_session_id = CASE WHEN active_session_id = $2 THEN NULL ELSE active_session_id END,
                 active_session_seen_at = CASE WHEN active_session_id = $2 THEN NULL ELSE active_session_seen_at END,
                 active_session_tab_id = CASE WHEN active_session_id = $2 THEN NULL ELSE active_session_tab_id END,
                 active_session_url = CASE WHEN active_session_id = $2 THEN NULL ELSE active_session_url END
             WHERE id = $1`,
            [decoded.id, decoded.session_id ?? null]
          );
        }
      }
      if (refreshUserId) {
        await pool.query("UPDATE users SET availability_status = 'OFFLINE', updated_at = now() WHERE id = $1", [refreshUserId]);
      }
    } catch {
      // Ignore logout status update failures
    }

    reply.clearCookie(accessCookieName, accessCookieOptions);
    reply.clearCookie(refreshCookieName, refreshCookieOptions);
    return reply.send({ ok: true });
  });

  server.post("/heartbeat", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = sessionTouchSchema.parse(request.body);
    const u = request.authUser!;
    await pool.query(
      `UPDATE users
       SET active_session_seen_at = now(),
           active_session_tab_id = COALESCE($2, active_session_tab_id),
           active_session_url = COALESCE($3, active_session_url)
       WHERE id = $1`,
      [u.id, body?.tab_id ?? null, normalizeSessionUrl(body?.current_url)]
    );
    return reply.send({ ok: true });
  });
};
