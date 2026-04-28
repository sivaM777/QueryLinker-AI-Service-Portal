import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../config/db.js";

export type UserRole = "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";

export interface DbUser {
  id: string;
  name: string;
  email: string;
  azure_ad_id?: string | null;
  password_hash: string;
  role: UserRole;
  team_id: string | null;
  organization_id: string | null;
  organization_name: string | null;
  organization_is_demo: boolean;
  phone: string | null;
  department: string | null;
  location: string | null;
  bio: string | null;
  avatar_url: string | null;
  availability_status: "ONLINE" | "BUSY" | "OFFLINE" | "ON_BREAK" | "AWAY" | null;
  max_concurrent_tickets: number | null;
  certifications: string[] | null;
  hire_date: string | null;
  active_session_id: string | null;
  created_at: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  team_id: string | null;
  organization_id: string | null;
  organization_name: string | null;
  organization_is_demo: boolean;
  phone: string | null;
  department: string | null;
  location: string | null;
  bio: string | null;
  avatar_url: string | null;
  availability_status: "ONLINE" | "BUSY" | "OFFLINE" | "ON_BREAK" | "AWAY" | null;
  max_concurrent_tickets: number | null;
  certifications: string[] | null;
  hire_date: string | null;
}

export const toPublicUser = (u: DbUser): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  team_id: u.team_id,
  organization_id: u.organization_id,
  organization_name: u.organization_name,
  organization_is_demo: Boolean(u.organization_is_demo),
  phone: u.phone,
  department: u.department,
  location: u.location,
  bio: u.bio,
  avatar_url: u.avatar_url,
  availability_status: u.availability_status,
  max_concurrent_tickets: u.max_concurrent_tickets,
  certifications: u.certifications,
  hire_date: u.hire_date,
});

export const findUserByEmail = async (email: string): Promise<DbUser | null> => {
  const res = await pool.query<DbUser>(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.azure_ad_id,
       u.password_hash,
       u.role,
       u.team_id,
       u.organization_id,
       o.name AS organization_name,
       COALESCE(o.is_demo, false) AS organization_is_demo,
       u.phone,
       u.department,
       u.location,
       u.bio,
       u.avatar_url,
       u.availability_status,
       u.max_concurrent_tickets,
       u.certifications,
       u.hire_date,
       u.active_session_id,
       u.created_at
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE lower(u.email) = lower($1)`,
    [email.toLowerCase()]
  );
  return res.rows[0] ?? null;
};

export const findUserById = async (id: string): Promise<DbUser | null> => {
  const res = await pool.query<DbUser>(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.azure_ad_id,
       u.password_hash,
       u.role,
       u.team_id,
       u.organization_id,
       o.name AS organization_name,
       COALESCE(o.is_demo, false) AS organization_is_demo,
       u.phone,
       u.department,
       u.location,
       u.bio,
       u.avatar_url,
       u.availability_status,
       u.max_concurrent_tickets,
       u.certifications,
       u.hire_date,
       u.active_session_id,
       u.created_at
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
    [id]
  );
  return res.rows[0] ?? null;
};

export const findUserByAzureAdId = async (azureAdId: string): Promise<DbUser | null> => {
  const res = await pool.query<DbUser>(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.azure_ad_id,
       u.password_hash,
       u.role,
       u.team_id,
       u.organization_id,
       o.name AS organization_name,
       COALESCE(o.is_demo, false) AS organization_is_demo,
       u.phone,
       u.department,
       u.location,
       u.bio,
       u.avatar_url,
       u.availability_status,
       u.max_concurrent_tickets,
       u.certifications,
       u.hire_date,
       u.active_session_id,
       u.created_at
     FROM users u
     LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.azure_ad_id = $1`,
    [azureAdId]
  );
  return res.rows[0] ?? null;
};

export const verifyPassword = async (password: string, passwordHash: string) => {
  return bcrypt.compare(password, passwordHash);
};

export const hashPassword = async (password: string) => {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
};

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export const createRefreshToken = async (userId: string, ttlDays: number) => {
  const raw = crypto.randomBytes(48).toString("base64url");
  const tokenHash = sha256(raw);

  const res = await pool.query<{ id: string }>(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval) RETURNING id",
    [userId, tokenHash, String(ttlDays)]
  );

  return {
    id: res.rows[0]!.id,
    token: raw,
  };
};

export const rotateRefreshToken = async (rawToken: string, ttlDays: number) => {
  const tokenHash = sha256(rawToken);

  const existing = await pool.query<{
    id: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    "SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = $1",
    [tokenHash]
  );

  const row = existing.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  await pool.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [row.id]);

  const next = await createRefreshToken(row.user_id, ttlDays);
  return { userId: row.user_id, token: next.token };
};

export const revokeRefreshToken = async (rawToken: string) => {
  const tokenHash = sha256(rawToken);
  await pool.query("UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1", [tokenHash]);
};
