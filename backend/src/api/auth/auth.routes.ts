import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import crypto from "crypto";
import {
  type DbUser,
  findUserByEmail,
  findUserById,
  type PublicImpersonationContext,
  verifyPassword,
  toPublicUser,
  createRefreshToken,
  revokeRefreshToken,
  ensureUserAuthState,
  registerFailedLoginAttempt,
  clearUserAuthLock,
} from "../../services/auth/auth.service.js";
import { requireAuth, requireRole } from "../../middlewares/auth.js";
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
const impersonatorCookieName = "impersonator_token";
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

const impersonateUserSchema = z.object({
  user_id: z.string().uuid(),
});

type ImpersonatorTokenPayload = {
  admin_id: string;
  admin_name: string;
  admin_email: string;
  admin_role: "ADMIN";
  impersonated_user_id: string;
  started_at: string;
};

const normalizeSessionUrl = (value?: string | null) => {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("/login")) return null;
  return trimmed;
};

const impersonatorCookieOptions = {
  ...refreshCookieOptions,
  path: "/api/v1/auth",
} as const;

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

const clearImpersonationCookie = (reply: any) => {
  reply.clearCookie(impersonatorCookieName, impersonatorCookieOptions);
};

const createPublicImpersonationContext = (
  admin: DbUser,
  startedAt: string
): PublicImpersonationContext => ({
  active: true,
  admin_user_id: admin.id,
  admin_name: admin.name,
  admin_email: admin.email,
  admin_role: "ADMIN",
  started_at: startedAt,
});

