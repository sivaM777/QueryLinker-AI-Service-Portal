import { pool } from "../../config/db.js";

type SimilarTicketRow = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  status: string;
  created_at: string;
};

export interface FindSimilarTicketsArgs {
  category: string | null;
  text: string;
}

/**
 * Very lightweight ticket deduplication helper.
 *
 * For now we:
 * - look for tickets with the same category (if present)
 * - created recently (last 24h)
 * - that are still OPEN or IN_PROGRESS
 * - whose title or description is very similar (case-insensitive equality or simple ILIKE)
 *
 * This is intentionally conservative to avoid wrong merges.
 */
export async function findSimilarOpenTicket(
  args: FindSimilarTicketsArgs
): Promise<SimilarTicketRow | null> {
  const { category, text } = args;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const sqlParts: string[] = [
    "SELECT id, title, description, category, status, created_at",
    "FROM tickets",
    "WHERE created_at >= now() - interval '24 hours'",
    "AND status IN ('OPEN', 'IN_PROGRESS')",
  ];
  const values: any[] = [];
  let idx = 1;

  if (category) {
    sqlParts.push(`AND category = $${idx++}`);
    values.push(category);
  }

  // Simple similarity: exact normalized title match OR ILIKE on description.
  sqlParts.push(
    `AND (lower(title) = $${idx} OR description ILIKE '%' || $${idx} || '%')`,
  );
  values.push(normalized);

  sqlParts.push("ORDER BY created_at ASC");
  sqlParts.push("LIMIT 1");

  const res = await pool.query<SimilarTicketRow>(sqlParts.join(" "), values);
  return res.rows[0] ?? null;
}

