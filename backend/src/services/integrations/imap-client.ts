import Imap from "imap";
import { simpleParser } from "mailparser";
import { EventEmitter } from "events";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface ParsedEmail {
  subject: string;
  text: string;
  html: string | null;
  from: string;
  to: string[];
  date: Date;
  messageId: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
  }>;
}

export class ImapClient extends EventEmitter {
  private imap: Imap | null = null;
  private config: EmailConfig;
  private isConnected = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private idleTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelayMs = 1000; // Initial delay
  private readonly maxReconnectDelayMs = 30000;
  private idleIntervalMs = 300000; // 5 minutes

  constructor(config: EmailConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap = new Imap({
        user: this.config.username,
        password: this.config.password,
        host: this.config.host,
        port: this.config.port,
        tls: this.config.secure,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 30000,
        authTimeout: 30000,
      });

      this.imap.once("ready", () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelayMs = 1000;
        this.emit("connected");
        this.startKeepAlive();
        resolve();
      });

      this.imap.once("error", (err: Error) => {
        this.isConnected = false;
        this.emit("error", err);
        reject(err);
      });

      this.imap.once("end", () => {
        this.isConnected = false;
        this.emit("disconnected");
        this.stopKeepAlive();
      });

      this.imap.connect();
    });
  }

  private startKeepAlive(): void {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    this.idleTimeout = setTimeout(() => {
      if (this.isConnected && this.imap) {
        // Safe keepalive: just re-open INBOX periodically to keep connection alive
        // NOOP is not always available, so we use openBox as a safe alternative
        try {
          this.imap.openBox("INBOX", false, () => {
            // Connection kept alive
          });
        } catch (err) {
          // Ignore keepalive errors
        }
      }
      this.startKeepAlive();
    }, this.idleIntervalMs);
  }

  private stopKeepAlive(): void {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
    }
    this.reconnectAttempts++;
    await new Promise(resolve => setTimeout(resolve, this.reconnectDelayMs));
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
    console.log(`Reconnecting IMAP client (attempt ${this.reconnectAttempts})...`);
    await this.connect();
  }

  async disconnect(): Promise<void> {
    this.stopKeepAlive();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    return new Promise((resolve) => {
      if (!this.imap) {
        resolve();
        return;
      }

      this.imap.once("end", () => {
        this.imap = null;
        resolve();
      });

      this.imap.end();
    });
  }

  async fetchNewEmails(since?: Date): Promise<ParsedEmail[]> {
    if (!this.isConnected) {
      try {
        await this.reconnect();
      } catch (err) {
        console.error("Failed to reconnect IMAP client:", err);
        throw new Error("IMAP client not connected and reconnection failed");
      }
    }

    if (!this.imap) {
      throw new Error("IMAP client not connected");
    }

    return new Promise((resolve, reject) => {
      this.imap!.openBox("INBOX", false, (err: Error | null, box: any) => {
        if (err) {
          reject(err);
          return;
        }

        const searchCriteria = since ? ["UNSEEN", ["SINCE", since]] : ["UNSEEN"];

        this.imap!.search(searchCriteria, (err: Error | null, results: number[]) => {
          if (err) {
            reject(err);
            return;
          }

          if (!results || results.length === 0) {
            resolve([]);
            return;
          }

          const fetch = this.imap!.fetch(results, {
            bodies: "",
            markSeen: false,
            struct: true,
          });

          const emails: ParsedEmail[] = [];
          let processed = 0;

          fetch.on("message", (msg: any, seqno: number) => {
            let emailBuffer = Buffer.alloc(0);
            let uid: number | null = null;
            let isAlreadySeen = false;

            msg.once("attributes", (attrs: any) => {
              if (attrs && typeof attrs.uid === "number") {
                uid = attrs.uid;
              }
              if (attrs && Array.isArray(attrs.flags)) {
                isAlreadySeen = attrs.flags.some((f: string) => f.toLowerCase() === "\\Seen");
              }
            });

            msg.on("body", (stream: NodeJS.ReadableStream) => {
              stream.on("data", (chunk: Buffer) => {
                emailBuffer = Buffer.concat([emailBuffer, chunk]);
              });
            });

            msg.once("end", async () => {
              try {
                const parsed = await simpleParser(emailBuffer);
                emails.push({
                  subject: parsed.subject || "",
                  text: parsed.text || "",
                  html: parsed.html || null,
                  from: parsed.from?.text || "",
                  to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((a: any) => (a as any).address || (a as any).name) : [(parsed.to as any).address || (parsed.to as any).name]).filter(Boolean) : [],
                  date: parsed.date || new Date(),
                  messageId: parsed.messageId || "",
                  attachments: parsed.attachments?.map((att: any) => ({
                    filename: att.filename || "attachment",
                    contentType: att.contentType || "application/octet-stream",
                    content: att.content as Buffer,
                  })) || [],
                });

                // Mark as seen after parsing
                const target = uid ?? seqno;
                const useUid = uid != null;
                if (!isAlreadySeen) {
                  try {
                    const imapAny: any = this.imap as any;
                    // node-imap supports an options argument in runtime ({ uid: true }), but some TS typings don't.
                    if (useUid) {
                      if (imapAny?.addFlags?.length >= 4) {
                        imapAny.addFlags(target, "\\Seen", { uid: true }, (err: Error | null) => {
                          if (err) {
                            console.error(`Failed to mark message uid=${target} as seen:`, err);
                          }
                        });
                      } else if (imapAny?.addFlags) {
                        // Fallback: best-effort; may not work on some servers/typings.
                        imapAny.addFlags(target, "\\Seen", (err: Error | null) => {
                          if (err) {
                            console.error(`Failed to mark message uid=${target} as seen:`, err);
                          }
                        });
                      }
                    } else {
                      imapAny.addFlags(target, "\\Seen", (err: Error | null) => {
                        if (err) {
                          console.error(`Failed to mark message seqno=${target} as seen:`, err);
                        }
                      });
                    }
                  } catch (err) {
                    console.error(`Failed to mark message ${useUid ? `uid=${target}` : `seqno=${target}`} as seen:`, err);
                  }
                }
              } catch (parseErr) {
                console.error(`Error parsing email ${seqno}:`, parseErr);
              }

              processed++;
              if (processed === results.length) {
                resolve(emails);
              }
            });
          });

          fetch.once("error", (err: Error) => {
            reject(err);
          });
        });
      });
    });
  }

  startPolling(intervalMs: number = 60000): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(async () => {
      try {
        const emails = await this.fetchNewEmails();
        for (const email of emails) {
          this.emit("email", email);
        }
      } catch (err) {
        console.error(`Email polling error:`, err);
        this.emit("error", err);
        // Don't retry here; fetchNewEmails already handles reconnection
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}
