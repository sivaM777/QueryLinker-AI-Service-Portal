import { pool } from "../../config/db.js";
import { env } from "../../config/env.js";
import { createTicket } from "../tickets/ticket.service.js";
import { findUserByEmail } from "../auth/auth.service.js";
import crypto from "crypto";
import { getOrganizationIdForUser } from "../ai/tier-routing.service.js";
import {
  assessTicketReadiness,
  extractTicketFromConversation,
  generateGroqRoleBasedChat,
} from "../ai/groq.service.js";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  intent?: string;
  confidence?: number;
  kbArticlesSuggested?: string[];
  ticketCreatedId?: string;
  autoResolved?: boolean;
  createdAt: Date;
}

function generateRuleBasedResponseForRole(role: AudienceRole, intent: string, userMessage: string): string {
  if (intent === "greeting") {
    if (role === "ADMIN") {
      return "Hi — I’m here and ready to help with workflows, routing, governance, reports, or platform settings. What would you like to work on?";
    }
    if (role === "MANAGER") {
      return "Hi — happy to help. We can look at team workload, SLA risks, escalations, approvals, or ticket status. What do you want to check?";
    }
    if (role === "AGENT") {
      return "Hi — I’m ready to help with triage, troubleshooting, draft replies, priorities, or next steps on a ticket. What are you working on?";
    }
    return "Hi — I’m here to help. Tell me what’s going wrong, ask a question, or describe an issue and I’ll guide you through it.";
  }

  if (role === "AGENT") {
    const agentResponses: Record<string, string> = {
      security_incident:
        "Security triage checklist:\n\n1) Confirm user impacted + scope (single user vs org-wide)\n2) Collect indicators (sender, URL, hashes, screenshots)\n3) Containment: isolate device if needed, reset creds, revoke sessions\n4) Escalate to Security team and tag as HIGH\n\nWhat evidence do we have (email headers, URL, endpoint alerts)?",
      vpn_access:
        "VPN triage:\n\n1) Confirm location (on-net/off-net) and ISP stability\n2) Identify VPN client + version and error message\n3) Check account status (locked/expired) and MFA\n4) Check known outages and gateway health\n\nReply with the exact VPN error and whether the user can browse the internet normally.",
      password_reset:
        "Agent flow for password reset:\n\n1) Verify identity (per policy)\n2) Reset password / force change at next login\n3) Confirm MFA enrollment\n4) Check lockout status and clear if needed\n\nDo you want me to draft the steps for your environment (AD/LDAP/SSO)?",
      create_ticket:
        "You’re already in the service desk context. Share the key details (impact, urgency, environment, repro steps, error codes). I’ll suggest categorization, priority, and next actions.",
      general_query:
        "Agent assistant ready. Ask for:\n\n- Triage questions to ask the user\n- Suggested category/priority\n- KB suggestions\n- Next-step troubleshooting\n- Escalation criteria\n\nWhat ticket are you working on?",
    };
    return agentResponses[intent] || agentResponses.general_query;
  }

  if (role === "ADMIN") {
    const adminResponses: Record<string, string> = {
      security_incident:
        "Admin/security governance guidance:\n\n1) Confirm incident classification + severity\n2) Ensure notifications/escalation paths are active\n3) Validate audit logging and retention\n4) Review access controls and recent privileged changes\n\nWhat area are you investigating (identity, endpoint, email, network)?",
      general_query:
        "Admin assistant ready. Ask me about:\n\n- Users/Teams/Role access\n- Routing rules and SLA policy\n- Workflow automation\n- Reports/analytics\n- Integrations and settings\n\nWhat do you want to configure or review?",
      create_ticket:
        "Admins typically don’t create end-user tickets from chat. Tell me what you’re trying to achieve (policy, routing, workflow, users/teams, reports) and I’ll guide you.",
    };
    return adminResponses[intent] || adminResponses.general_query;
  }

  if (role === "MANAGER") {
    const managerResponses: Record<string, string> = {
      security_incident:
        "Manager guidance:\n\n1) Check team workload and availability\n2) Assign high-priority incidents to available agents\n3) Monitor SLA compliance\n4) Ensure proper communication with stakeholders\n\nHow can I assist with team management?",
      general_query:
        "Manager assistant ready. Ask me about:\n\n- Team performance metrics\n- SLA breaches and risks\n- Pending approvals\n- Ticket distribution\n\nWhat would you like to review?",
      create_ticket:
        "Managers can create tickets, but usually oversee them. Provide details if you need to create one, or ask about team workload.",
    };
    return managerResponses[intent] || managerResponses.general_query;
  }

  return generateRuleBasedResponse(intent, userMessage);
}

export interface ChatSession {
  id: string;
  userId: string | null;
  sessionToken: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  metadata: Record<string, any> | null;
  organization_id?: string | null;
}

type AudienceRole = "EMPLOYEE" | "AGENT" | "ADMIN" | "MANAGER";

type ChatSessionRow = ChatSession & { user_id?: string | null };

export interface ChatSessionListItem {
  id: string;
  sessionToken: string;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  title: string;
  preview: string | null;
  isPinned: boolean;
  isArchived: boolean;
}

export interface ChatbotKbArticle {
  id: string;
  title: string;
  body: string;
  category?: string;
  relevance?: number;
}

export interface ChatTicketReadiness {
  ready: boolean;
  missingFields: string[];
  guidance: string;
}

