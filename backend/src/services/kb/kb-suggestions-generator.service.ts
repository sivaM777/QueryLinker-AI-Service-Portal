import { pool } from "../../config/db.js";
import { analyzeTicketTrends } from "./kb-trend.service.js";

export async function generateKbSuggestions(limit: number = 10): Promise<void> {
  const trends = await analyzeTicketTrends(limit);

  for (const t of trends) {
    // Avoid inserting duplicates if pattern already exists in pending/approved/created
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM kb_suggestions WHERE pattern = $1 AND status IN ('pending','approved','created') LIMIT 1`,
      [t.pattern]
    );
    if (existing.rows.length > 0) continue;

    await pool.query(
      `INSERT INTO kb_suggestions
        (pattern, frequency, suggested_title, suggested_body, related_ticket_ids, status)
       VALUES ($1, $2, $3, $4, $5::uuid[], 'pending')`,
      [t.pattern, t.frequency, t.suggestedArticleTitle, t.suggestedArticleBody, t.relatedTickets]
    );
  }
}

