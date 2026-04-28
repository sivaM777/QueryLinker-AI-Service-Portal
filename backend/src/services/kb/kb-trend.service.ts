import { pool } from "../../config/db.js";

export interface KbTrend {
  pattern: string;
  frequency: number;
  suggestedArticleTitle: string;
  suggestedArticleBody: string;
  relatedTickets: string[];
}

/**
 * Analyze ticket patterns to suggest KB articles
 */
export async function analyzeTicketTrends(limit: number = 10): Promise<KbTrend[]> {
  // Prefer resolved tickets that have structured resolution data
  const ticketsResult = await pool.query<{
    id: string;
    title: string;
    description: string;
    category: string | null;
    status: string;
    created_at: string;
    resolution_summary: string | null;
    symptoms: string | null;
    root_cause: string | null;
    steps_performed: string | null;
    workflow_steps: { step_index: number; step_description: string }[] | null;
  }>(
    `SELECT
       t.id, t.title, t.description, t.category, t.status, t.created_at,
       tr.resolution_summary, tr.symptoms, tr.root_cause, tr.steps_performed,
       COALESCE(
         (SELECT array_agg(
           json_build_object('step_index', wes.step_index, 'step_description', wes.step_description)
           ORDER BY wes.step_index
         )
         FROM workflow_execution_steps wes
         JOIN workflow_executions we ON we.id = wes.execution_id
         WHERE we.ticket_id = t.id AND we.status = 'completed' AND wes.success = true
         ),
         NULL
       ) as workflow_steps
     FROM tickets t
     LEFT JOIN LATERAL (
       SELECT resolution_summary, symptoms, root_cause, steps_performed
       FROM ticket_resolutions
       WHERE ticket_id = t.id
       ORDER BY created_at DESC
       LIMIT 1
     ) tr ON true
     WHERE t.description IS NOT NULL AND t.description != ''
       AND t.status IN ('RESOLVED','CLOSED')
     ORDER BY t.created_at DESC
     LIMIT 1000`
  );

  const tickets = ticketsResult.rows;

  // Simple pattern extraction (in production, use NLP/ML)
  const patterns = new Map<string, {
    frequency: number;
    tickets: string[];
    titles: string[];
    descriptions: string[];
    resolutionSummaries: string[];
    symptoms: string[];
    rootCauses: string[];
    stepsPerformed: string[];
  }>();

  for (const ticket of tickets) {
    // Extract keywords/phrases (simplified)
    const words = ticket.description.toLowerCase().split(/\s+/);
    const phrases: string[] = [];

    // Extract 2-3 word phrases
    for (let i = 0; i < words.length - 1; i++) {
      phrases.push(`${words[i]} ${words[i + 1]}`);
      if (i < words.length - 2) {
        phrases.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
      }
    }

    // Count phrase frequencies
    for (const phrase of phrases) {
      if (phrase.length > 10 && phrase.length < 50) {
        // Filter out very short or very long phrases
        const existing = patterns.get(phrase) || {
          frequency: 0,
          tickets: [],
          titles: [],
          descriptions: [],
          resolutionSummaries: [],
          symptoms: [],
          rootCauses: [],
          stepsPerformed: [],
        };

        existing.frequency++;
        existing.tickets.push(ticket.id);
        existing.titles.push(ticket.title);
        existing.descriptions.push(ticket.description);

        if (ticket.resolution_summary) existing.resolutionSummaries.push(ticket.resolution_summary);
        if (ticket.symptoms) existing.symptoms.push(ticket.symptoms);
        if (ticket.root_cause) existing.rootCauses.push(ticket.root_cause);
        if (ticket.steps_performed) existing.stepsPerformed.push(ticket.steps_performed);

        patterns.set(phrase, existing);
      }
    }
  }

  // Convert to trends and filter
  const trends: KbTrend[] = [];

  for (const [pattern, data] of patterns.entries()) {
    if (data.frequency >= 3) {
      // Only suggest if pattern appears 3+ times
      const mostCommonTitle = findMostCommon(data.titles);
      const mostCommonDescription = findMostCommon(data.descriptions);

      const resolutionSummary = data.resolutionSummaries.length > 0 ? findMostCommon(data.resolutionSummaries) : "";
      const symptoms = data.symptoms.length > 0 ? findMostCommon(data.symptoms) : "";
      const rootCause = data.rootCauses.length > 0 ? findMostCommon(data.rootCauses) : "";
      const stepsPerformed = data.stepsPerformed.length > 0 ? findMostCommon(data.stepsPerformed) : "";

      // For auto-resolved tickets, use workflow steps if available
      const workflowStepsText = data.tickets.length > 0 ? (() => {
        const ticket = tickets.find(t => t.id === data.tickets[0]);
        if (ticket?.workflow_steps && ticket.workflow_steps.length > 0) {
          return ticket.workflow_steps
            .sort((a, b) => a.step_index - b.step_index)
            .map((step, idx) => `${idx + 1}. ${step.step_description}`)
            .join('\n');
        }
        return null;
      })() : null;

      // Use workflow steps if available, otherwise fall back to manual steps
      const finalSteps = workflowStepsText || stepsPerformed || resolutionSummary || mostCommonDescription.substring(0, 500);

      const suggestedBody =
        `Problem\n` +
        `${mostCommonTitle}\n\n` +
        `Symptoms\n` +
        `${symptoms || pattern}\n\n` +
        `Cause\n` +
        `${rootCause || "Not confirmed. See notes below."}\n\n` +
        `Resolution Steps\n` +
        `${finalSteps}\n\n` +
        `Notes / Prevention\n` +
        `If the issue repeats, collect logs/screenshots and verify the user/device is compliant with corporate policy.`;

      trends.push({
        pattern,
        frequency: data.frequency,
        suggestedArticleTitle: `How to resolve: ${mostCommonTitle}`,
        suggestedArticleBody: suggestedBody,
        relatedTickets: data.tickets.slice(0, 10), // Limit to 10 related tickets
      });
    }
  }

  // Sort by frequency and return top N
  return trends
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit);
}

/**
 * Get KB article suggestions for a ticket
 */
export async function getKbSuggestionsForTicket(
  ticketId: string
): Promise<Array<{ id: string; title: string; relevance: number }>> {
  // Get ticket details
  const ticketResult = await pool.query<{
    title: string;
    description: string;
    category: string | null;
  }>("SELECT title, description, category FROM tickets WHERE id = $1", [ticketId]);

  if (ticketResult.rows.length === 0) {
    return [];
  }

  const ticket = ticketResult.rows[0];
  const searchText = `${ticket.title} ${ticket.description}`;

  // Search KB articles using full-text search
  const kbResult = await pool.query<{ id: string; title: string; relevance: number }>(
    `SELECT 
       id, title,
       ts_rank(
         to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')),
         plainto_tsquery('english', $1)
       ) as relevance
     FROM kb_articles
     WHERE 
       to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')) 
       @@ plainto_tsquery('english', $1)
     ORDER BY relevance DESC
     LIMIT 5`,
    [searchText]
  );

  return kbResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    relevance: typeof row.relevance === 'string' ? parseFloat(row.relevance) || 0 : (row.relevance as number) || 0,
  }));
}

/**
 * Find most common string in array
 */
function findMostCommon(strings: string[]): string {
  const counts = new Map<string, number>();
  for (const str of strings) {
    counts.set(str, (counts.get(str) || 0) + 1);
  }

  let maxCount = 0;
  let mostCommon = strings[0] || "";

  for (const [str, count] of counts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = str;
    }
  }

  return mostCommon;
}
