import { pool } from "../../config/db.js";
import { ImapClient, ParsedEmail } from "./imap-client.js";
import { createTicketFromEmail, findTicketByEmailReply } from "./email-parser.service.js";
import { createTicketComment } from "../tickets/ticket.service.js";
import { findUserByEmail } from "../auth/auth.service.js";
import { env } from "../../config/env.js";
import { queueEmailForProcessing } from "../queues/email-queue.js";
import type { TicketType } from "../tickets/ticket.service.js";

interface EmailSourceRow {
  id: string;
  name: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_username: string;
  imap_password: string;
  enabled: boolean;
  last_checked_at: string | null;
  last_connect_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
}

type CheckResult = {
  checked: number;
  created: number;
  ignored: number;
  errors: Array<{ message_id?: string; error: string }>;
};

export class EmailMonitorService {
  private clients: Map<string, ImapClient> = new Map();
  private isRunning = false;
  private reloadInterval: NodeJS.Timeout | null = null;
  private loadInFlight: Promise<void> | null = null;
  private sourceLocks: Map<string, Promise<void>> = new Map();
  private lastProcessedAtByMessageId: Map<string, number> = new Map();

  private readonly messageIdDedupeWindowMs = 10 * 60 * 1000;

  private readonly aiIgnoreThreshold = 0.7;

  private isDuplicateEmailTicketError(err: unknown): boolean {
    if (!err) return false;
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes("idx_tickets_email_message_id") || msg.toLowerCase().includes("duplicate key value violates unique constraint");
  }

  private async recordSourceConnectOk(sourceId: string) {
    await pool.query(
      "UPDATE email_sources SET last_connect_at = now(), last_error = NULL, last_error_at = NULL WHERE id = $1",
      [sourceId]
    );
  }

