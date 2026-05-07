import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../config/db.js";

export type UserRole = "EMPLOYEE" | "AGENT" | "MANAGER" | "ADMIN";

export interface PublicImpersonationContext {
  active: true;
  admin_user_id: string;
  admin_name: string;
  admin_email: string;
  admin_role: "ADMIN";
  started_at: string;
}

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
  impersonation?: PublicImpersonationContext | null;
}

export interface DbUserAuthState {
  user_id: string;
  failed_login_attempts: number;
  locked_until: string | null;
  must_rotate_password: boolean;
  last_password_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

let ensureUserAuthStatesTablePromise: Promise<void> | null = null;

const ensureUserAuthStatesTable = async (): Promise<void> => {
  if (!ensureUserAuthStatesTablePromise) {
    ensureUserAuthStatesTablePromise = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS user_auth_states (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          failed_login_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TIMESTAMPTZ NULL,
          must_rotate_password BOOLEAN NOT NULL DEFAULT false,
          last_password_reset_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_user_auth_states_locked_until
         ON user_auth_states (locked_until)`
      );

      await pool.query(
        `INSERT INTO user_auth_states (user_id)
         SELECT id FROM users
         ON CONFLICT (user_id) DO NOTHING`
      );
    })().catch((error) => {
      ensureUserAuthStatesTablePromise = null;
      throw error;
    });
  }

  await ensureUserAuthStatesTablePromise;
};

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

export const ensureUserAuthState = async (userId: string): Promise<DbUserAuthState> => {
  await ensureUserAuthStatesTable();

  await pool.query(
    `INSERT INTO user_auth_states (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const res = await pool.query<DbUserAuthState>(
    `SELECT user_id, failed_login_attempts, locked_until, must_rotate_password, last_password_reset_at, created_at, updated_at
     FROM user_auth_states
     WHERE user_id = $1`,
    [userId]
  );

  return res.rows[0]!;
};

export const registerFailedLoginAttempt = async (
  userId: string,
  args?: { lockThreshold?: number; lockMinutes?: number }
): Promise<DbUserAuthState> => {
  const lockThreshold = args?.lockThreshold ?? 5;
  const lockMinutes = args?.lockMinutes ?? 15;

  await ensureUserAuthState(userId);

  const res = await pool.query<DbUserAuthState>(
    `UPDATE user_auth_states
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
           ELSE locked_until
         END,
         updated_at = now()
     WHERE user_id = $1
     RETURNING user_id, failed_login_attempts, locked_until, must_rotate_password, last_password_reset_at, created_at, updated_at`,
    [userId, lockThreshold, String(lockMinutes)]
  );

  return res.rows[0]!;
};

export const clearUserAuthLock = async (userId: string): Promise<DbUserAuthState> => {
  await ensureUserAuthState(userId);

  const res = await pool.query<DbUserAuthState>(
    `UPDATE user_auth_states
     SET failed_login_attempts = 0,
         locked_until = NULL,
         updated_at = now()
     WHERE user_id = $1
     RETURNING user_id, failed_login_attempts, locked_until, must_rotate_password, last_password_reset_at, created_at, updated_at`,
    [userId]
  );

  return res.rows[0]!;
};

export const markPasswordRotated = async (userId: string): Promise<DbUserAuthState> => {
  await ensureUserAuthState(userId);

  const res = await pool.query<DbUserAuthState>(
    `UPDATE user_auth_states
     SET failed_login_attempts = 0,
         locked_until = NULL,
         must_rotate_password = true,
         last_password_reset_at = now(),
         updated_at = now()
     WHERE user_id = $1
     RETURNING user_id, failed_login_attempts, locked_until, must_rotate_password, last_password_reset_at, created_at, updated_at`,
    [userId]
  );

  return res.rows[0]!;
};

export const clearPasswordRotationFlag = async (userId: string): Promise<void> => {
  await ensureUserAuthState(userId);
  await pool.query(
    `UPDATE user_auth_states
     SET must_rotate_password = false,
         updated_at = now()
     WHERE user_id = $1`,
    [userId]
  );
};

export const revokeAllRefreshTokensForUser = async (userId: string): Promise<void> => {
  await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = now()
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [userId]
  );
};
