import { pool } from "../../config/db.js";
import { GlpiClient, mapGlpiTicketToInternal } from "./glpi-client.js";
import { createTicket } from "../tickets/ticket.service.js";
import { updateTicketStatus, assignTicket } from "../tickets/ticket.service.js";

interface GlpiSyncConfig {
  id: string;
  apiUrl: string;
  appToken: string;
  userToken: string;
  syncIntervalMinutes: number;
  enabled: boolean;
}

/**
 * Record GLPI ingestion event
 */
async function recordGlpiEvent(args: {
  configId: string;
  externalTicketId: string;
  externalUrl?: string;
  action: "CREATED" | "UPDATED" | "IGNORED" | "ERROR";
  reason?: string;
  ticketId?: string;
}) {
  try {
    await pool.query(
      `INSERT INTO glpi_ingestion_events
       (glpi_config_id, external_ticket_id, external_url, action, reason, ticket_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        args.configId,
        args.externalTicketId,
        args.externalUrl || null,
        args.action,
        args.reason || null,
        args.ticketId || null,
      ]
    );
  } catch (error) {
    console.error("Failed to record GLPI ingestion event:", error);
  }
}

/**
 * Sync tickets from GLPI to internal system
 */
export async function syncGlpiTickets(configId: string): Promise<{ created: number; updated: number; errors: any[] }> {
  // Get GLPI config
  const configResult = await pool.query<GlpiSyncConfig>(
    `SELECT
       id,
       api_url as "apiUrl",
       app_token as "appToken",
       user_token as "userToken",
       sync_interval_minutes as "syncIntervalMinutes",
       enabled
     FROM external_system_configs
     WHERE id = $1 AND system_type = 'GLPI'`,
    [configId]
  );

  if (configResult.rows.length === 0) {
    throw new Error(`GLPI config not found: ${configId}`);
  }

  const config = configResult.rows[0];
  if (!config.enabled) {
    return { created: 0, updated: 0, errors: [] };
  }

  // Fix for Docker networking: localhost:8080 -> glpi-web (internal service)
  let clientApiUrl = config.apiUrl;
  if (clientApiUrl.includes("localhost:8080")) {
    clientApiUrl = clientApiUrl.replace("localhost:8080", "glpi-web");
  }

  const client = new GlpiClient({
    apiUrl: clientApiUrl,
    appToken: config.appToken,
    userToken: config.userToken,
  });

  try {
    // Get tickets from GLPI (last sync time could be stored)
    const glpiTickets = await client.getTickets();

    let created = 0;
    let updated = 0;
    const errors: any[] = [];

    for (const glpiTicket of glpiTickets) {
      const externalTicketId = String(glpiTicket.id);
      
      // Generate user-friendly external URL
      // Replace internal docker hostname with localhost for user access
      // Also adjust path from API to frontend
      let externalUrl = config.apiUrl;
      if (externalUrl.includes("glpi-web")) {
        externalUrl = externalUrl.replace("glpi-web", "localhost:8080");
      }
      if (externalUrl.includes("/apirest.php")) {
        externalUrl = externalUrl.replace("/apirest.php", "");
      }
      // Standard GLPI ticket URL format: /front/ticket.form.php?id=ID
      externalUrl = `${externalUrl}/front/ticket.form.php?id=${glpiTicket.id}`;

      // Check if ticket already exists
      try {
        const existingResult = await pool.query(
          `SELECT ticket_id FROM external_ticket_references 
           WHERE external_system = 'GLPI' AND external_ticket_id = $1`,
          [externalTicketId]
        );

        const mapped = mapGlpiTicketToInternal(glpiTicket);

        if (existingResult.rows.length === 0) {
          // Create new ticket
          // Note: We need to find or create user for requester
          // For now, use a system user or the first admin
          const adminResult = await pool.query(
            `SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`
          );

          if (adminResult.rows.length === 0) {
            const errorMsg = "No admin user found to assign ticket";
            console.warn(`No admin user found, skipping GLPI ticket ${glpiTicket.id}`);
            await recordGlpiEvent({
              configId,
              externalTicketId,
              externalUrl,
              action: "ERROR",
              reason: errorMsg,
            });
            errors.push({ ticketId: glpiTicket.id, error: errorMsg });
            continue;
          }

          const adminId = adminResult.rows[0].id;

          try {
            const ticket = await createTicket({
              title: mapped.title,
              description: mapped.description,
              createdBy: adminId,
              performedBy: adminId,
              sourceType: "GLPI",
              type: mapped.type,
              sourceReference: { glpiId: glpiTicket.id },
              integrationMetadata: mapped.externalData,
            });

            // Update status and priority
            if (mapped.status !== "OPEN" || mapped.priority !== "LOW") {
              // Status update would go here if needed
            }

            // Create external reference
            await pool.query(
              `INSERT INTO external_ticket_references 
               (ticket_id, external_system, external_ticket_id, external_url, external_data, sync_status)
               VALUES ($1, 'GLPI', $2, $3, $4, 'success')`,
              [
                ticket.id,
                mapped.externalId,
                externalUrl,
                JSON.stringify(mapped.externalData),
              ]
            );

            await recordGlpiEvent({
              configId,
              externalTicketId,
              externalUrl,
              action: "CREATED",
              ticketId: ticket.id,
            });

            created++;
          } catch (error: any) {
            console.error(`Failed to create ticket for GLPI #${glpiTicket.id}:`, error);
            await recordGlpiEvent({
              configId,
              externalTicketId,
              externalUrl,
              action: "ERROR",
              reason: error.message,
            });
            errors.push({ ticketId: glpiTicket.id, error: error.message });
          }
        } else {
          // Update existing ticket
          const ticketId = existingResult.rows[0].ticket_id;

          try {
            // Update ticket status and type if changed
            const ticketResult = await pool.query(
              `SELECT status, type FROM tickets WHERE id = $1`,
              [ticketId]
            );

            let updatedAction = false;

            if (ticketResult.rows.length > 0) {
              const currentStatus = ticketResult.rows[0].status;
              if (currentStatus !== mapped.status) {
                // Update status (would need performedBy)
                // await updateTicketStatus({ ticketId, newStatus: mapped.status, performedBy: systemUserId });
                updatedAction = true;
              }

              const currentType = ticketResult.rows[0].type;
              if (currentType !== mapped.type) {
                await pool.query('UPDATE tickets SET type = $1 WHERE id = $2', [mapped.type, ticketId]);
                updatedAction = true;
              }
            }

            // Update external reference
            await pool.query(
              `UPDATE external_ticket_references 
               SET external_data = $1, last_synced_at = now(), sync_status = 'success'
               WHERE ticket_id = $2 AND external_system = 'GLPI'`,
              [JSON.stringify(mapped.externalData), ticketId]
            );

            if (updatedAction) {
               await recordGlpiEvent({
                configId,
                externalTicketId,
                externalUrl,
                action: "UPDATED",
                ticketId,
                reason: "Status/Type updated",
              });
              updated++;
            } else {
               // Just synced data, no major changes
               // Optional: record "IGNORED" or "UPDATED" depending on preference
               // For now, let's not spam logs if nothing changed
            }
            
          } catch (error: any) {
             console.error(`Failed to update ticket for GLPI #${glpiTicket.id}:`, error);
             await recordGlpiEvent({
              configId,
              externalTicketId,
              externalUrl,
              action: "ERROR",
              reason: error.message,
              ticketId,
            });
            errors.push({ ticketId: glpiTicket.id, error: error.message });
          }
        }
      } catch (error: any) {
         console.error(`Error processing GLPI ticket #${glpiTicket.id}:`, error);
         errors.push({ ticketId: glpiTicket.id, error: error.message });
      }
    }

    // Update last sync time
    await pool.query(
      `UPDATE external_system_configs SET last_sync_at = now() WHERE id = $1`,
      [configId]
    );

    return { created, updated, errors };
  } finally {
    await client.killSession();
  }
}

