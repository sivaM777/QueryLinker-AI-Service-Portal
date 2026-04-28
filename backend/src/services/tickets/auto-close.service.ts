import { pool } from "../../config/db.js";
import { updateTicketStatus } from "./ticket.service.js";

const DAYS_WAITING_FOR_CUSTOMER = 5;
const DAYS_RESOLVED_BEFORE_CLOSE = 7;

export const autoCloseIdleTickets = async () => {
  const now = new Date();

  // Step 1: remind tickets waiting for customer
  const remindRes = await pool.query<{
    id: string;
    created_by: string;
    title: string;
  }>(
    `SELECT id, created_by, title
     FROM tickets
     WHERE status = 'WAITING_FOR_CUSTOMER'
       AND updated_at <= now() - ($1::int || ' days')::interval`,
    [DAYS_WAITING_FOR_CUSTOMER - 2]
  );

  for (const t of remindRes.rows) {
    await pool.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, false)`,
      [
        t.id,
        t.created_by,
        "We’re still waiting for your response. This ticket will be auto‑closed in 2 days if there is no reply.",
      ]
    );
  }

  // Step 2: actually auto-close old tickets
  const closeRes = await pool.query<{ id: string; created_by: string; title: string }>(
    `SELECT id, created_by, title
     FROM tickets
     WHERE status IN ('WAITING_FOR_CUSTOMER', 'RESOLVED')
       AND updated_at <= now() - ($1::int || ' days')::interval`,
    [DAYS_RESOLVED_BEFORE_CLOSE]
  );

  for (const t of closeRes.rows) {
    await updateTicketStatus({
      ticketId: t.id,
      newStatus: "CLOSED",
      performedBy: t.created_by,
    });

    await pool.query(
      `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal)
       VALUES ($1, $2, $3, false)`,
      [
        t.id,
        t.created_by,
        "This ticket was automatically closed due to inactivity. Reply to this ticket if you would like it to be reopened.",
      ]
    );
  }
};

