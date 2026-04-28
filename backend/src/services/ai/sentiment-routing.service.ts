// Sentiment-based ticket routing service
import { pool } from "../../config/db.js";

export interface SentimentAnalysis {
  score: number; // -1 to 1
  label: "NEGATIVE" | "NEUTRAL" | "POSITIVE";
  confidence: number;
  urgencyKeywords: string[];
  escalationRecommended: boolean;
}

// Keywords that indicate urgency/frustration
const URGENCY_KEYWORDS = [
  "urgent", "asap", "immediately", "critical", "emergency",
  "frustrated", "angry", "terrible", "horrible", "awful",
  "can't work", "blocked", "stopped", "down", "outage",
  "lost money", "losing money", "deadline", "due today",
  "fired", "losing job", "compensation", "lawsuit"
];

// Analyze sentiment from AI service or local heuristic
export async function analyzeSentiment(text: string, aiTier?: "free" | "premium"): Promise<SentimentAnalysis> {
  const lowerText = text.toLowerCase();
  
  // Check for urgency keywords
  const foundUrgency = URGENCY_KEYWORDS.filter(kw => lowerText.includes(kw));
  
  // Try AI service first
  const aiUrl = process.env.AI_CLASSIFIER_URL;
  if (aiUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch(aiUrl.replace('/predict', '/enrich'), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-tier": aiTier === "premium" ? "premium" : "free",
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      if (res.ok) {
        const data = await res.json();
        const sentimentScore = data.sentiment_score ?? 0;
        const sentimentLabel = data.sentiment_label ?? "NEUTRAL";
        
        // Determine if escalation is needed
        const escalationRecommended = 
          sentimentLabel === "NEGATIVE" && data.sentiment_score < -0.5 ||
          foundUrgency.length >= 2 ||
          (sentimentLabel === "NEGATIVE" && foundUrgency.length >= 1);
        
        return {
          score: sentimentScore,
          label: sentimentLabel,
          confidence: data.confidence ?? 0.7,
          urgencyKeywords: foundUrgency,
          escalationRecommended,
        };
      }
    } catch (err) {
      console.error("AI sentiment analysis failed:", err);
    }
  }
  
  // Fallback: local heuristic
  let score = 0;
  const negativeWords = ["bad", "terrible", "awful", "hate", "angry", "frustrated", "broken", "not working", "failed", "error", "issue", "problem"];
  const positiveWords = ["good", "great", "excellent", "love", "happy", "thanks", "working", "resolved", "fixed"];
  
  negativeWords.forEach(w => { if (lowerText.includes(w)) score -= 0.2; });
  positiveWords.forEach(w => { if (lowerText.includes(w)) score += 0.2; });
  
  // Cap at -1 to 1
  score = Math.max(-1, Math.min(1, score));
  
  let label: "NEGATIVE" | "NEUTRAL" | "POSITIVE" = "NEUTRAL";
  if (score < -0.3) label = "NEGATIVE";
  else if (score > 0.3) label = "POSITIVE";
  
  const escalationRecommended = label === "NEGATIVE" && score < -0.5 || foundUrgency.length >= 2;
  
  return {
    score,
    label,
    confidence: 0.6,
    urgencyKeywords: foundUrgency,
    escalationRecommended,
  };
}

// Route ticket based on sentiment
export async function routeTicketBySentiment(
  ticketId: string,
  sentiment: SentimentAnalysis
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    // Store sentiment analysis
    await client.query(
      `INSERT INTO ticket_sentiment_analysis (ticket_id, sentiment_score, sentiment_label, confidence, urgency_keywords, escalation_recommended)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (ticket_id) DO UPDATE SET
         sentiment_score = EXCLUDED.sentiment_score,
         sentiment_label = EXCLUDED.sentiment_label,
         confidence = EXCLUDED.confidence,
         urgency_keywords = EXCLUDED.urgency_keywords,
         escalation_recommended = EXCLUDED.escalation_recommended,
         analyzed_at = now()`,
      [
        ticketId,
        sentiment.score,
        sentiment.label,
        sentiment.confidence,
        sentiment.urgencyKeywords,
        sentiment.escalationRecommended,
      ]
    );
    
    // If escalation recommended, bump priority and notify
    if (sentiment.escalationRecommended) {
      // Get current ticket info
      const ticketRes = await client.query(
        `SELECT priority, status, assigned_to, team_id FROM tickets WHERE id = $1`,
        [ticketId]
      );
      
      if (ticketRes.rows.length > 0) {
        const ticket = ticketRes.rows[0];
        
        // Bump priority to HIGH if not already
        if (ticket.priority !== "HIGH" && ticket.priority !== "CRITICAL") {
          await client.query(
            `UPDATE tickets SET priority = 'HIGH', updated_at = now() WHERE id = $1`,
            [ticketId]
          );
          
          // Add escalation event
          await client.query(
            `INSERT INTO ticket_events (ticket_id, action, created_by, details)
             VALUES ($1, 'ESCALATED', $2, $3)`,
            [
              ticketId,
              ticket.assigned_to || null,
              JSON.stringify({
                reason: "Negative sentiment detected",
                sentiment_score: sentiment.score,
                urgency_keywords: sentiment.urgencyKeywords,
                previous_priority: ticket.priority,
              }),
            ]
          );
        }
        
        // If unassigned, assign to a manager or senior agent
        if (!ticket.assigned_to) {
          const managerRes = await client.query(
            `SELECT u.id FROM users u
             JOIN user_roles ur ON u.id = ur.user_id
             JOIN roles r ON ur.role_id = r.id
             WHERE r.name IN ('MANAGER', 'ADMIN', 'AGENT')
               AND u.availability_status = 'ONLINE'
             ORDER BY 
               CASE r.name WHEN 'MANAGER' THEN 1 WHEN 'ADMIN' THEN 2 ELSE 3 END,
               (SELECT COUNT(*) FROM tickets WHERE assigned_to = u.id AND status IN ('OPEN', 'IN_PROGRESS'))
             LIMIT 1`
          );
          
          if (managerRes.rows.length > 0) {
            await client.query(
              `UPDATE tickets SET assigned_to = $1, team_id = $2, status = 'IN_PROGRESS', updated_at = now() WHERE id = $3`,
              [managerRes.rows[0].id, ticket.team_id, ticketId]
            );
          }
        }
      }
    }
    
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to route ticket by sentiment:", err);
  } finally {
    client.release();
  }
}