export async function createChatSession(
  userId: string | null,
  metadata?: Record<string, any> | null
): Promise<ChatSession> {
  const newToken = crypto.randomBytes(32).toString("hex");
  const organizationId = await getOrganizationIdForUser(userId);
  const result = await pool.query<ChatSession>(
    `INSERT INTO chatbot_sessions (user_id, session_token, organization_id, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING
       id,
       user_id AS "userId",
       session_token AS "sessionToken",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       last_activity_at AS "lastActivityAt",
       metadata,
       organization_id`,
    [userId, newToken, organizationId, metadata ? JSON.stringify(metadata) : null]
  );

  return result.rows[0];
}

/**
 * Create or get chatbot session
 */
export async function getOrCreateSession(
  userId: string | null,
  sessionToken?: string
): Promise<ChatSession> {
  if (sessionToken) {
    const result = await pool.query<ChatSessionRow>(
      `SELECT
         id,
         user_id AS "userId",
         session_token AS "sessionToken",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         last_activity_at AS "lastActivityAt",
         metadata,
         organization_id
       FROM chatbot_sessions
       WHERE session_token = $1`,
      [sessionToken]
    );

    if (result.rows.length > 0) {
      let session = result.rows[0];
      if (userId && session.userId && session.userId !== userId) {
        // Never allow a stored token from another logged-in user to attach here.
      } else if (userId || !session.userId) {
        if (userId && !session.userId) {
          const organizationId = await getOrganizationIdForUser(userId);
          const claimResult = await pool.query<ChatSession>(
            `UPDATE chatbot_sessions
             SET
               user_id = $2,
               organization_id = COALESCE(organization_id, $3),
               updated_at = now()
             WHERE id = $1
             RETURNING
               id,
               user_id AS "userId",
               session_token AS "sessionToken",
               created_at AS "createdAt",
               updated_at AS "updatedAt",
               last_activity_at AS "lastActivityAt",
               metadata,
               organization_id`,
            [session.id, userId, organizationId]
          );
          session = claimResult.rows[0] ?? session;
        } else if (userId && !session.organization_id) {
          const organizationId = await getOrganizationIdForUser(userId);
          if (organizationId) {
            await pool.query(
              "UPDATE chatbot_sessions SET organization_id = $2 WHERE id = $1 AND organization_id IS NULL",
              [session.id, organizationId]
            );
          }
        }
        return session;
      }
    }
  }

  return createChatSession(userId);
}

