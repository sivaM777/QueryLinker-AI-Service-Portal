import { env } from "./env.js";

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parseOrigins = (value?: string) =>
  (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const inferredOrigins = [env.FRONTEND_URL, env.PUBLIC_WEB_URL].filter(Boolean) as string[];

export const allowedOrigins = Array.from(
  new Set([
    ...inferredOrigins,
    ...parseOrigins(env.CORS_ALLOWED_ORIGINS),
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
  ])
);

export const resolveCorsOrigin = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (allowedOrigins.includes(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin not allowed: ${origin}`));
};

export const cookieSameSite = env.COOKIE_SAME_SITE;
export const cookieSecure = parseBoolean(
  env.COOKIE_SECURE,
  env.NODE_ENV === "production" || env.COOKIE_SAME_SITE === "none"
);
export const cookieDomain = env.COOKIE_DOMAIN || undefined;

const baseCookieOptions = {
  httpOnly: true,
  sameSite: cookieSameSite,
  secure: cookieSecure,
  domain: cookieDomain,
} as const;

export const accessCookieOptions = {
  ...baseCookieOptions,
  path: "/",
};

export const refreshCookieOptions = {
  ...baseCookieOptions,
  path: "/api/v1/auth",
};

export const oauthCookieOptions = {
  ...baseCookieOptions,
  sameSite: "lax" as const,
  path: "/api/v1/auth",
};
