import { pool } from "../../config/db.js";
import type { EmailJobData } from "./email-queue.js";

export interface EmailProcessingResult {
  success: boolean;
  ticketId?: string;
  error?: string;
}

async function generateDisplayNumber(
  client: any,
  category: string
): Promise<string> {
  const result = await client.query(
    `SELECT generate_display_number($1) as display_number`,
    [category]
  );
  return result.rows[0].display_number;
}

export async function processEmailToTicket(
  emailSourceId: string,
  rawEmail: EmailJobData["rawEmail"]
): Promise<EmailProcessingResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Check for duplicates using message-id
    const existingCheck = await client.query(
      `SELECT id FROM tickets WHERE email_message_id = $1 LIMIT 1`,
      [rawEmail.messageId]
    );

    if (existingCheck.rows.length > 0) {
      console.log(`[EmailProcessor] Duplicate email skipped: ${rawEmail.messageId}`);
      return { success: true, error: "Duplicate email - already processed" };
    }

    // 2. Get email source configuration
    const sourceRes = await client.query(
      `SELECT es.*, er.routing_rule_id, er.default_team_id, er.default_priority
       FROM email_sources es
       LEFT JOIN email_routing er ON es.id = er.email_source_id
       WHERE es.id = $1 AND es.is_enabled = true`,
      [emailSourceId]
    );

    if (sourceRes.rows.length === 0) {
      throw new Error(`Email source ${emailSourceId} not found or disabled`);
    }

    const source = sourceRes.rows[0];

    // 3. Find or create user based on sender email
    const senderEmail = rawEmail.from.toLowerCase().trim();
    let userRes = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [senderEmail]
    );

    let userId: string;
    if (userRes.rows.length === 0) {
      // Create guest user for unknown sender
      const newUser = await client.query(
        `INSERT INTO users (email, name, role, password_hash)
         VALUES ($1, $2, 'EMPLOYEE', 'external_auth')
         RETURNING id`,
        [senderEmail, senderEmail.split("@")[0]]
      );
      userId = newUser.rows[0].id;
    } else {
      userId = userRes.rows[0].id;
    }

    // 4. Call AI classifier for categorization
    let category = source.default_category || "OTHER";
    let priority = source.default_priority || "MEDIUM";
    let aiConfidence = 0;

    try {
      const aiUrl = process.env.AI_CLASSIFIER_URL;
      if (aiUrl) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const aiRes = await fetch(aiUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "x-ai-tier": (process.env.AI_TIER || "free").toLowerCase() },
          body: JSON.stringify({
            text: `${rawEmail.subject}\n\n${rawEmail.text}`,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (aiRes.ok) {
          const aiData = await aiRes.json();
          if (aiData.category) category = aiData.category;
          if (aiData.priority) priority = aiData.priority;
          if (aiData.confidence) aiConfidence = aiData.confidence;
        }
      }
    } catch (aiError) {
      console.error("[EmailProcessor] AI classification failed:", aiError);
      // Continue with defaults
    }

    // 5. Generate ticket number
    const displayNumber = await generateDisplayNumber(client, category);

    // 6. Create the ticket
    const ticketRes = await client.query(
      `INSERT INTO tickets (
        title, description, status, priority, category, requester_id,
        team_id, source, email_message_id, email_source_id,
        ai_confidence, display_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        rawEmail.subject || "(No subject)",
        rawEmail.text || rawEmail.html || "(No content)",
        "OPEN",
        priority,
        category,
        userId,
        source.default_team_id,
        "EMAIL",
        rawEmail.messageId,
        emailSourceId,
        aiConfidence,
        displayNumber,
      ]
    );

    const ticketId = ticketRes.rows[0].id;

    // 7. Store attachments if any
    if (rawEmail.attachments && rawEmail.attachments.length > 0) {
      for (const attachment of rawEmail.attachments) {
        await client.query(
          `INSERT INTO ticket_attachments (
            ticket_id, filename, content_type, size_bytes, content
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            ticketId,
            attachment.filename,
            attachment.contentType,
            attachment.content.length,
            attachment.content,
          ]
        );
      }
    }

    await client.query("COMMIT");

    console.log(`[EmailProcessor] Ticket created: ${displayNumber} (${ticketId})`);

    return {
      success: true,
      ticketId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[EmailProcessor] Error processing email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    client.release();
  }
}