export async function getSessionForUser(sessionId: string, userId: string): Promise<ChatSession | null> {
  const result = await pool.query<ChatSession>(
    `SELECT
       id,
       user_id AS "userId",
       session_token AS "sessionToken",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       last_activity_at AS "lastActivityAt",
       metadata,
       organization_id
     FROM chatbot_sessions
     WHERE id = $1
       AND user_id = $2`,
    [sessionId, userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Get session messages
 */
export async function getSessionMessages(
  sessionId: string,
  userId: string,
  limit: number = 50
): Promise<ChatMessage[]> {
  const session = await getSessionForUser(sessionId, userId);
  if (!session) {
    const err = new Error("Chat session not found");
    (err as any).statusCode = 404;
    throw err;
  }

  const result = await pool.query<ChatMessage>(
    `SELECT
       id,
       session_id AS "sessionId",
       role,
       content,
       intent,
       confidence,
       kb_articles_suggested AS "kbArticlesSuggested",
       ticket_created_id AS "ticketCreatedId",
       auto_resolved AS "autoResolved",
       created_at AS "createdAt"
     FROM chatbot_messages 
     WHERE session_id = $1 
     ORDER BY created_at ASC 
     LIMIT $2`,
    [sessionId, limit]
  );
  return result.rows;
}

/**
 * Save message to session
 */
export async function saveMessage(args: {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  intent?: string;
  confidence?: number;
  kbArticlesSuggested?: string[];
  ticketCreatedId?: string;
  autoResolved?: boolean;
}): Promise<ChatMessage> {
  const result = await pool.query<ChatMessage>(
    `INSERT INTO chatbot_messages 
     (session_id, role, content, intent, confidence, kb_articles_suggested, ticket_created_id, auto_resolved)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING
       id,
       session_id AS "sessionId",
       role,
       content,
       intent,
       confidence,
       kb_articles_suggested AS "kbArticlesSuggested",
       ticket_created_id AS "ticketCreatedId",
       auto_resolved AS "autoResolved",
       created_at AS "createdAt"`,
    [
      args.sessionId,
      args.role,
      args.content,
      args.intent || null,
      args.confidence || null,
      args.kbArticlesSuggested || null,
      args.ticketCreatedId || null,
      args.autoResolved || false,
    ]
  );

  await updateSessionMetadataAfterMessage({
    sessionId: args.sessionId,
    role: args.role,
    content: args.content,
  });

  return result.rows[0];
}

export async function listChatSessionsForUser(
  userId: string,
  limit: number = 20,
  includeArchived: boolean = false
): Promise<ChatSessionListItem[]> {
  const result = await pool.query<ChatSessionListItem>(
    `SELECT
       s.id,
       s.session_token AS "sessionToken",
       s.created_at AS "createdAt",
       s.updated_at AS "updatedAt",
       s.last_activity_at AS "lastActivityAt",
       COALESCE(s.metadata ->> 'title', 'New conversation') AS title,
       COALESCE((s.metadata ->> 'pinned')::boolean, false) AS "isPinned",
       COALESCE((s.metadata ->> 'archived')::boolean, false) AS "isArchived",
       (
         SELECT LEFT(m.content, 140)
         FROM chatbot_messages m
         WHERE m.session_id = s.id
           AND m.role = 'user'
         ORDER BY m.created_at DESC
         LIMIT 1
       ) AS preview
     FROM chatbot_sessions s
     WHERE s.user_id = $1
       AND ($3::boolean OR COALESCE((s.metadata ->> 'archived')::boolean, false) = false)
     ORDER BY
       COALESCE((s.metadata ->> 'pinned')::boolean, false) DESC,
       s.last_activity_at DESC NULLS LAST,
       s.updated_at DESC
     LIMIT $2`,
    [userId, limit, includeArchived]
  );

  return result.rows;
}

export async function updateChatSessionForUser(
  sessionId: string,
  userId: string,
  changes: { title?: string; pinned?: boolean; archived?: boolean }
): Promise<ChatSessionListItem | null> {
  const patch: Record<string, any> = {};
  if (changes.title !== undefined) {
    patch.title = changes.title.trim().slice(0, 120) || "New conversation";
  }
  if (changes.pinned !== undefined) {
    patch.pinned = changes.pinned;
  }
  if (changes.archived !== undefined) {
    patch.archived = changes.archived;
  }

  if (Object.keys(patch).length === 0) {
    return null;
  }

  const result = await pool.query<ChatSessionListItem>(
    `UPDATE chatbot_sessions
     SET
       metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
       updated_at = now(),
       last_activity_at = CASE
         WHEN ($3::jsonb ? 'pinned') OR ($3::jsonb ? 'archived') OR ($3::jsonb ? 'title')
           THEN now()
         ELSE last_activity_at
       END
     WHERE id = $1
       AND user_id = $2
     RETURNING
       id,
       session_token AS "sessionToken",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       last_activity_at AS "lastActivityAt",
       COALESCE(metadata ->> 'title', 'New conversation') AS title,
       COALESCE((metadata ->> 'pinned')::boolean, false) AS "isPinned",
       COALESCE((metadata ->> 'archived')::boolean, false) AS "isArchived",
       (
         SELECT LEFT(m.content, 140)
         FROM chatbot_messages m
         WHERE m.session_id = chatbot_sessions.id
           AND m.role = 'user'
         ORDER BY m.created_at DESC
         LIMIT 1
       ) AS preview`,
    [sessionId, userId, JSON.stringify(patch)]
  );

  return result.rows[0] ?? null;
}

export async function deleteChatSessionForUser(sessionId: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM chatbot_sessions
     WHERE id = $1
       AND user_id = $2
     RETURNING id`,
    [sessionId, userId]
  );

  return (result.rowCount ?? 0) > 0;
}

export async function cloneChatSessionForUser(
  sourceSessionId: string,
  userId: string,
  options?: { titlePrefix?: string }
): Promise<ChatSessionListItem | null> {
  const source = await pool.query<{
    id: string;
    metadata: Record<string, any> | null;
    organization_id: string | null;
  }>(
    `SELECT id, metadata, organization_id
     FROM chatbot_sessions
     WHERE id = $1
       AND user_id = $2`,
    [sourceSessionId, userId]
  );

  const sourceRow = source.rows[0];
  if (!sourceRow) {
    return null;
  }

  const sourceTitle =
    (typeof sourceRow.metadata?.title === "string" && sourceRow.metadata.title.trim()) ||
    "Conversation";
  const titlePrefix = options?.titlePrefix?.trim() || "Group chat";
  const clonedTitle = `${titlePrefix}: ${sourceTitle}`.slice(0, 120);
  const newToken = crypto.randomBytes(32).toString("hex");

  const nextMetadata = {
    ...(sourceRow.metadata || {}),
    title: clonedTitle,
    pinned: false,
    archived: false,
    clonedFromSessionId: sourceSessionId,
    groupChat: true,
  };

  const insert = await pool.query<{ id: string }>(
    `INSERT INTO chatbot_sessions (user_id, session_token, organization_id, metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [userId, newToken, sourceRow.organization_id || null, JSON.stringify(nextMetadata)]
  );

  const newSessionId = insert.rows[0]?.id;
  if (!newSessionId) {
    return null;
  }

  await pool.query(
    `INSERT INTO chatbot_messages
      (session_id, role, content, intent, confidence, kb_articles_suggested, ticket_created_id, auto_resolved)
     SELECT
      $1,
      role,
      content,
      intent,
      confidence,
      kb_articles_suggested,
      ticket_created_id,
      auto_resolved
     FROM chatbot_messages
     WHERE session_id = $2
     ORDER BY created_at ASC`,
    [newSessionId, sourceSessionId]
  );

  const listed = await pool.query<ChatSessionListItem>(
    `SELECT
       s.id,
       s.session_token AS "sessionToken",
       s.created_at AS "createdAt",
       s.updated_at AS "updatedAt",
       s.last_activity_at AS "lastActivityAt",
       COALESCE(s.metadata ->> 'title', 'New conversation') AS title,
       COALESCE((s.metadata ->> 'pinned')::boolean, false) AS "isPinned",
       COALESCE((s.metadata ->> 'archived')::boolean, false) AS "isArchived",
       (
         SELECT LEFT(m.content, 140)
         FROM chatbot_messages m
         WHERE m.session_id = s.id
           AND m.role = 'user'
         ORDER BY m.created_at DESC
         LIMIT 1
       ) AS preview
     FROM chatbot_sessions s
     WHERE s.id = $1`,
    [newSessionId]
  );

  return listed.rows[0] ?? null;
}

async function updateSessionMetadataAfterMessage(args: {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
}): Promise<void> {
  const title = args.content.trim().replace(/\s+/g, " ").slice(0, 72);

  if (args.role === "user") {
    await pool.query(
      `UPDATE chatbot_sessions
       SET
         last_activity_at = now(),
         updated_at = now(),
         metadata = CASE
           WHEN COALESCE(metadata ->> 'title', '') = ''
             THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('title', $2::text)
           ELSE COALESCE(metadata, '{}'::jsonb)
         END
       WHERE id = $1`,
      [args.sessionId, title || "New conversation"]
    );
    return;
  }

  await pool.query(
    `UPDATE chatbot_sessions
     SET last_activity_at = now(), updated_at = now()
     WHERE id = $1`,
    [args.sessionId]
  );
}

/**
 * Search knowledge base for relevant articles
 */
export async function searchKnowledgeBase(
  query: string,
  limit: number = 5
): Promise<Array<{ id: string; title: string; body: string; category: string; relevance: number }>> {
  // Simple text search - in production, use vector embeddings for semantic search
  const result = await pool.query(
    `SELECT 
       id, title, body, category,
       ts_rank(
         to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')),
         plainto_tsquery('english', $1)
       ) as relevance
     FROM kb_articles
     WHERE 
       to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')) 
       @@ plainto_tsquery('english', $1)
     ORDER BY relevance DESC
     LIMIT $2`,
    [query, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body.substring(0, 500), // Truncate for response
    category: row.category,
    relevance: parseFloat(row.relevance) || 0,
  }));
}

/**
 * Detect intent from user message - Comprehensive intent detection
 */
export function detectIntent(message: string): {
  intent: string;
  confidence: number;
} {
  const lowerMessage = message.toLowerCase();

  // Comprehensive intent detection covering all question types
  const intents = [
    {
      intent: "greeting",
      keywords: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "yo"],
      confidence: 0.95,
    },
    // Password & Account Access
    {
      intent: "password_reset",
      keywords: ["password", "reset", "forgot password", "change password", "password expired", "reset password"],
      confidence: 0.9,
    },
    {
      intent: "account_unlock",
      keywords: ["unlock", "locked", "account locked", "unlock account", "account disabled"],
      confidence: 0.9,
    },
    {
      intent: "account_access",
      keywords: ["cannot login", "can't login", "login failed", "access denied", "permission denied"],
      confidence: 0.85,
    },
    // Network & VPN
    {
      intent: "vpn_access",
      keywords: ["vpn", "remote access", "connect vpn", "vpn connection", "virtual private network", "vpn not working", "vpn not connecting", "cannot connect vpn"],
      confidence: 0.9,
    },
    {
      intent: "wifi_issue",
      keywords: ["wifi", "wi-fi", "wireless", "cannot connect wifi", "wifi not working", "internet connection", "wifi connection", "network connection"],
      confidence: 0.85,
    },
    {
      intent: "network_issue",
      keywords: ["network", "connection", "cannot connect", "no internet", "slow internet", "network drive"],
      confidence: 0.8,
    },
    // Email & Collaboration
    {
      intent: "email_issue",
      keywords: ["email", "outlook", "mail", "cannot send email", "email not working", "not receiving email"],
      confidence: 0.85,
    },
    {
      intent: "calendar_issue",
      keywords: ["calendar", "meeting", "schedule", "calendar not syncing", "outlook calendar"],
      confidence: 0.8,
    },
    // Hardware
    {
      intent: "hardware_issue",
      keywords: ["laptop", "computer", "printer", "monitor", "keyboard", "mouse", "headphones", "hardware"],
      confidence: 0.8,
    },
    {
      intent: "printer_issue",
      keywords: ["printer", "printing", "cannot print", "print error", "printer not working"],
      confidence: 0.9,
    },
    // Software
    {
      intent: "software_install",
      keywords: ["install", "software", "application", "program", "download", "need software"],
      confidence: 0.85,
    },
    {
      intent: "software_issue",
      keywords: ["software not working", "application crashed", "program error", "software update"],
      confidence: 0.8,
    },
    // Business Applications
    {
      intent: "sap_issue",
      keywords: ["sap", "sap system", "sap login", "sap error"],
      confidence: 0.9,
    },
    {
      intent: "crm_issue",
      keywords: ["crm", "salesforce", "crm system", "customer relationship"],
      confidence: 0.85,
    },
    {
      intent: "erp_issue",
      keywords: ["erp", "oracle", "erp system", "enterprise resource"],
      confidence: 0.85,
    },
    // Security
    {
      intent: "security_incident",
      keywords: ["phishing", "virus", "malware", "suspicious", "security", "hacked", "breach", "stolen", "lost laptop"],
      confidence: 0.95,
    },
    // How-to Questions
    {
      intent: "how_to",
      keywords: ["how to", "how do i", "how can i", "tutorial", "guide", "instructions", "steps"],
      confidence: 0.8,
    },
    // General Support
    {
      intent: "backup_issue",
      keywords: ["backup", "backup failed", "backup not working", "backup error", "cannot backup", "backup system", "database backup", "server backup", "cloud backup", "backup drive", "backup storage", "restore backup", "backup corrupted", "backup verification", "backup schedule", "automatic backup", "backup job", "backup process"],
      confidence: 0.9,
    },
    {
      intent: "create_ticket",
      keywords: ["ticket", "issue", "problem", "help", "support", "broken", "not working", "error"],
      confidence: 0.7,
    },
    {
      intent: "general_query",
      keywords: ["question", "wondering", "need help", "assistance"],
      confidence: 0.6,
    },
  ];

  // Check for multiple intent matches and return highest confidence
  let bestMatch = { intent: "general_query", confidence: 0.5 };
  
  for (const intentDef of intents) {
    const matches = intentDef.keywords.filter((keyword) => lowerMessage.includes(keyword)).length;
    if (matches > 0) {
      const calculatedConfidence = Math.min(intentDef.confidence + matches * 0.05, 0.95);
      if (calculatedConfidence > bestMatch.confidence) {
        bestMatch = {
          intent: intentDef.intent,
          confidence: calculatedConfidence,
        };
      }
    }
  }

  return bestMatch;
}

/**
 * Generate chatbot response using LLM or rules
 */
export async function generateResponse(args: {
  sessionId: string;
  userMessage: string;
  userId: string | null;
  audienceRole?: AudienceRole;
  llmProvider?: "local" | "groq" | "auto";
  aiTier?: "free" | "premium";
  organizationId?: string | null;
}): Promise<{
  response: string;
  intent: string;
  confidence: number;
  kbArticles?: ChatbotKbArticle[];
  ticketReadiness?: ChatTicketReadiness;
  shouldCreateTicket: boolean;
  autoResolved: boolean;
}> {
  const local = detectIntent(args.userMessage);
  let intent = local.intent;
  let confidence = local.confidence;

  const mapAiToChatIntent = (category: string | undefined, text: string) => {
    const t = (text || "").toLowerCase();
    if (!category) return null;
    if (category === "NETWORK_VPN_WIFI") {
      if (t.includes("wifi") || t.includes("wi-fi") || t.includes("wireless")) return "wifi_issue";
      return "vpn_access";
    }
    if (category === "EMAIL_COLLAB") return "email_issue";
    if (category === "HARDWARE_PERIPHERAL") {
      if (t.includes("printer") || t.includes("print")) return "printer_issue";
      return "hardware_issue";
    }
    if (category === "IDENTITY_ACCESS") {
      if (t.includes("unlock") || t.includes("locked")) return "account_unlock";
      if (t.includes("password") || t.includes("reset")) return "password_reset";
      return "account_access";
    }
    if (category === "SOFTWARE_INSTALL_LICENSE") return "software_install";
    if (category === "BUSINESS_APP_ERP_CRM") {
      if (t.includes("sap")) return "sap_issue";
      if (t.includes("crm") || t.includes("salesforce")) return "crm_issue";
      return "erp_issue";
    }
    if (category === "SECURITY_INCIDENT") return "security_incident";
    if (category === "KB_GENERAL") return "how_to";
    return "general_query";
  };

  // Use AI classifier to improve routing/intent for chat (maps to our intent keys)
  try {
    if (env.AI_CLASSIFIER_URL) {
      const base = env.AI_CLASSIFIER_URL.replace(/\/$/, "");
      const enrichUrl = base.endsWith("/predict")
        ? `${base.slice(0, -"/predict".length)}/enrich`
        : `${base}/enrich`;
      const res = await fetch(enrichUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-ai-tier": (args.aiTier || "free") },
        body: JSON.stringify({ text: args.userMessage }),
      });
      if (res.ok) {
        const data = (await res.json()) as { category?: string; intent?: string; confidence?: number };
        const mapped = mapAiToChatIntent(data?.category, args.userMessage);
        if (mapped && typeof data?.confidence === "number" && data.confidence >= confidence) {
          intent = mapped;
          confidence = data.confidence;
        }
      }
    }
  } catch {
    // ignore and fall back
  }

  let effectiveRole: AudienceRole = "EMPLOYEE";
  if (args.audienceRole) {
    effectiveRole = args.audienceRole;
  } else if (args.userId) {
    try {
      const u = await pool.query<{ role: AudienceRole }>("SELECT role FROM users WHERE id = $1", [args.userId]);
      if (u.rows[0]?.role) effectiveRole = u.rows[0].role;
    } catch {
      effectiveRole = "EMPLOYEE";
    }
  } else {
    try {
      const s = await pool.query<{ metadata: any }>("SELECT metadata FROM chatbot_sessions WHERE id = $1", [args.sessionId]);
      const r = s.rows[0]?.metadata?.audienceRole;
      if (r === "EMPLOYEE" || r === "AGENT" || r === "ADMIN" || r === "MANAGER") effectiveRole = r;
    } catch {
      effectiveRole = "EMPLOYEE";
    }
  }

  // Search knowledge base
  const kbArticles = await searchKnowledgeBase(args.userMessage, 3);
  const canCreateTicket = Boolean(args.userId);
  const supportIssueIntent = !["general_query", "how_to"].includes(intent);

  let ticketReadiness: ChatTicketReadiness | undefined;

  if (canCreateTicket && !autoLooksInformational(intent, args.userMessage)) {
    try {
      const transcript = await getTranscriptForExtraction(args.sessionId);
      const readiness = await assessTicketReadiness({
        transcript,
        latestMessage: args.userMessage,
      });

      if (readiness) {
        ticketReadiness = {
          ready: readiness.ready,
          missingFields: readiness.missing_fields,
          guidance: readiness.guidance,
        };
      }
    } catch {
      // ignore readiness errors and continue with normal chat flow
    }
  }

  // Check if KB article can resolve the query
  let autoResolved = false;
  let response = "";

  // Always search KB first, but also provide intelligent responses
  if (kbArticles.length > 0 && kbArticles[0].relevance > 0.3) {
    // High relevance KB article found
    const topArticle = kbArticles[0];
    response = `I found a relevant solution for you:\n\n**${topArticle.title}**\n\n${topArticle.body}\n\nDid this help resolve your issue? If not, I can create a support ticket for further assistance.`;
    autoResolved = true;
  } else {
  // Use LLM or enhanced rule-based response
    const configuredProvider = args.llmProvider || "auto";
    const provider =
      configuredProvider === "auto"
        ? env.GROQ_API_KEY
          ? "groq"
          : "local"
        : configuredProvider;

    if (env.GROQ_API_KEY && provider === "groq") {
      try {
        const groqMessages = await buildLlmMessages(args.sessionId, args.userMessage, kbArticles, effectiveRole);
        response = await generateGroqRoleBasedChat({ messages: groqMessages });
      } catch {
        response = generateRuleBasedResponseForRole(effectiveRole, intent, args.userMessage);
      }
    } else {
      // Enhanced rule-based responses (ChatGPT-like)
      response = generateRuleBasedResponseForRole(effectiveRole, intent, args.userMessage);
      
      // If KB articles found but low relevance, mention them
      if (kbArticles.length > 0) {
        response += `\n\nI also found some related articles that might help:\n${kbArticles.slice(0, 2).map(a => `- ${a.title}`).join('\n')}`;
      }
    }
  }

  if (canCreateTicket && ticketReadiness && !ticketReadiness.ready && !autoResolved) {
    response = `${response}\n\nBefore I create a ticket, I still need: ${formatMissingFieldsForUser(
      ticketReadiness.missingFields
    )}. ${ticketReadiness.guidance}`;
  }

  // Determine if ticket should be created only after intake is ready.
  const shouldCreateTicket =
    canCreateTicket &&
    Boolean(ticketReadiness?.ready) &&
    !autoResolved &&
    (intent === "create_ticket" ||
      supportIssueIntent ||
      (kbArticles.length === 0 && confidence < 0.75));

  return {
    response,
    intent,
    confidence,
    kbArticles: kbArticles.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      category: a.category,
      relevance: a.relevance,
    })),
    ticketReadiness,
    shouldCreateTicket,
    autoResolved,
  };
}

