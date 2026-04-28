import { pool } from "../../config/db.js";

type SuggestTicketRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  category: string | null;
  created_at: string;
};

type SuggestKbRow = {
  id: string;
  title: string;
  snippet: string;
};

export interface SuggestForTextArgs {
  userId: string;
  text: string;
}

export interface SuggestForTextResult {
  related_incidents: SuggestTicketRow[];
  kb_suggestions: SuggestKbRow[];
  active_outages: { id: string; title: string; regions?: string[] }[];
}

export const suggestForText = async (
  args: SuggestForTextArgs
): Promise<SuggestForTextResult> => {
  const text = args.text.trim();
  if (!text) {
    return { related_incidents: [], kb_suggestions: [], active_outages: [] };
  }

  const like = `%${text.slice(0, 80)}%`;

  // Very lightweight "similar tickets" based on category + ILIKE on title/description
  const relatedTicketsRes = await pool.query<SuggestTicketRow>(
    `SELECT id, title, description, status, category, created_at
     FROM tickets
     WHERE status IN ('OPEN', 'IN_PROGRESS')
       AND (title ILIKE $1 OR description ILIKE $1)
     ORDER BY created_at DESC
     LIMIT 5`,
    [like]
  );

  // Simple KB suggestions using ILIKE on title / summary
  const kbRes = await pool.query<SuggestKbRow>(
    `SELECT id,
            title,
            LEFT(body, 220) AS snippet
     FROM kb_articles
     WHERE title ILIKE $1 OR body ILIKE $1
     ORDER BY updated_at DESC
     LIMIT 5`,
    [like]
  );

  return {
    related_incidents: relatedTicketsRes.rows,
    kb_suggestions: kbRes.rows,
    // For now, active outages are mocked but kept empty; wire real data later if needed.
    active_outages: [],
  };
};

