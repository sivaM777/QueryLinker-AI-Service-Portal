import { pool } from "../../config/db.js";
import { env } from "../../config/env.js";
import { createHash } from "crypto";
import { sendMail } from "../tickets/ticket.service.js";
import { sendSms, formatTicketSms } from "../notifications/sms.service.js";

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  event_type: string;
  conditions: Record<string, any>;
  channels: string[];
  recipient_user_ids: string[] | null;
  recipient_team_ids: string[] | null;
  recipient_roles: string[] | null;
  recipient_emails: string[] | null;
  recipient_phones: string[] | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  email_subject_template: string | null;
  email_body_template: string | null;
  sms_template: string | null;
}

export interface TicketAlertData {
  ticketId: string;
  title: string;
  description: string;
  category: string | null;
  priority: string;
  status: string;
  assignedTeam: string | null;
  assignedAgent: string | null;
  requesterEmail: string;
  requesterName: string;
  eventType: string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeChannels(channels: string[] | string | null | undefined): string[] {
  if (!channels) return [];
  if (Array.isArray(channels)) return channels;
  const raw = String(channels).trim();
  if (raw.startsWith("{") && raw.endsWith("}")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [raw];
}

/**
 * Get all enabled alert rules for an event type
 */
export async function getAlertRulesForEvent(eventType: string): Promise<AlertRule[]> {
  const result = await pool.query<AlertRule>(
    `SELECT * FROM alert_rules 
     WHERE enabled = true AND event_type = $1
     ORDER BY priority DESC, created_at ASC`,
    [eventType]
  );
  return result.rows;
}

/**
 * Check if alert rule conditions match ticket data
 */
export function ruleMatches(rule: AlertRule, ticketData: TicketAlertData): boolean {
  const conditions = rule.conditions || {};

  // If no conditions, rule matches
  if (Object.keys(conditions).length === 0) {
    return true;
  }

  // Check each condition
  for (const [key, value] of Object.entries(conditions)) {
    const ticketValue = (ticketData as any)[key];

    if (Array.isArray(value)) {
      // Condition is an array - ticket value must be in array
      if (!value.includes(ticketValue)) {
        return false;
      }
    } else {
      // Condition is a single value - must match exactly
      if (ticketValue !== value) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Get all recipients for an alert rule
 */
export async function getAlertRecipients(rule: AlertRule): Promise<{
  emails: string[];
  phones: string[];
  userIds: string[];
}> {
  const emails: string[] = [];
  const phones: string[] = [];
  const userIds: string[] = [];

  // Add explicit emails
  if (rule.recipient_emails) {
    emails.push(...rule.recipient_emails);
  }

  // Add explicit phones
  if (rule.recipient_phones) {
    phones.push(...rule.recipient_phones);
  }

  // Add user IDs
  if (rule.recipient_user_ids) {
    userIds.push(...rule.recipient_user_ids);
    
    // Get emails and phones for these users
    if (rule.recipient_user_ids.length > 0) {
      const userResult = await pool.query<{ email: string; phone: string | null }>(
        `SELECT email, NULL as phone FROM users WHERE id = ANY($1)`,
        [rule.recipient_user_ids]
      );
      userResult.rows.forEach((u) => {
        if (u.email) emails.push(u.email);
        if (u.phone) phones.push(u.phone);
      });
    }
  }

  // Add team members
  if (rule.recipient_team_ids && rule.recipient_team_ids.length > 0) {
    const teamResult = await pool.query<{ id: string; email: string; phone: string | null }>(
      `SELECT u.id, u.email, NULL as phone 
       FROM users u 
       WHERE u.team_id = ANY($1)`,
      [rule.recipient_team_ids]
    );
    teamResult.rows.forEach((u) => {
      userIds.push(u.id);
      if (u.email) emails.push(u.email);
      if (u.phone) phones.push(u.phone);
    });
  }

  // Add users by role
  if (rule.recipient_roles && rule.recipient_roles.length > 0) {
    const roleResult = await pool.query<{ id: string; email: string; phone: string | null }>(
      `SELECT id, email, NULL as phone 
       FROM users 
       WHERE role = ANY($1)`,
      [rule.recipient_roles]
    );
    roleResult.rows.forEach((u) => {
      userIds.push(u.id);
      if (u.email) emails.push(u.email);
      if (u.phone) phones.push(u.phone);
    });
  }

  // Remove duplicates
  return {
    emails: [...new Set(emails)],
    phones: [...new Set(phones.filter(Boolean))],
    userIds: [...new Set(userIds)],
  };
}

/**
 * Send alert via specified channels
 */
export async function sendAlert(
  rule: AlertRule,
  ticketData: TicketAlertData,
  recipients: { emails: string[]; phones: string[]; userIds: string[] }
): Promise<void> {
  const promises: Promise<void>[] = [];
  const channels = normalizeChannels(rule.channels);

  // Send emails
  if (channels.includes("EMAIL") && recipients.emails.length > 0) {
    const subject = rule.email_subject_template
      ? replaceTemplateVariables(rule.email_subject_template, ticketData)
      : `Ticket ${ticketData.ticketId.substring(0, 8).toUpperCase()}: ${ticketData.title}`;

    const body = rule.email_body_template
      ? replaceTemplateVariables(rule.email_body_template, ticketData)
      : formatDefaultEmailBody(ticketData);

    for (const email of recipients.emails) {
      promises.push(
        sendMail({ to: email, subject, text: body }).catch((err) => {
          console.error(`Failed to send email alert to ${email}:`, err);
        })
      );
    }
  }

  // Send SMS
  if (channels.includes("SMS") && recipients.phones.length > 0) {
    const smsMessage = rule.sms_template
      ? replaceTemplateVariables(rule.sms_template, ticketData)
      : formatTicketSms({
          type: ticketData.eventType.toLowerCase().replace("ticket_", "") as any,
          ticketId: ticketData.ticketId,
          title: ticketData.title,
          status: ticketData.status,
          priority: ticketData.priority,
        });

    for (const phone of recipients.phones) {
      promises.push(
        sendSms(phone, smsMessage).catch((err) => {
          console.error(`Failed to send SMS alert to ${phone}:`, err);
        })
      );
    }
  }

  // Send webhooks
  if (channels.includes("WEBHOOK") && rule.webhook_url) {
    promises.push(
      sendWebhook(rule.webhook_url, rule.webhook_secret, ticketData).catch((err) => {
        console.error(`Failed to send webhook alert:`, err);
      })
    );
  }

  await Promise.allSettled(promises);
}

/**
 * Replace template variables in alert templates
 */
function replaceTemplateVariables(template: string, data: TicketAlertData): string {
  return template
    .replace(/\{\{ticketId\}\}/g, data.ticketId)
    .replace(/\{\{ticketRef\}\}/g, data.ticketId.substring(0, 8).toUpperCase())
    .replace(/\{\{title\}\}/g, data.title)
    .replace(/\{\{description\}\}/g, data.description)
    .replace(/\{\{category\}\}/g, data.category || "N/A")
    .replace(/\{\{priority\}\}/g, data.priority)
    .replace(/\{\{status\}\}/g, data.status)
    .replace(/\{\{requesterEmail\}\}/g, data.requesterEmail)
    .replace(/\{\{requesterName\}\}/g, data.requesterName);
}

/**
 * Format default email body
 */
function formatDefaultEmailBody(data: TicketAlertData): string {
  return `Ticket ${data.ticketId.substring(0, 8).toUpperCase()}

Title: ${data.title}
Status: ${data.status}
Priority: ${data.priority}
Category: ${data.category || "N/A"}

Description:
${data.description}

Requester: ${data.requesterName} <${data.requesterEmail}>
`;
}

/**
 * Send webhook alert
 */
async function sendWebhook(
  url: string,
  secret: string | null,
  data: TicketAlertData
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret) {
    headers["X-Webhook-Secret"] = secret;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      event: data.eventType,
      ticket: {
        id: data.ticketId,
        title: data.title,
        status: data.status,
        priority: data.priority,
        category: data.category,
      },
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.statusText}`);
  }
}

/**
 * Create in-app notifications
 */
async function createInAppNotifications(
  rule: AlertRule,
  data: TicketAlertData,
  userIds: string[]
): Promise<void> {
  const title = `Ticket ${data.eventType.replace("TICKET_", "").replace(/_/g, " ")}`;
  const body = `${data.title} (${data.priority})`;

  const dedupeKeys = userIds.map((userId) =>
    sha256Hex(["notification", data.eventType, userId, data.ticketId, body].join("|"))
  );

  await pool.query(
    `WITH candidates AS (
       SELECT
         unnest($1::uuid[]) AS user_id,
         unnest($6::text[]) AS dedupe_key
     )
     INSERT INTO notifications (user_id, ticket_id, type, title, body, dedupe_key)
     SELECT c.user_id, $2, $3, $4, $5, c.dedupe_key
     FROM candidates c
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [userIds, data.ticketId, data.eventType, title, body, dedupeKeys]
  );
}

/**
 * Process alerts for a ticket event
 */
export async function processAlerts(ticketData: TicketAlertData): Promise<void> {
  const rules = await getAlertRulesForEvent(ticketData.eventType);

  for (const rule of rules) {
    if (!ruleMatches(rule, ticketData)) {
      continue;
    }

    try {
      const recipients = await getAlertRecipients(rule);
      await sendAlert(rule, ticketData, recipients);

      // Log alert history
      const channels = normalizeChannels(rule.channels);
      const historyChannels = channels.length > 0 ? channels : ["IN_APP"];
      for (const channel of historyChannels) {
        await pool.query(
          `INSERT INTO alert_history 
           (alert_rule_id, ticket_id, event_type, channel, recipient, status, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, now())`,
          [
            rule.id,
            ticketData.ticketId,
            ticketData.eventType,
            channel,
            JSON.stringify(recipients),
            "sent",
          ]
        );
      }
    } catch (err) {
      console.error(`Error processing alert rule ${rule.id}:`, err);
      
      // Log failure
      const channels = normalizeChannels(rule.channels);
      const historyChannels = channels.length > 0 ? channels : ["IN_APP"];
      for (const channel of historyChannels) {
        await pool.query(
          `INSERT INTO alert_history 
           (alert_rule_id, ticket_id, event_type, channel, recipient, status, error_message)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            rule.id,
            ticketData.ticketId,
            ticketData.eventType,
            channel,
            JSON.stringify({}),
            "failed",
            err instanceof Error ? err.message : String(err),
          ]
        );
      }
    }
  }
}