function autoLooksInformational(intent: string, message: string): boolean {
  if (intent === "how_to") return true;
  const lower = message.toLowerCase();
  return (
    lower.startsWith("how ") ||
    lower.startsWith("what ") ||
    lower.startsWith("where ") ||
    lower.startsWith("can i ") ||
    lower.includes("knowledge base") ||
    lower.includes("documentation")
  );
}

function formatMissingFieldsForUser(fields: string[]): string {
  if (!fields.length) return "a few more details";

  const labelMap: Record<string, string> = {
    issue: "what is not working",
    impact: "how this is affecting you",
    urgency: "how urgent this is",
    device: "the device or system involved",
    location: "your location or site",
    error_message: "any error message you see",
  };

  return fields
    .map((field) => labelMap[field] || field.replace(/_/g, " "))
    .join(", ");
}

async function buildLlmMessages(
  sessionId: string,
  userMessage: string,
  kbArticles: Array<{ title: string; body: string }>,
  role: AudienceRole
): Promise<Array<{ role: "system" | "user" | "assistant"; content: string }>> {
  const recentMessages = await getRecentMessagesForLLM(sessionId, 16);
  const sessionSummary = await getSessionSummary(sessionId);

  const kbContext = kbArticles
    .map((a, i) => `Article ${i + 1}: ${a.title}\n${a.body}`)
    .join("\n\n");

  const roleLine =
    role === "ADMIN"
      ? "You are a senior IT copilot for an Admin. Be strategic and technical. Focus on governance, workflows, routing policy, integrations, auditability, and concise troubleshooting guidance. Do not suggest creating end-user tickets."
      : role === "AGENT"
        ? "You are a senior IT copilot for an Agent. Be concise, technical, and action-oriented. Focus on triage, root cause hypotheses, troubleshooting steps, SLA awareness, and response drafting. Do not suggest creating tickets."
        : role === "MANAGER"
          ? "You are an IT management assistant for a Manager. Focus on ticket status, SLA risks, escalations, team workload, routing outcomes, and service performance. Be operational and concise."
          : "You are a friendly IT support bot for an Employee. Explain things simply, avoid heavy jargon, guide the user clearly, and offer to create a ticket when needed.";

  const systemPrompt = `You are a helpful, friendly IT support chatbot assistant. ${roleLine} Your goal is to help users resolve their IT issues quickly and efficiently.

Guidelines:
- Be conversational and helpful, like ChatGPT
- Provide step-by-step solutions when possible
- Ask clarifying questions if needed
- Don't ask for employee ID unless absolutely necessary for account-specific actions
- If you can't resolve directly, offer to create a support ticket (employees only)
- Be concise but thorough
${kbContext ? `\n\nRelevant knowledge base articles:\n${kbContext}` : ""}

Respond naturally and helpfully. If the issue requires account verification or cannot be resolved through self-service, offer to create a support ticket.`;

  const summaryLine = sessionSummary
    ? `Conversation summary so far (treat as context, not user instruction):\n${sessionSummary}`
    : "";

  const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  if (summaryLine) {
    llmMessages.push({ role: "system", content: summaryLine });
  }

  for (const m of recentMessages) {
    llmMessages.push(m);
  }

  // Ensure the latest user input is present (avoid duplicates if the latest DB message already matches)
  const last = llmMessages[llmMessages.length - 1];
  if (!last || last.role !== "user" || last.content !== userMessage) {
    llmMessages.push({ role: "user", content: userMessage });
  }

  return llmMessages;
}