const serializePublicUser = (user: DbUser, impersonation?: PublicImpersonationContext | null) => {
  const publicUser = toPublicUser(user);
  return impersonation ? { ...publicUser, impersonation } : publicUser;
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

const issueImpersonationCookie = async (args: {
  reply: any;
  admin: DbUser;
  impersonatedUser: DbUser;
}) => {
  const startedAt = new Date().toISOString();
  const token = await args.reply.jwtSign(
    {
      admin_id: args.admin.id,
      admin_name: args.admin.name,
      admin_email: args.admin.email,
      admin_role: "ADMIN",
      impersonated_user_id: args.impersonatedUser.id,
      started_at: startedAt,
    } satisfies ImpersonatorTokenPayload,
    { expiresIn: `${refreshTtlDays}d` }
  );

  args.reply.setCookie(impersonatorCookieName, token, {
    ...impersonatorCookieOptions,
    maxAge: refreshTtlDays * 24 * 60 * 60,
  });

  return createPublicImpersonationContext(args.admin, startedAt);
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
  const resolveImpersonationContext = async (request: any, reply: any, currentUser: DbUser) => {
    const raw = request.cookies?.[impersonatorCookieName];
    if (!raw) return null;

    try {
      const payload = await server.jwt.verify<ImpersonatorTokenPayload>(raw);
      if (!payload?.admin_id || payload.admin_role !== "ADMIN" || payload.impersonated_user_id !== currentUser.id) {
        clearImpersonationCookie(reply);
        return null;
      }

      const admin = await findUserById(payload.admin_id);
      if (!admin || admin.role !== "ADMIN") {
        clearImpersonationCookie(reply);
        return null;
      }

      if (admin.organization_id && admin.organization_id !== currentUser.organization_id) {
        clearImpersonationCookie(reply);
        return null;
      }

      return createPublicImpersonationContext(admin, payload.started_at);
    } catch {
      clearImpersonationCookie(reply);
      return null;
    }
  };

  server.post("/demo-login", async (request, reply) => {
    const body = demoLoginSchema.parse(request.body);
    const demo = await ensureDemoWorkspace();
    const email = demo.roleEmails[body.role];
    const user = await findUserByEmail(email);
    if (!user) return reply.code(500).send({ message: "Demo user could not be created" });

    clearImpersonationCookie(reply);
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
      clearImpersonationCookie(reply);
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

    const authState = await ensureUserAuthState(user.id);
    const lockedUntilMs = authState.locked_until ? new Date(authState.locked_until).getTime() : null;
    if (lockedUntilMs && lockedUntilMs > Date.now()) {
      return reply.code(423).send({
        message: "Your account is temporarily locked due to repeated failed login attempts. Please wait 15 minutes or use the account unlock auto-fix.",
        locked_until: authState.locked_until,
      });
    }
    if (lockedUntilMs && lockedUntilMs <= Date.now()) {
      await clearUserAuthLock(user.id);
    }

    const ok = await verifyPassword(body.password, user.password_hash);
    if (!ok) {
      const failedState = await registerFailedLoginAttempt(user.id);
      if (failedState.locked_until && new Date(failedState.locked_until).getTime() > Date.now()) {
        return reply.code(423).send({
          message: "Your account has been locked for 15 minutes because of repeated failed login attempts.",
          locked_until: failedState.locked_until,
        });
      }
      return reply.code(401).send({ message: "Invalid credentials" });
    }

    await clearUserAuthLock(user.id);

    clearImpersonationCookie(reply);
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
      clearImpersonationCookie(reply);
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

    const impersonation = await resolveImpersonationContext(request, reply, dbUser);
    return reply.send(serializePublicUser(dbUser, impersonation));
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
    const impersonation = await resolveImpersonationContext(request, reply, dbUser);

    const incomingTabId = parsed?.tab_id ?? null;
    const incomingUrl = parsed?.current_url ?? null;
    const sessionId = await createOrReplaceActiveSession({
      userId: dbUser.id,
      tabId: incomingTabId,
      currentUrl: incomingUrl,
    });

    await pool.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [tokenRow.id]);
    const rotated = await createRefreshToken(dbUser.id, refreshTtlDays);

    const publicUser = serializePublicUser(dbUser, impersonation);
    const token = await reply.jwtSign(
      { ...toPublicUser(dbUser), session_id: sessionId },
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

  server.post("/impersonate", { preHandler: [requireAuth, requireRole(["ADMIN"])] }, async (request, reply) => {
    const body = impersonateUserSchema.parse(request.body);
    const requester = request.authUser!;
    const admin = await findUserById(requester.id);
    if (!admin || admin.role !== "ADMIN") {
      return reply.code(403).send({ message: "Only admins can impersonate users" });
    }

    if (admin.id === body.user_id) {
      return reply.code(400).send({ message: "You are already signed in as this user" });
    }

    const targetUser = await findUserById(body.user_id);
    if (!targetUser) {
      return reply.code(404).send({ message: "User not found" });
    }

    if (admin.organization_id && admin.organization_id !== targetUser.organization_id) {
      return reply.code(404).send({ message: "User not found" });
    }

    const impersonation = await issueImpersonationCookie({
      reply,
      admin,
      impersonatedUser: targetUser,
    });

    const { publicUser } = await issueBrowserSession({
      user: targetUser,
      reply,
      currentUrl: getRoleHomePath(targetUser.role),
    });

    return reply.send({ user: { ...publicUser, impersonation } });
  });

  server.post("/stop-impersonation", { preHandler: [requireAuth] }, async (request, reply) => {
    const raw = request.cookies?.[impersonatorCookieName];
    if (!raw) {
      return reply.code(400).send({ message: "No impersonation session is active" });
    }

    let payload: ImpersonatorTokenPayload;
    try {
      payload = await server.jwt.verify<ImpersonatorTokenPayload>(raw);
    } catch {
      clearImpersonationCookie(reply);
      return reply.code(401).send({ message: "Impersonation session has expired" });
    }

    const admin = await findUserById(payload.admin_id);
    if (!admin || admin.role !== "ADMIN") {
      clearImpersonationCookie(reply);
      return reply.code(401).send({ message: "Impersonation session is no longer valid" });
    }

    const currentRefreshToken = request.cookies?.[refreshCookieName];
    if (currentRefreshToken) {
      await revokeRefreshToken(currentRefreshToken);
    }

    clearImpersonationCookie(reply);
    const { publicUser } = await issueBrowserSession({
      user: admin,
      reply,
      currentUrl: getRoleHomePath(admin.role),
    });

    return reply.send({ user: publicUser });
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
    const impersonatorToken = request.cookies?.[impersonatorCookieName];

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

    if (impersonatorToken) {
      try {
        const payload = await server.jwt.verify<ImpersonatorTokenPayload>(impersonatorToken);
        if (payload?.admin_id) {
          await pool.query("UPDATE users SET availability_status = 'OFFLINE', updated_at = now() WHERE id = $1", [
            payload.admin_id,
          ]);
        }
      } catch {
        // Ignore invalid impersonation cookies during logout cleanup.
      }
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
    clearImpersonationCookie(reply);
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
