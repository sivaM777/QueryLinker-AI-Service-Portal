import crypto from "crypto";
import { env } from "../../config/env.js";
import { pool } from "../../config/db.js";
import {
  findUserByAzureAdId,
  findUserByEmail,
  findUserById,
  hashPassword,
  type DbUser,
} from "../auth/auth.service.js";

type AzureIdTokenClaims = {
  aud?: string;
  exp?: number;
  iss?: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  oid?: string;
  sub?: string;
  tid?: string;
};

type AzureTokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  scope?: string;
  expires_in?: number;
};

const azureScope = ["openid", "profile", "email", "User.Read"].join(" ");

const getAzureConfig = () => {
  if (!env.AZURE_CLIENT_ID || !env.AZURE_CLIENT_SECRET || !env.AZURE_TENANT_ID || !env.AZURE_REDIRECT_URI) {
    const err = new Error("Azure SSO is not configured");
    (err as any).statusCode = 503;
    throw err;
  }

  const tenant = env.AZURE_TENANT_ID;
  const baseUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;

  return {
    clientId: env.AZURE_CLIENT_ID,
    clientSecret: env.AZURE_CLIENT_SECRET,
    redirectUri: env.AZURE_REDIRECT_URI,
    authorizeUrl: `${baseUrl}/authorize`,
    tokenUrl: `${baseUrl}/token`,
  };
};

const parseJwtPayload = <T>(jwt: string): T => {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new Error("Invalid ID token received from Azure");
  }
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as T;
};

const deriveEmail = (claims: AzureIdTokenClaims) => {
  return (claims.preferred_username || claims.email || "").trim().toLowerCase();
};

const deriveName = (claims: AzureIdTokenClaims, email: string) => {
  if (claims.name?.trim()) return claims.name.trim();
  if (email.includes("@")) {
    return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return "Azure User";
};

export const buildAzureAuthorizationUrl = (state: string) => {
  const config = getAzureConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: azureScope,
    state,
    prompt: "select_account",
  });
  return `${config.authorizeUrl}?${params.toString()}`;
};

export const exchangeAzureCode = async (code: string): Promise<AzureTokenResponse> => {
  const config = getAzureConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    scope: azureScope,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const err = new Error(`Azure token exchange failed: ${errorText}`);
    (err as any).statusCode = 502;
    throw err;
  }

  return (await response.json()) as AzureTokenResponse;
};

export const validateAzureIdToken = (idToken: string) => {
  const claims = parseJwtPayload<AzureIdTokenClaims>(idToken);
  const config = getAzureConfig();
  const email = deriveEmail(claims);
  const azureAdId = claims.oid || claims.sub || "";

  if (!email) {
    const err = new Error("Azure account email is not available");
    (err as any).statusCode = 400;
    throw err;
  }
  if (!azureAdId) {
    const err = new Error("Azure account identifier is missing");
    (err as any).statusCode = 400;
    throw err;
  }
  if (claims.aud !== config.clientId) {
    const err = new Error("Azure token audience mismatch");
    (err as any).statusCode = 401;
    throw err;
  }
  if (!claims.exp || claims.exp * 1000 <= Date.now()) {
    const err = new Error("Azure token has expired");
    (err as any).statusCode = 401;
    throw err;
  }
  if (!claims.iss?.includes("login.microsoftonline.com")) {
    const err = new Error("Azure token issuer is invalid");
    (err as any).statusCode = 401;
    throw err;
  }

  return {
    azureAdId,
    email,
    name: deriveName(claims, email),
  };
};

const createAzureProvisionedUser = async (args: {
  azureAdId: string;
  email: string;
  name: string;
}): Promise<DbUser> => {
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));

  const orgRes = await pool.query<{ id: string }>(
    "SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1"
  );
  const organizationId = orgRes.rows[0]?.id ?? null;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, azure_ad_id, password_hash, role, organization_id)
     VALUES ($1, $2, $3, $4, 'EMPLOYEE', $5)
     RETURNING id`,
    [args.name, args.email, args.azureAdId, passwordHash, organizationId]
  );

  const user = await findUserById(inserted.rows[0]!.id);
  if (!user) throw new Error("Azure user provisioning failed");
  return user;
};

export const resolveAzureUser = async (args: {
  azureAdId: string;
  email: string;
  name: string;
}): Promise<DbUser> => {
  const byAzureId = await findUserByAzureAdId(args.azureAdId);
  if (byAzureId) return byAzureId;

  const byEmail = await findUserByEmail(args.email);
  if (byEmail) {
    const updated = await pool.query<{ id: string }>(
      `UPDATE users
       SET azure_ad_id = $2,
           name = COALESCE(NULLIF(name, ''), $3),
           updated_at = now()
       WHERE id = $1
       RETURNING id`,
      [byEmail.id, args.azureAdId, args.name]
    );
    return (await findUserById(updated.rows[0]?.id ?? byEmail.id)) ?? byEmail;
  }

  return createAzureProvisionedUser(args);
};
