import { pool } from "../../config/db.js";
import { SolmanClient, mapSolmanTicketToInternal } from "./solman-client.js";
import { createTicket } from "../tickets/ticket.service.js";

type SolmanSyncConfig = {
  id: string;
  apiUrl: string;
  username: string | null;
  password: string | null;
  clientId: string | null;
  clientSecret: string | null;
  enabled: boolean;
  syncIntervalMinutes: number;
};

export async function syncSolmanTickets(configId: string): Promise<{ created: number; updated: number }> {
  const configResult = await pool.query<SolmanSyncConfig>(
    `SELECT
       id,
       api_url as "apiUrl",
       username,
       password,
       api_token as "clientId",
       api_key as "clientSecret",
       enabled,
       sync_interval_minutes as "syncIntervalMinutes"
     FROM external_system_configs
     WHERE id = $1 AND system_type = 'SOLMAN'`,
    [configId]
  );

  if (configResult.rows.length === 0) {
    throw new Error(`Solman config not found: ${configId}`);
  }

  const config = configResult.rows[0];
  if (!config.enabled) return { created: 0, updated: 0 };

  const client = new SolmanClient({
    apiUrl: config.apiUrl,
    username: config.username || "",
    password: config.password || "",
    clientId: config.clientId || undefined,
    clientSecret: config.clientSecret || undefined,
  });

  const solmanTickets = await client.getTickets();

  let created = 0;
  let updated = 0;

  const insertEvent = async (args: {
    externalTicketId: string | null;
    externalUrl: string | null;
    action: "CREATED" | "UPDATED" | "ERROR" | "IGNORED";
    reason?: string | null;
    ticketId?: string | null;
  }) => {
    await pool.query(
      `INSERT INTO solman_ingestion_events
        (solman_config_id, external_ticket_id, external_url, action, reason, ticket_id)
       VALUES
        ($1, $2, $3, $4, $5, $6)`,
      [configId, args.externalTicketId, args.externalUrl, args.action, args.reason ?? null, args.ticketId ?? null]
    );
  };

  for (const solmanTicket of solmanTickets) {
    const mapped = mapSolmanTicketToInternal(solmanTicket);
    const externalUrl = config.apiUrl.startsWith("mock://")
      ? null
      : `${config.apiUrl}/incidents/${mapped.externalId}`;

    try {
      const existingResult = await pool.query<{ ticket_id: string }>(
        `SELECT ticket_id FROM external_ticket_references
         WHERE external_system = 'SOLMAN' AND external_ticket_id = $1`,
        [mapped.externalId]
      );

      if (existingResult.rows.length === 0) {
        const adminResult = await pool.query<{ id: string }>(
          `SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`
        );
        const adminId = adminResult.rows[0]?.id;
        if (!adminId) {
          await insertEvent({
            externalTicketId: mapped.externalId,
            externalUrl,
            action: "ERROR",
            reason: "No admin user available for Solman ticket ingestion",
          });
          continue;
        }

        const ticket = await createTicket({
          title: mapped.title,
          description: mapped.description,
          createdBy: adminId,
          performedBy: adminId,
          sourceType: "SOLMAN",
          sourceReference: { solmanId: mapped.externalId },
          integrationMetadata: mapped.externalData,
        });

        await pool.query(
          `INSERT INTO external_ticket_references
           (ticket_id, external_system, external_ticket_id, external_url, external_data, sync_status)
           VALUES ($1, 'SOLMAN', $2, $3, $4, 'success')`,
          [ticket.id, mapped.externalId, externalUrl, JSON.stringify(mapped.externalData)]
        );

        await insertEvent({
          externalTicketId: mapped.externalId,
          externalUrl,
          action: "CREATED",
          ticketId: ticket.id,
        });
        created += 1;
      } else {
        const ticketId = existingResult.rows[0]!.ticket_id;
        await pool.query(
          `UPDATE external_ticket_references
           SET external_data = $1,
               external_url = $2,
               last_synced_at = now(),
               sync_status = 'success'
           WHERE ticket_id = $3 AND external_system = 'SOLMAN'`,
          [JSON.stringify(mapped.externalData), externalUrl, ticketId]
        );

        await insertEvent({
          externalTicketId: mapped.externalId,
          externalUrl,
          action: "UPDATED",
          ticketId,
        });
        updated += 1;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown Solman ingestion error";
      await insertEvent({
        externalTicketId: mapped.externalId,
        externalUrl,
        action: "ERROR",
        reason: message,
      });
    }
  }

  await pool.query(`UPDATE external_system_configs SET last_sync_at = now() WHERE id = $1`, [configId]);
  return { created, updated };
}