/**
 * Sync internal ticket to GLPI
 */
export async function syncTicketToGlpi(
  ticketId: string,
  glpiConfigId: string
): Promise<void> {
  // Get ticket details
  const ticketResult = await pool.query(
    `SELECT t.*, u.email as requester_email
     FROM tickets t
     JOIN users u ON u.id = t.created_by
     WHERE t.id = $1`,
    [ticketId]
  );

  if (ticketResult.rows.length === 0) {
    throw new Error(`Ticket not found: ${ticketId}`);
  }

  const ticket = ticketResult.rows[0];

  // Get GLPI config
  const configResult = await pool.query<GlpiSyncConfig>(
    `SELECT
       id,
       api_url as "apiUrl",
       app_token as "appToken",
       user_token as "userToken",
       sync_interval_minutes as "syncIntervalMinutes",
       enabled
     FROM external_system_configs
     WHERE id = $1 AND system_type = 'GLPI'`,
    [glpiConfigId]
  );

  if (configResult.rows.length === 0) {
    throw new Error(`GLPI config not found: ${glpiConfigId}`);
  }

  const config = configResult.rows[0];
  
  // Fix for Docker networking: localhost:8080 -> glpi-web (internal service)
  let clientApiUrl = config.apiUrl;
  if (clientApiUrl.includes("localhost:8080")) {
    clientApiUrl = clientApiUrl.replace("localhost:8080", "glpi-web");
  }

  const client = new GlpiClient({
    apiUrl: clientApiUrl,
    appToken: config.appToken,
    userToken: config.userToken,
  });

  try {
    // Check if GLPI ticket exists
    const externalRefResult = await pool.query(
      `SELECT external_ticket_id FROM external_ticket_references 
       WHERE ticket_id = $1 AND external_system = 'GLPI'`,
      [ticketId]
    );

    // Map internal status to GLPI status
    const statusMap: Record<string, number> = {
      OPEN: 1,
      IN_PROGRESS: 2,
      RESOLVED: 3,
      CLOSED: 4,
    };

    const priorityMap: Record<string, number> = {
      LOW: 2,
      MEDIUM: 3,
      HIGH: 5,
    };

    if (externalRefResult.rows.length > 0) {
      // Update existing GLPI ticket
      const glpiTicketId = parseInt(externalRefResult.rows[0].external_ticket_id);
      await client.updateTicket(glpiTicketId, {
        status: statusMap[ticket.status] || 1,
        priority: priorityMap[ticket.priority] || 3,
        name: ticket.title,
        content: ticket.description,
      } as any);
    } else {
      // Create new GLPI ticket
      const glpiTicket = await client.createTicket({
        name: ticket.title,
        content: ticket.description,
        status: statusMap[ticket.status] || 1,
        priority: priorityMap[ticket.priority] || 3,
      } as any);

      // Create external reference
      await pool.query(
        `INSERT INTO external_ticket_references 
         (ticket_id, external_system, external_ticket_id, external_url, external_data, sync_status)
         VALUES ($1, 'GLPI', $2, $3, $4, 'success')`,
        [
          ticketId,
          String(glpiTicket.id),
          `${config.apiUrl}/Ticket/${glpiTicket.id}`,
          JSON.stringify({ glpiId: glpiTicket.id }),
        ]
      );
    }
  } finally {
    await client.killSession();
  }
}

/**
 * Sync all enabled GLPI configs
 */
export async function syncAllGlpiConfigs(): Promise<void> {
  try {
    const configs = await pool.query<{ id: string }>(
      "SELECT id FROM external_system_configs WHERE system_type = 'GLPI' AND enabled = true"
    );
    
    if (configs.rows.length === 0) return;
    
    console.log(`Starting auto-sync for ${configs.rows.length} GLPI configs...`);

    for (const config of configs.rows) {
      try {
        await syncGlpiTickets(config.id);
      } catch (err: any) {
        console.error(`Failed to auto-sync GLPI config ${config.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Failed to query GLPI configs for auto-sync:", err);
  }
}