  private async recordSourceError(sourceId: string, err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      "UPDATE email_sources SET last_error = $2, last_error_at = now() WHERE id = $1",
      [sourceId, msg]
    );
  }

  private async recordSourceSuccess(sourceId: string) {
    await pool.query(
      "UPDATE email_sources SET last_success_at = now(), last_checked_at = now(), last_error = NULL, last_error_at = NULL WHERE id = $1",
      [sourceId]
    );
  }

  private async recordIngestionEvent(args: {
    sourceId: string;
    messageId?: string | null;
    fromEmail?: string | null;
    subject?: string | null;
    action: "CREATED" | "IGNORED" | "ERROR";
    reason?: string | null;
    classifierConfidence?: number | null;
    classifierLabel?: string | null;
    createdTicketId?: string | null;
  }) {
    await pool.query(
      `INSERT INTO email_ingestion_events
       (email_source_id, message_id, from_email, subject, action, reason, classifier_confidence, classifier_label, created_ticket_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        args.sourceId,
        args.messageId ?? null,
        args.fromEmail ?? null,
        args.subject ?? null,
        args.action,
        args.reason ?? null,
        args.classifierConfidence ?? null,
        args.classifierLabel ?? null,
        args.createdTicketId ?? null,
      ]
    );
  }

  private extractFromEmail(from: string): string {
    const match = from.match(/<([^>]+)>/) || from.match(/([\w\.-]+@[\w\.-]+\.[A-Za-z]{2,})/);
    const raw = match ? match[1] || match[0] : from;
    return String(raw || "").toLowerCase();
  }

  private shouldIgnoreByRules(email: ParsedEmail): { ignore: boolean; reason?: string } {
    const subject = (email.subject || "").toLowerCase();
    const from = (email.from || "").toLowerCase();
    const text = (email.text || "").toLowerCase();
    const blob = `${subject}\n${from}\n${text}`;

    const deny = [
      "newsletter",
      "unsubscribe",
      "no-reply",
      "noreply",
      "do not reply",
      "otp",
      "verification code",
      "invoice",
      "payment",
      "receipt",
      "promotion",
      "marketing",
      "survey",
    ];

    for (const k of deny) {
      if (blob.includes(k)) return { ignore: true, reason: `RULE_DENY:${k}` };
    }

    // Non-helpdesk/system notification patterns that should not open tickets.
    // This blocks common "Security Alert / Verification / Login code" emails.
    const nonTicket = [
      "security alert",
      "new login",
      "new sign-in",
      "verification code",
      "authentication code",
      "one-time password",
      "otp",
      "do not reply",
      "this mailbox is not monitored",
      "automated notification",
      "system notification",
      "no action is required",
      "confirm your identity",
      "password will expire",
    ];
    for (const k of nonTicket) {
      if (blob.includes(k)) return { ignore: true, reason: `RULE_NON_TICKET:${k}` };
    }

    // Option B: for registered users, we rely on AI for type classification only.
    // We do NOT block ticket creation by heuristics (to avoid false negatives like "server crashed").
    return { ignore: false };
  }

  private async classifyTicketType(email: ParsedEmail): Promise<{ type: TicketType; confidence: number | null; label: string | null }> {
    const url = env.AI_CLASSIFIER_URL;
    if (!url) return { type: "INCIDENT", confidence: null, label: null };

    const text = `${email.subject || ""}\n\n${email.text || ""}`.trim();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-ai-tier": (env.AI_TIER || "free") },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { type: "INCIDENT", confidence: null, label: null };
      }
      const data: any = await res.json();
      const intent = String(data?.intent || "").toUpperCase();
      const confidence = typeof data?.confidence === "number" ? data.confidence : null;

      const map: Record<string, TicketType> = {
        INCIDENT: "INCIDENT",
        SERVICE_REQUEST: "SERVICE_REQUEST",
        CHANGE: "CHANGE",
        PROBLEM: "PROBLEM",
        HOW_TO: "SERVICE_REQUEST",
        PASSWORD_RESET: "SERVICE_REQUEST",
        ACCOUNT_UNLOCK: "SERVICE_REQUEST",
        SECURITY_REPORT: "INCIDENT",
      };

      return {
        type: map[intent] ?? "INCIDENT",
        confidence,
        label: intent || null,
      };
    } catch {
      return { type: "INCIDENT", confidence: null, label: null };
    }
  }

  /**
   * Load all enabled email sources and start monitoring
   */
  async start(): Promise<void> {
    if (!this.isRunning) {
      this.isRunning = true;
    }

    await this.loadAndStartClients();

    // Reload clients every 5 minutes in case config changes
    if (!this.reloadInterval) {
      this.reloadInterval = setInterval(() => {
        if (this.isRunning) {
          void this.loadAndStartClients();
        }
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Stop all email monitoring
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.reloadInterval) {
      clearInterval(this.reloadInterval);
      this.reloadInterval = null;
    }

    for (const [id, client] of this.clients.entries()) {
      try {
        await client.disconnect();
      } catch (err) {
        console.error(`Error disconnecting email client ${id}:`, err);
      }
    }

    this.clients.clear();
    this.sourceLocks.clear();
    this.lastProcessedAtByMessageId.clear();
  }

  private async withSourceLock<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sourceLocks.get(sourceId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sourceLocks.set(sourceId, prev.then(() => next));

    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private getSourceKey(row: EmailSourceRow): string {
    return `${row.imap_host}|${row.imap_port}|${row.imap_secure ? "1" : "0"}|${row.imap_username}|${row.imap_password}`;
  }

  private clientConfigKey: Map<string, string> = new Map();

  private async loadAndStartClients(): Promise<void> {
    if (this.loadInFlight) {
      await this.loadInFlight;
      return;
    }

    this.loadInFlight = (async () => {
    const result = await pool.query<EmailSourceRow>(
      "SELECT * FROM email_sources WHERE enabled = true"
    );

    const currentIds = new Set(this.clients.keys());
    const configIds = new Set(result.rows.map((r) => r.id));

    // Remove clients that are no longer enabled
    for (const id of currentIds) {
      if (!configIds.has(id)) {
        const client = this.clients.get(id);
        if (client) {
          await client.disconnect();
          this.clients.delete(id);
          this.clientConfigKey.delete(id);
        }
      }
    }

    // Add/update clients
    for (const source of result.rows) {
      const desiredKey = this.getSourceKey(source);
      const existingClient = this.clients.get(source.id);
      const existingKey = this.clientConfigKey.get(source.id);

      if (existingClient && existingKey === desiredKey) {
        continue;
      }

      if (existingClient) {
        await existingClient.disconnect();
        this.clients.delete(source.id);
        this.clientConfigKey.delete(source.id);
      }

      // Create new client
      const client = new ImapClient({
        host: source.imap_host,
        port: source.imap_port,
        secure: source.imap_secure,
        username: source.imap_username,
        password: source.imap_password,
      });

      client.on("email", async (email: ParsedEmail) => {
        await this.withSourceLock(source.id, async () => {
          await this.handleEmail(email, source.id);
        });
      });

      client.on("error", (err: Error) => {
        console.error(`Email client error for source ${source.id}:`, err);
        void this.recordSourceError(source.id, err);
      });

      try {
        await client.connect();
        await this.recordSourceConnectOk(source.id);
        client.startPolling(60000); // Check every minute
        this.clients.set(source.id, client);
        this.clientConfigKey.set(source.id, desiredKey);

        await pool.query("UPDATE email_sources SET last_checked_at = now() WHERE id = $1", [source.id]);
      } catch (err) {
        console.error(`Failed to connect email client for source ${source.id}:`, err);
        await this.recordSourceError(source.id, err);
      }
    }
    })().finally(() => {
      this.loadInFlight = null;
    });

    await this.loadInFlight;
  }

  private async handleEmail(email: ParsedEmail, sourceId: string): Promise<void> {
    try {
      const fromEmail = this.extractFromEmail(email.from);
      const subject = email.subject || "";

      // In-memory burst dedupe to avoid repeated processing attempts for the same message_id
      // when IMAP re-emits the same unseen message due to reconnect/flag propagation.
      if (email.messageId) {
        const key = `${sourceId}:${email.messageId}`;
        const now = Date.now();
        const last = this.lastProcessedAtByMessageId.get(key);
        if (typeof last === "number" && now - last < this.messageIdDedupeWindowMs) {
          await this.recordSourceSuccess(sourceId);
          await this.recordIngestionEvent({
            sourceId,
            messageId: email.messageId,
            fromEmail,
            subject,
            action: "IGNORED",
            reason: "DUPLICATE_MESSAGE_ID_RECENTLY_SEEN",
          });
          return;
        }
        this.lastProcessedAtByMessageId.set(key, now);

        // Best-effort cleanup to keep map small
        if (this.lastProcessedAtByMessageId.size > 5000) {
          const cutoff = now - this.messageIdDedupeWindowMs;
          for (const [k, ts] of this.lastProcessedAtByMessageId.entries()) {
            if (ts < cutoff) this.lastProcessedAtByMessageId.delete(k);
          }
        }
      }

      // If we already created a ticket for this message_id, do nothing (prevents repeated retries).
      if (email.messageId) {
        const existing = await pool.query<{ c: string }>(
          "SELECT count(*)::text as c FROM email_ingestion_events WHERE email_source_id = $1 AND message_id = $2 AND action = 'CREATED'",
          [sourceId, email.messageId]
        );
        if (Number(existing.rows[0]?.c || 0) > 0) {
          await this.recordSourceSuccess(sourceId);
          await this.recordIngestionEvent({
            sourceId,
            messageId: email.messageId,
            fromEmail,
            subject,
            action: "IGNORED",
            reason: "DUPLICATE_MESSAGE_ID_ALREADY_CREATED",
          });
          return;
        }
      }

      // Enforce: only registered users can create tickets/comments via email
      const senderUser = fromEmail ? await findUserByEmail(fromEmail) : null;
      if (!senderUser) {
        await this.recordIngestionEvent({
          sourceId,
          messageId: email.messageId,
          fromEmail,
          subject,
          action: "IGNORED",
          reason: "UNKNOWN_SENDER",
        });
        return;
      }

      // Check if this is a reply to an existing ticket - handle synchronously for speed
      const existingTicketId = await findTicketByEmailReply(email);
      
      if (existingTicketId) {
        const authorId = senderUser.id;

        const bodyRaw = (email.text || "").trim();
        const body = bodyRaw.length > 5000 ? bodyRaw.substring(0, 4997) + "..." : bodyRaw;

        await createTicketComment({
          ticketId: existingTicketId,
          authorId,
          body,
          isInternal: false,
        });
        await this.recordSourceSuccess(sourceId);
        await this.recordIngestionEvent({
          sourceId,
          messageId: email.messageId,
          fromEmail,
          subject,
          action: "IGNORED",
          reason: "REPLY_TO_EXISTING_TICKET",
        });
        return;
      }

      const rules = this.shouldIgnoreByRules(email);
      if (rules.ignore) {
        await this.recordSourceSuccess(sourceId);
        await this.recordIngestionEvent({
          sourceId,
          messageId: email.messageId,
          fromEmail,
          subject,
          action: "IGNORED",
          reason: rules.reason || "RULE_IGNORED",
        });
        return;
      }

      // Queue the email for async processing via BullMQ
      // This decouples email ingestion from ticket creation, improving API responsiveness
      await queueEmailForProcessing(sourceId, {
        subject: email.subject || "",
        text: email.text || "",
        html: email.html || null,
        from: email.from,
        to: email.to,
        date: email.date,
        messageId: email.messageId,
        attachments: email.attachments || [],
      });

      await this.recordSourceSuccess(sourceId);
      await this.recordIngestionEvent({
        sourceId,
        messageId: email.messageId,
        fromEmail,
        subject,
        action: "CREATED",
        reason: "QUEUED_FOR_PROCESSING",
      });

      console.log(`Queued email ${email.messageId} from source ${sourceId} for processing`);
    } catch (err) {
      if (this.isDuplicateEmailTicketError(err)) {
        await this.recordSourceSuccess(sourceId);
        await this.recordIngestionEvent({
          sourceId,
          messageId: email.messageId,
          fromEmail: this.extractFromEmail(email.from),
          subject: email.subject || "",
          action: "IGNORED",
          reason: "DUPLICATE_MESSAGE_ID",
        });
        return;
      }

      console.error(`Error handling email ${email.messageId}:`, err);
      await this.recordSourceError(sourceId, err);
      await this.recordIngestionEvent({
        sourceId,
        messageId: email.messageId,
        fromEmail: this.extractFromEmail(email.from),
        subject: email.subject || "",
        action: "ERROR",
        reason: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Manually check for new emails on a specific source
   */
  async checkSource(sourceId: string): Promise<CheckResult> {
    const result: CheckResult = { checked: 0, created: 0, ignored: 0, errors: [] };

    // Prefer existing client, but if missing, do on-demand connect+fetch
    const existing = this.clients.get(sourceId);
    let client: ImapClient | null = existing ?? null;
    let tempClient = false;

    if (!client) {
      const src = await pool.query<EmailSourceRow>("SELECT * FROM email_sources WHERE id = $1", [sourceId]);
      const row = src.rows[0];
      if (!row) throw new Error("Email source not found");
      if (!row.enabled) throw new Error("Email source disabled");

      client = new ImapClient({
        host: row.imap_host,
        port: row.imap_port,
        secure: row.imap_secure,
        username: row.imap_username,
        password: row.imap_password,
      });
      tempClient = true;
      try {
        await client.connect();
        await this.recordSourceConnectOk(sourceId);
      } catch (e) {
        await this.recordSourceError(sourceId, e);
        throw e;
      }
    }

    try {
      const emails = await client.fetchNewEmails();
      result.checked = emails.length;
      for (const email of emails) {
        const before = await pool.query<{ c: string }>(
          "SELECT count(*)::text as c FROM email_ingestion_events WHERE email_source_id = $1 AND message_id = $2 AND action = 'CREATED'",
          [sourceId, email.messageId]
        );
        await this.handleEmail(email, sourceId);
        const after = await pool.query<{ c: string }>(
          "SELECT count(*)::text as c FROM email_ingestion_events WHERE email_source_id = $1 AND message_id = $2 AND action = 'CREATED'",
          [sourceId, email.messageId]
        );
        const createdDelta = Number(after.rows[0]?.c || 0) - Number(before.rows[0]?.c || 0);
        if (createdDelta > 0) result.created += 1;
        else result.ignored += 1;
      }
      await this.recordSourceSuccess(sourceId);
      return result;
    } catch (e) {
      await this.recordSourceError(sourceId, e);
      result.errors.push({ error: e instanceof Error ? e.message : String(e) });
      return result;
    } finally {
      if (tempClient && client) {
        try {
          await client.disconnect();
        } catch {
          // ignore
        }
      }
    }
  }
}

// Singleton instance
export const emailMonitor = new EmailMonitorService();