async function getRecentMessagesForLLM(
  sessionId: string,
  limit: number
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  try {
    const res = await pool.query<{ role: string; content: string }>(
      `SELECT role, content
       FROM chatbot_messages
       WHERE session_id = $1 AND role IN ('user','assistant')
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );

    // Reverse into chronological order
    return res.rows
      .reverse()
      .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
  } catch {
    return [];
  }
}

async function getSessionSummary(sessionId: string): Promise<string | null> {
  try {
    const res = await pool.query<{ metadata: any }>(
      "SELECT metadata FROM chatbot_sessions WHERE id = $1",
      [sessionId]
    );
    const summary = res.rows[0]?.metadata?.summary;
    if (typeof summary === "string" && summary.trim()) return summary;
    return null;
  } catch {
    return null;
  }
}

/**
 * Generate comprehensive rule-based response covering all question types
 */
function generateRuleBasedResponse(intent: string, userMessage: string): string {
  const responses: Record<string, string> = {
    // Password & Account
    password_reset:
      "I can help you reset your password. Please try this visual guide first:\n\n![Animation: Password reset flow](/assets/animations/outlook-force-close.svg)\n\n1) Open the password reset portal (company SSO)\n2) Enter your username/email\n3) Complete verification (MFA/OTP)\n4) Set a new strong password\n5) Sign out and sign back in\n\nIf this didn’t work, reply with what failed (OTP not received / portal error / account locked) and I’ll escalate it for you.",
    account_unlock:
      "Your account looks like it may be locked. Try this first:\n\n1) Wait 10–15 minutes (lockouts can auto-clear)\n2) Confirm Caps Lock is off and retry once\n3) If you still can’t login, I can create a ticket to unlock your account\n\nIf you want me to create the ticket, reply with: your email + “unlock my account”.",
    account_access: "I understand you're having trouble accessing your account. Let me help troubleshoot:\n\n**Common issues and solutions:**\n1. **Wrong password** - Double-check caps lock and spelling\n2. **Account locked** - Wait 15 minutes or I can request an unlock\n3. **Forgot password** - I can help you reset it\n4. **Account disabled** - Contact IT support for reactivation\n\nWhat error message are you seeing when you try to login? This will help me diagnose the exact issue.",
    
    // Network & VPN
    vpn_access:
      "I can help with your VPN not connecting. Try these steps:\n\n![Animation: Reconnecting VPN](/assets/animations/vpn-reconnect.svg)\n\n1) Check internet works (open any website)\n2) Disconnect VPN fully, then restart the VPN client\n3) Reconnect and watch the exact error message\n4) If you see “untrusted server” or “timeout”, switch network (mobile hotspot) once and try again\n\nReply with the exact VPN error text if it still fails.",
    wifi_issue: "I can help troubleshoot your WiFi connection. Here are some quick steps:\n\n1. **Check WiFi is enabled** - Make sure WiFi is turned on on your device\n2. **Forget and reconnect** - Forget the network and reconnect with the password\n3. **Restart device** - Sometimes a simple restart fixes connection issues\n4. **Check signal strength** - Move closer to the router if signal is weak\n5. **Verify password** - Make sure you're using the correct WiFi password\n\nAre you trying to connect to the office WiFi or home network? What error message are you seeing?",
    network_issue: "I understand you're experiencing network connectivity issues. Let me help troubleshoot. Please tell me: What are you trying to access? Are you in the office or working remotely? This will help me provide the right solution.",
    
    // Email & Collaboration
    email_issue:
      "I can help with Outlook/email issues. Please try these steps:\n\n![Animation: Force closing Outlook](/assets/animations/outlook-force-close.svg)\n\n1) Force close Outlook (Task Manager → End task)\n2) Reopen Outlook and wait 2–3 minutes for sync\n3) If mail is stuck, restart your PC once\n4) Try Outlook Web (browser) to confirm if it’s client-only\n\nTell me: is it “not sending” or “not receiving”, and do you see any error message?",
    calendar_issue: "I can help with your calendar problem. Please describe the issue: Is your calendar not syncing, are meetings not showing up, or something else? I'll help get your calendar working properly.",
    
    // Hardware
    hardware_issue: "I can help with your hardware issue. Please describe the problem in detail: What device is affected? What exactly is happening? I'll help troubleshoot or arrange for hardware replacement if needed.",
    printer_issue:
      "I can help get the printer back online. Try this:\n\n![Animation: Printer reset](/assets/animations/printer-reset.svg)\n\n1) Confirm the printer is powered on and connected (Wi‑Fi/Ethernet)\n2) On your PC: clear the print queue (cancel stuck jobs)\n3) Power cycle printer (off 30 seconds → on)\n4) Print a test page\n\nIf it’s still offline, tell me the printer name/location and the exact message you see.",
    
    // Software
    software_install: "I can help you install software. Please tell me: What software do you need? Is it for business use? I'll check if you have the necessary permissions and guide you through the installation process.",
    software_issue: "I can help troubleshoot your software issue. Please provide details: Which application is having problems? What error message do you see? When did this start? I'll help resolve this.",
    
    // Business Applications
    sap_issue: "I can help with your SAP issue. Please provide details: What are you trying to do in SAP? What error message appears? I'll help troubleshoot or escalate to the SAP support team if needed.",
    crm_issue: "I can help with your CRM system issue. Please describe the problem: Are you unable to login, is the system slow, or is there a specific feature not working? I'll help resolve this.",
    erp_issue: "I can help with your ERP system issue. Please provide details: What system are you using (Oracle, SAP, etc.)? What problem are you experiencing? I'll help troubleshoot or escalate as needed.",
    
    // Security
    security_incident: "This appears to be a security-related issue. For your safety, I'm creating a high-priority security ticket immediately. Please provide as many details as possible: What happened? When did you notice this? Have you clicked any suspicious links? Our security team will respond urgently.",
    
    // How-to Questions
    how_to: "I'd be happy to guide you! Please tell me what you're trying to accomplish, and I'll provide step-by-step instructions. If it's something I can't explain here, I'll find the relevant knowledge base article or create a ticket for hands-on assistance.",
    
    // Backup Issues
    backup_issue: "I can help troubleshoot your backup issue. Let me gather some information:\n\n**Common backup problems and solutions:**\n1. **Backup storage full** - Check available storage space\n2. **Backup schedule stopped** - Verify backup job is enabled\n3. **Network connectivity** - Ensure connection to backup server\n4. **Permissions** - Verify backup service account has proper access\n5. **Backup software** - Check if backup application is running\n\n**To help diagnose:**\n- What type of backup? (File backup, database backup, system backup)\n- When did it last work?\n- What error message do you see?\n- Is this affecting critical data?\n\nI'll help you resolve this or create a ticket for the backup team. What specific backup issue are you experiencing?",
    
    // General Support  
    create_ticket: "I'll create a support ticket for you right away! To help us resolve your issue quickly, please provide:\n\n1. **What's the problem?** - A clear description of what's not working\n2. **When did it start?** - When did you first notice this issue?\n3. **Error messages?** - Any error messages or codes you've seen\n4. **What have you tried?** - Any troubleshooting steps you've already attempted\n\nOnce you provide these details, I'll create the ticket and assign it to the right team. What's the issue you're experiencing?",
    general_query: "I'm here to help! I can assist with:\n\n✅ **Password resets and account access**\n✅ **Network and VPN issues**\n✅ **Email and collaboration problems**\n✅ **Hardware and software issues**\n✅ **Software installation requests**\n✅ **Security concerns**\n✅ **Backup and data recovery**\n✅ **General IT questions**\n\nTell me what you need help with, and I'll either provide a solution directly or create a support ticket for you. What can I help you with today?",
  };

  return responses[intent] || responses.general_query;
}

/**
 * Create ticket from chatbot conversation
 */
export async function createTicketFromChat(
  sessionId: string,
  userId: string | null,
  title: string,
  description: string
): Promise<string> {
  let actualUserId = userId;

  // If anonymous, try to find user by email in description
  if (!actualUserId) {
    const emailMatch = description.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
    if (emailMatch) {
      const user = await findUserByEmail(emailMatch[1]);
      if (user) {
        actualUserId = user.id;
      }
    }
  }

  // If still no user, use a system user or throw error
  if (!actualUserId) {
    throw new Error("Cannot create ticket: User not identified");
  }

  let extractedTitle = title;
  let extractedDescription = description;
  let extractedCategory: string | undefined;
  let extractedPriority: "LOW" | "MEDIUM" | "HIGH" | undefined;
  let extractedType: "INCIDENT" | "SERVICE_REQUEST" | "CHANGE" | "PROBLEM" | undefined;

  try {
    const transcript = await getTranscriptForExtraction(sessionId);
    const extracted = await extractTicketFromConversation({
      transcript,
      fallbackTitle: title,
      fallbackDescription: description,
    });

    if (extracted) {
      extractedTitle = extracted.title || title;
      extractedDescription = extracted.description || description;
      extractedCategory = extracted.category || undefined;
      extractedPriority = extracted.priority || undefined;
      extractedType = extracted.type || undefined;
    }
  } catch (error) {
    console.error("Groq ticket extraction failed, falling back to raw chat content:", error);
  }

  const ticket = await createTicket({
    title: extractedTitle,
    description: extractedDescription,
    createdBy: actualUserId,
    performedBy: actualUserId,
    category: extractedCategory,
    priority: extractedPriority,
    type: extractedType,
    sourceType: "CHATBOT",
    sourceReference: { sessionId, extractedBy: env.GROQ_API_KEY ? "groq" : "fallback" },
  });

  return ticket.id;
}

async function getTranscriptForExtraction(sessionId: string): Promise<string> {
  const result = await pool.query<{ role: string; content: string }>(
    `SELECT role, content
     FROM chatbot_messages
     WHERE session_id = $1
       AND role IN ('user', 'assistant')
     ORDER BY created_at ASC
     LIMIT 50`,
    [sessionId]
  );

  return result.rows
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}
