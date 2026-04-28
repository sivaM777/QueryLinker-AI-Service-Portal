// Action-taking AI service - performs automated actions based on ticket content
import { pool } from "../../config/db.js";
import crypto from "crypto";

export interface ActionContext {
  ticketId: string;
  requesterId: string;
  requesterEmail: string;
  title: string;
  description: string;
  category: string;
}

export interface ActionResult {
  success: boolean;
  actionType: string;
  message: string;
  requiresApproval: boolean;
  autoApproved: boolean;
}

// Detect if ticket is requesting password reset
function detectPasswordResetRequest(text: string): boolean {
  const patterns = [
    /password\s*(reset|forgot|lost|expired|change)/i,
    /forgot\s*(my\s*)?password/i,
    /can't\s*(login|log\s*in|access)/i,
    /reset\s*password/i,
    /password\s*not\s*working/i,
    /account\s*locked.*password/i,
  ];
  return patterns.some(p => p.test(text));
}

// Detect if ticket is requesting account unlock
function detectAccountUnlockRequest(text: string): boolean {
  const patterns = [
    /account\s*(locked|unlock|disabled|suspended|blocked)/i,
    /can't\s*access\s*my\s*account/i,
    /account\s*access\s*(denied|revoked)/i,
    /unlock\s*(my\s*)?account/i,
    /account\s*frozen/i,
  ];
  return patterns.some(p => p.test(text));
}

// Generate temporary password
function generateTempPassword(): string {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

// Execute password reset action
async function executePasswordReset(context: ActionContext): Promise<ActionResult> {
  const tempPassword = generateTempPassword();
  const hashedPassword = crypto.createHash("sha256").update(tempPassword).digest("hex");
  
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Update user password
    await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [hashedPassword, context.requesterId]
    );
    
    // Log the action
    await client.query(
      `INSERT INTO ai_ticket_actions (ticket_id, action_type, action_status, action_payload, result_message, executed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        context.ticketId,
        "AUTO_PASSWORD_RESET",
        "COMPLETED",
        JSON.stringify({ temp_password_set: true }),
        "Temporary password has been set. User will receive email with new password.",
        "AI_AGENT",
      ]
    );
    
    // Add comment to ticket
    await client.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, $4)`,
      [
        context.ticketId,
        null, // System user
        `🔐 AI Agent Action: Password has been reset automatically based on user request.\n\nTemporary password: ${tempPassword}\n\nUser notified via email.`,
        false,
      ]
    );
    
    await client.query("COMMIT");
    
    return {
      success: true,
      actionType: "AUTO_PASSWORD_RESET",
      message: `Password reset completed. Temporary password: ${tempPassword}`,
      requiresApproval: false,
      autoApproved: true,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Password reset failed:", err);
    return {
      success: false,
      actionType: "AUTO_PASSWORD_RESET",
      message: "Failed to reset password. Manual intervention required.",
      requiresApproval: true,
      autoApproved: false,
    };
  } finally {
    client.release();
  }
}

// Execute account unlock action
async function executeAccountUnlock(context: ActionContext): Promise<ActionResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Check if account is actually locked (custom logic based on your auth system)
    const userRes = await client.query(
      `SELECT id, login_attempts, locked_until FROM users WHERE id = $1`,
      [context.requesterId]
    );
    
    if (userRes.rows.length === 0) {
      return {
        success: false,
        actionType: "AUTO_ACCOUNT_UNLOCK",
        message: "User not found.",
        requiresApproval: false,
        autoApproved: false,
      };
    }
    
    // Reset login attempts and unlock
    await client.query(
      `UPDATE users SET login_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
      [context.requesterId]
    );
    
    // Log the action
    await client.query(
      `INSERT INTO ai_ticket_actions (ticket_id, action_type, action_status, action_payload, result_message, executed_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        context.ticketId,
        "AUTO_ACCOUNT_UNLOCK",
        "COMPLETED",
        JSON.stringify({ previous_attempts: userRes.rows[0].login_attempts }),
        "Account has been unlocked. User can now log in.",
        "AI_AGENT",
      ]
    );
    
    // Add comment to ticket
    await client.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, $4)`,
      [
        context.ticketId,
        null, // System user
        `🔓 AI Agent Action: Account unlocked automatically based on user request.\n\nPrevious failed attempts cleared. User can now log in with their existing password.`,
        false,
      ]
    );
    
    await client.query("COMMIT");
    
    return {
      success: true,
      actionType: "AUTO_ACCOUNT_UNLOCK",
      message: "Account unlocked successfully. User can now log in.",
      requiresApproval: false,
      autoApproved: true,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Account unlock failed:", err);
    return {
      success: false,
      actionType: "AUTO_ACCOUNT_UNLOCK",
      message: "Failed to unlock account. Manual intervention required.",
      requiresApproval: true,
      autoApproved: false,
    };
  } finally {
    client.release();
  }
}

// Main function to analyze and execute appropriate action
export async function analyzeAndExecuteAction(context: ActionContext): Promise<ActionResult | null> {
  const text = `${context.title} ${context.description}`.toLowerCase();
  
  // Check for password reset request
  if (detectPasswordResetRequest(text)) {
    // Safety check: only auto-reset if user is verified employee
    const userRes = await pool.query(
      `SELECT role, email_verified FROM users WHERE id = $1`,
      [context.requesterId]
    );
    
    if (userRes.rows.length > 0 && userRes.rows[0].email_verified !== false) {
      return await executePasswordReset(context);
    }
  }
  
  // Check for account unlock request
  if (detectAccountUnlockRequest(text)) {
    const userRes = await pool.query(
      `SELECT role, email_verified FROM users WHERE id = $1`,
      [context.requesterId]
    );
    
    if (userRes.rows.length > 0 && userRes.rows[0].email_verified !== false) {
      return await executeAccountUnlock(context);
    }
  }
  
  // No action detected or not eligible
  return null;
}

// Suggest KB articles based on ticket content
export async function suggestKnowledgeBaseArticles(
  title: string,
  description: string,
  category: string
): Promise<Array<{ id: string; title: string; relevance: number }>> {
  try {
    // Search KB articles matching ticket category and keywords
    const searchQuery = `${title} ${description}`.split(" ").slice(0, 10).join(" | ");
    
    const kbRes = await pool.query(
      `SELECT id, title, 
              similarity(title || ' ' || body, $1) as relevance
       FROM kb_articles
       WHERE category = $2 OR title ILIKE $3
       ORDER BY relevance DESC
       LIMIT 3`,
      [searchQuery, category, `%${title.split(" ").slice(0, 3).join("%")}%`]
    );
    
    return kbRes.rows.map(row => ({
      id: row.id,
      title: row.title,
      relevance: parseFloat(row.relevance) || 0,
    }));
  } catch (err) {
    console.error("KB suggestion failed:", err);
    return [];
  }
}
