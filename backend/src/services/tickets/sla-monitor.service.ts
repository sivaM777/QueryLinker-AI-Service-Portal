import { pool } from "../../config/db.js";
import { createApprovalRequest } from "../approvals/approval.service.js";
import { notifySlaRisk } from "../notifications/notification.service.js";

type SlaTicketRow = {
  id: string;
  title: string;
  description: string;
  category: string | null;
  status: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  sla_first_response_due_at: string | null;
  first_response_at: string | null;
  sla_resolution_due_at: string | null;
  created_at: string;
  requester_id: string;
  requester_email: string;
  requester_name: string;
  assigned_team: string | null;
  assigned_agent: string | null;
  last_notified_at: string | null;
  last_notified_risk: string | null;
  sla_first_response_breached_at: string | null;
  sla_resolution_breached_at: string | null;
};

const NOTIFY_COOLDOWN_HOURS = 6;
const ESCALATION_APPROVAL_COOLDOWN_HOURS = 12;

const getWindowHoursForPriority = (priority: "LOW" | "MEDIUM" | "HIGH") => {
  // Simple rules: higher priority → earlier warnings
  if (priority === "HIGH") return 8;
  if (priority === "MEDIUM") return 4;
  return 2;
};

export const checkSlaRisks = async () => {
  const now = new Date();

  const res = await pool.query<SlaTicketRow>(
    `SELECT
       t.id,
       t.title,
       t.description,
       t.category,
       t.status,
       t.priority,
       t.sla_first_response_due_at,
       t.first_response_at,
       t.sla_resolution_due_at,
       t.created_at,
       t.created_by AS requester_id,
       u.email AS requester_email,
       u.name AS requester_name,
       t.assigned_team,
       t.assigned_agent,
       (t.integration_metadata -> 'ai' ->> 'sla_risk_last_notified_at')::text AS last_notified_at,
       (t.integration_metadata -> 'ai' ->> 'sla_risk_last_notified')::text AS last_notified_risk,
       (t.integration_metadata -> 'ai' ->> 'sla_first_response_breached_at')::text AS sla_first_response_breached_at,
       (t.integration_metadata -> 'ai' ->> 'sla_resolution_breached_at')::text AS sla_resolution_breached_at
     FROM tickets t
     JOIN users u ON u.id = t.created_by
     WHERE t.status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER')
       AND t.sla_resolution_due_at IS NOT NULL`
  );

  for (const t of res.rows) {
    const resolutionDue = t.sla_resolution_due_at ? new Date(t.sla_resolution_due_at) : null;
    if (!resolutionDue) continue;

    const msUntilDue = resolutionDue.getTime() - now.getTime();
    const hoursUntilDue = msUntilDue / (60 * 60 * 1000);
    const resolutionBreached = hoursUntilDue <= 0;

    const firstResponseDue = t.sla_first_response_due_at ? new Date(t.sla_first_response_due_at) : null;
    const firstResponseBreached =
      Boolean(firstResponseDue) && !t.first_response_at && now > (firstResponseDue as Date);

    if (firstResponseBreached && !t.sla_first_response_breached_at) {
      try {
        const { processAlerts } = await import("../alerts/alert-rules.service.js");
        await processAlerts({
          ticketId: t.id,
          title: t.title,
          description: t.description,
          category: t.category,
          priority: t.priority,
          status: t.status,
          assignedTeam: t.assigned_team,
          assignedAgent: t.assigned_agent,
          requesterEmail: t.requester_email,
          requesterName: t.requester_name,
          eventType: "SLA_FIRST_RESPONSE_BREACH",
        });
      } catch (err) {
        console.error(`Failed to process SLA first response breach alert for ticket ${t.id}:`, err);
      }

      await pool.query(
        `UPDATE tickets
         SET integration_metadata = jsonb_set(
           COALESCE(integration_metadata, '{}'::jsonb),
           '{ai,sla_first_response_breached_at}',
           to_jsonb($2::text),
           true
         )
         WHERE id = $1`,
        [t.id, now.toISOString()]
      );
    }

    if (resolutionBreached && !t.sla_resolution_breached_at) {
      try {
        const { processAlerts } = await import("../alerts/alert-rules.service.js");
        await processAlerts({
          ticketId: t.id,
          title: t.title,
          description: t.description,
          category: t.category,
          priority: t.priority,
          status: t.status,
          assignedTeam: t.assigned_team,
          assignedAgent: t.assigned_agent,
          requesterEmail: t.requester_email,
          requesterName: t.requester_name,
          eventType: "SLA_RESOLUTION_BREACH",
        });
      } catch (err) {
        console.error(`Failed to process SLA resolution breach alert for ticket ${t.id}:`, err);
      }

      await pool.query(
        `UPDATE tickets
         SET integration_metadata = jsonb_set(
           COALESCE(integration_metadata, '{}'::jsonb),
           '{ai,sla_resolution_breached_at}',
           to_jsonb($2::text),
           true
         )
         WHERE id = $1`,
        [t.id, now.toISOString()]
      );
    }

    let risk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
    if (hoursUntilDue <= 0) {
      risk = "HIGH";
    } else if (hoursUntilDue <= getWindowHoursForPriority(t.priority)) {
      risk = "MEDIUM";
    }

    // Mark integration_metadata.ai.sla_breach_risk for the ticket (null clears it)
    await pool.query(
      `UPDATE tickets
       SET integration_metadata = jsonb_set(
         COALESCE(integration_metadata, '{}'::jsonb),
         '{ai,sla_breach_risk}',
         CASE WHEN $2::text = 'LOW' THEN 'null'::jsonb ELSE to_jsonb($2::text) END,
         true
       )
       WHERE id = $1`,
      [t.id, risk]
    );

    if (risk === "LOW") continue;

    // Create manager escalation approval on breach (HIGH)
    // Cooldown to avoid creating repeated approvals for the same ticket.
    if (risk === "HIGH") {
      const lastEscAt = await pool.query<{ v: string | null }>(
        `SELECT (integration_metadata -> 'ai' ->> 'sla_escalation_last_requested_at')::text AS v
         FROM tickets WHERE id = $1`,
        [t.id]
      );
      const lastEscAtStr = lastEscAt.rows[0]?.v ?? null;
      const lastEsc = lastEscAtStr ? new Date(lastEscAtStr) : null;
      const hoursSinceEsc =
        lastEsc ? (now.getTime() - lastEsc.getTime()) / (60 * 60 * 1000) : Number.POSITIVE_INFINITY;

      if (hoursSinceEsc >= ESCALATION_APPROVAL_COOLDOWN_HOURS) {
        try {
          await createApprovalRequest({
            ticketId: t.id,
            workflowId: "00000000-0000-0000-0000-000000000000",
            workflowExecutionId: null,
            stepIndex: 0,
            actionTitle: "Escalate SLA breach",
            actionBody: `Ticket \"${t.title}\" breached SLA. Approve to reroute to Escalations team (L2/L3) and set priority to HIGH.`,
            inputData: {
              approver: "manager",
              type: "ESCALATION_REROUTE",
              target_team_name: "Escalations",
              force_priority: "HIGH",
              reason: "SLA_BREACH",
            },
          });

          await pool.query(
            `UPDATE tickets
             SET integration_metadata = jsonb_set(
               COALESCE(integration_metadata, '{}'::jsonb),
               '{ai,sla_escalation_last_requested_at}',
               to_jsonb($2::text),
               true
             )
             WHERE id = $1`,
            [t.id, now.toISOString()]
          );
        } catch (err) {
          console.error(`Failed to create escalation approval for ticket ${t.id}:`, err);
        }
      }
    }

    const lastAt = t.last_notified_at ? new Date(t.last_notified_at) : null;
    const lastRisk = t.last_notified_risk ? String(t.last_notified_risk).toUpperCase() : null;
    const hoursSinceLast =
      lastAt ? (now.getTime() - lastAt.getTime()) / (60 * 60 * 1000) : Number.POSITIVE_INFINITY;

    const shouldNotify = lastRisk !== risk || hoursSinceLast >= NOTIFY_COOLDOWN_HOURS;
    if (!shouldNotify) continue;

    const title = risk === "HIGH"
      ? `SLA breach for ticket ${t.id}`
      : `Ticket at risk of SLA breach (${t.id})`;

    const body =
      risk === "HIGH"
        ? `Ticket "${t.title}" has breached its SLA resolution time. Please act immediately.`
        : `Ticket "${t.title}" is approaching its SLA resolution time. Please prioritize this ticket.`;

    await notifySlaRisk({ ticketId: t.id, risk, title, body });

    // Update last-notified telemetry on the ticket
    await pool.query(
      `UPDATE tickets
       SET integration_metadata = jsonb_set(
         jsonb_set(COALESCE(integration_metadata, '{}'::jsonb), '{ai,sla_risk_last_notified}', to_jsonb($2::text), true),
         '{ai,sla_risk_last_notified_at}',
         to_jsonb($3::text),
         true
       )
       WHERE id = $1`,
      [t.id, risk, now.toISOString()]
    );

    // Email/SMS escalation can be added later via alert rules; in-app is enough for demo.
  }
};
