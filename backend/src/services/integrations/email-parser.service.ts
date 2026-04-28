import { pool } from "../../config/db.js";
import { createTicket } from "../tickets/ticket.service.js";
import { findUserByEmail } from "../auth/auth.service.js";
import { ParsedEmail } from "./imap-client.js";
import { sendMail } from "../tickets/ticket.service.js";
import type { TicketType } from "../tickets/ticket.service.js";

export interface EmailTicketData {
  title: string;
  description: string;
  requesterEmail: string;
  requesterId?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
  }>;
}

/**
 * Extract ticket information from email
 */
export function parseEmailToTicket(email: ParsedEmail): EmailTicketData {
  // Use subject as title, or first line of body if subject is empty
  let title = email.subject.trim();
  if (!title || title.length === 0) {
    const firstLine = email.text.split("\n")[0]?.trim() || "";
    title = firstLine.length > 200 ? firstLine.substring(0, 197) + "..." : firstLine;
  }
  if (title.length > 200) {
    title = title.substring(0, 197) + "...";
  }

  // Use text body as description, strip email signatures
  let description = email.text.trim();
  
  // Remove common email signature patterns
  description = description.replace(/--\s*\n.*$/s, ""); // Everything after "--"
  description = description.replace(/Sent from.*$/i, "");
  description = description.replace(/This email.*$/i, "");
  
  // Limit description length
  if (description.length > 2000) {
    description = description.substring(0, 1997) + "...";
  }

  // Extract email address from "from" field
  const emailMatch = email.from.match(/<([^>]+)>/) || email.from.match(/([\w\.-]+@[\w\.-]+\.\w+)/);
  const requesterEmail = emailMatch ? emailMatch[1] || emailMatch[0] : email.from;

  return {
    title: title || "Ticket from Email",
    description: description || "No description provided",
    requesterEmail: requesterEmail.toLowerCase(),
    attachments: email.attachments,
  };
}

/**
 * Create ticket from email
 */
export async function createTicketFromEmail(
  email: ParsedEmail,
  emailSourceId: string,
  opts?: {
    ticketType?: TicketType;
    triage?: Record<string, any>;
  }
): Promise<string> {
  const ticketData = parseEmailToTicket(email);

  // Only allow registered users to create tickets via email
  const user = await findUserByEmail(ticketData.requesterEmail);
  if (!user) {
    throw new Error("Unknown sender");
  }
  const requesterId = user.id;

  const ticketType: TicketType = opts?.ticketType ?? "INCIDENT";
  const triageMeta = opts?.triage ?? null;

  // Create ticket
  const ticket = await createTicket({
    title: ticketData.title,
    description: ticketData.description,
    createdBy: requesterId,
    performedBy: requesterId,
    type: ticketType,
    integrationMetadata: triageMeta ? { triage: triageMeta } : undefined,
  });

  // Update ticket with source information
  await pool.query(
    `UPDATE tickets 
     SET source_type = 'EMAIL',
         source_reference = $1,
         integration_metadata = COALESCE(integration_metadata, '{}'::jsonb) || $2
     WHERE id = $3`,
    [
      JSON.stringify({ email_source_id: emailSourceId, message_id: email.messageId, sender_email: ticketData.requesterEmail }),
      JSON.stringify({
        from: email.from,
        to: email.to,
        date: email.date.toISOString(),
        has_attachments: (ticketData.attachments?.length || 0) > 0,
      }),
      ticket.id,
    ]
  );

  // Store attachments if any (could be stored in S3 or file system)
  if (ticketData.attachments && ticketData.attachments.length > 0) {
    for (const attachment of ticketData.attachments) {
      await pool.query(
        `INSERT INTO ticket_attachments
          (ticket_id, filename, content_type, size_bytes, content, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          ticket.id,
          attachment.filename,
          attachment.contentType,
          attachment.content.length,
          attachment.content,
          requesterId,
        ]
      );
    }
  }

  // Send professional auto-reply email
  await sendMail({
    to: ticketData.requesterEmail,
    subject: `Re: [TICKET-${ticket.display_number}] ${ticketData.title}`,
    text: `Thank you for your email. We have received your request and created a ticket for it.

Ticket Number: ${ticket.display_number}
Title: ${ticketData.title}
Description: ${ticketData.description.length > 200 ? ticketData.description.substring(0, 197) + '...' : ticketData.description}

You can track the status and reply to this email to add updates.

Best regards,
IT Support Team`
  });

  return ticket.id;
}

/**
 * Check if email is a reply to an existing ticket
 */
export async function findTicketByEmailReply(email: ParsedEmail): Promise<string | null> {
  // Check if email subject contains ticket reference
  // Format: "Re: [TICKET-123] Original subject"
  const ticketIdMatch = email.subject.match(/\[TICKET-([a-f0-9-]+)\]/i);
  if (ticketIdMatch) {
    return ticketIdMatch[1];
  }

  // Check if email is a reply to a notification email
  // Look for In-Reply-To header in metadata
  // This would require storing message IDs when sending notifications
  
  return null;
}
