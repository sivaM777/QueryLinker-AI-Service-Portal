import { pool } from "../../config/db.js";
export type AiTier = "free" | "premium";

export const getOrganizationIdForUser = async (userId: string | null | undefined): Promise<string | null> => {
  if (!userId) return null;
  const res = await pool.query<{ organization_id: string | null }>(
    "SELECT organization_id FROM users WHERE id = $1",
    [userId]
  );
  return res.rows[0]?.organization_id ?? null;
};

export const resolveAiTier = async (args: {
  userId?: string | null;
  sessionId?: string | null;
  organizationId?: string | null;
}): Promise<{ tier: AiTier; organizationId: string | null }> => {
  // AI usage/pricing tiers are currently disabled at runtime.
  // We always operate in the free tier path and use provider-specific keys directly.
  if (args.organizationId) {
    return { tier: "free", organizationId: args.organizationId };
  }

  if (args.userId) {
    const orgId = await getOrganizationIdForUser(args.userId);
    return { tier: "free", organizationId: orgId };
  }

  if (args.sessionId) {
    const res = await pool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM chatbot_sessions WHERE id = $1",
      [args.sessionId]
    );
    return { tier: "free", organizationId: res.rows[0]?.organization_id ?? null };
  }

  return { tier: "free", organizationId: null };
};

export const incrementAiUsage = async (organizationId: string | null | undefined): Promise<void> => {
  // Pricing/usage tracking is intentionally disabled for now.
  return;
};
