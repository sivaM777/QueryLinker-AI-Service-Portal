import { createHash } from "crypto";
import { pool } from "../../config/db.js";
import {
  dispatchNotification,
  type NotificationAudienceRole,
} from "../notifications/notification.service.js";
import type { TicketPriority, TicketStatus } from "./ticket.service.js";

type TicketWatcherRow = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: NotificationAudienceRole;
  created_at: string;
};

type TicketWatcherContext = {
  ticket_id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  requester_id: string;
  requester_name: string;
  assigned_agent_id: string | null;
  assigned_team_name: string | null;
};

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

const buildActionUrl = (role: NotificationAudienceRole, ticketId: string) =>
  role === "EMPLOYEE" ? `/app/tickets/${ticketId}` : `/admin/tickets/${ticketId}`;

const getTicketWatcherContext = async (ticketId: string): Promise<TicketWatcherContext | null> => {
  const result = await pool.query<TicketWatcherContext>(
    `SELECT
       t.id AS ticket_id,
       t.title,
       t.status,
       t.priority,
       requester.id AS requester_id,
       requester.name AS requester_name,
       agent.id AS assigned_agent_id,
       team.name AS assigned_team_name
     FROM tickets t
     JOIN users requester ON requester.id = t.created_by
     LEFT JOIN users agent ON agent.id = t.assigned_agent
     LEFT JOIN teams team ON team.id = t.assigned_team
     WHERE t.id = $1`,
    [ticketId]
  );
  return result.rows[0] ?? null;
};

const getWatcherRecipients = async (args: {
  ticketId: string;
  excludeUserIds?: string[];
}): Promise<TicketWatcherRow[]> => {
  const excludes = Array.from(new Set((args.excludeUserIds || []).filter(Boolean)));
  const result = await pool.query<TicketWatcherRow>(
    `SELECT tw.id, tw.user_id, u.name, u.email, u.role, tw.created_at
     FROM ticket_watchers tw
     JOIN users u ON u.id = tw.user_id
     WHERE tw.ticket_id = $1
       AND (
         cardinality($2::uuid[]) = 0
         OR tw.user_id <> ALL($2::uuid[])
       )
     ORDER BY tw.created_at DESC`,
    [args.ticketId, excludes]
  );
  return result.rows;
};

const containsWatcherMention = (body: string, watcher: Pick<TicketWatcherRow, "name" | "email">) => {
  const text = String(body || "").toLowerCase();
  if (!text.includes("@")) return false;

  const candidates = new Set<string>();
  const email = watcher.email.toLowerCase();
  const localPart = email.split("@")[0] || email;
  const compactName = watcher.name.toLowerCase().replace(/\s+/g, "");
  const dashedName = watcher.name.toLowerCase().trim().replace(/\s+/g, "-");
  const dottedName = watcher.name.toLowerCase().trim().replace(/\s+/g, ".");

  candidates.add(`@${email}`);
  candidates.add(`@${localPart}`);
  candidates.add(`@${compactName}`);
  candidates.add(`@${dashedName}`);
  candidates.add(`@${dottedName}`);

  for (const token of candidates) {
    if (token.length > 1 && text.includes(token)) {
      return true;
    }
  }
  return false;
};

export const getTicketWatchers = async (ticketId: string): Promise<TicketWatcherRow[]> =>
  getWatcherRecipients({ ticketId });

export const addTicketWatcher = async (args: {
  ticketId: string;
  userId: string;
  createdBy?: string | null;
}) => {
  await pool.query(
    `INSERT INTO ticket_watchers (ticket_id, user_id, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (ticket_id, user_id) DO NOTHING`,
    [args.ticketId, args.userId, args.createdBy ?? null]
  );
  const watchers = await getWatcherRecipients({ ticketId: args.ticketId });
  return watchers.find((watcher) => watcher.user_id === args.userId) ?? null;
};

export const removeTicketWatcher = async (args: { ticketId: string; userId: string }) => {
  await pool.query(`DELETE FROM ticket_watchers WHERE ticket_id = $1 AND user_id = $2`, [args.ticketId, args.userId]);
};

export const notifyTicketWatchersStatusChanged = async (args: {
  ticketId: string;
  actorUserId?: string | null;
  previousStatus: TicketStatus;
  nextStatus: TicketStatus;
}) => {
  const context = await getTicketWatcherContext(args.ticketId);
  if (!context) return;

  const watchers = await getWatcherRecipients({
    ticketId: args.ticketId,
    excludeUserIds: [args.actorUserId ?? "", context.requester_id, context.assigned_agent_id ?? ""],
  });

  await Promise.all(
    watchers.map((watcher) =>
      dispatchNotification({
        userId: watcher.user_id,
        ticketId: args.ticketId,
        actorUserId: args.actorUserId ?? null,
        audienceRole: watcher.role,
        type: "TICKET_STATUS_CHANGED",
        title: "Watched ticket updated",
        body: `${context.title} moved from ${args.previousStatus.replaceAll("_", " ").toLowerCase()} to ${args.nextStatus
          .replaceAll("_", " ")
          .toLowerCase()}.`,
        actionUrl: buildActionUrl(watcher.role, args.ticketId),
        metadata: {
          watched: true,
          previousStatus: args.previousStatus,
          status: args.nextStatus,
          priority: context.priority,
        },
        dedupeKey: sha256Hex(["watch-status", watcher.user_id, args.ticketId, args.previousStatus, args.nextStatus].join("|")),
        emailEnabled: true,
        emailTo: watcher.email,
      })
    )
  );
};

export const notifyTicketWatchersAssignmentChanged = async (args: {
  ticketId: string;
  actorUserId?: string | null;
  assignedTeamId?: string | null;
  assignedAgentId?: string | null;
}) => {
  const context = await getTicketWatcherContext(args.ticketId);
  if (!context) return;

  const watchers = await getWatcherRecipients({
    ticketId: args.ticketId,
    excludeUserIds: [args.actorUserId ?? "", context.requester_id, args.assignedAgentId ?? ""],
  });

  await Promise.all(
    watchers.map((watcher) =>
      dispatchNotification({
        userId: watcher.user_id,
        ticketId: args.ticketId,
        actorUserId: args.actorUserId ?? null,
        audienceRole: watcher.role,
        type: "TICKET_ASSIGNED",
        title: "Watched ticket reassigned",
        body: `${context.title} was routed to ${context.assigned_team_name || "a support team"}.`,
        actionUrl: buildActionUrl(watcher.role, args.ticketId),
        metadata: {
          watched: true,
          priority: context.priority,
          status: context.status,
          assignedTeamId: args.assignedTeamId ?? null,
          assignedAgentId: args.assignedAgentId ?? null,
        },
        dedupeKey: sha256Hex([
          "watch-assignment",
          watcher.user_id,
          args.ticketId,
          args.assignedTeamId ?? "",
          args.assignedAgentId ?? "",
        ].join("|")),
        emailEnabled: true,
        emailTo: watcher.email,
      })
    )
  );
};

export const notifyTicketWatchersCommented = async (args: {
  ticketId: string;
  actorUserId: string;
  body: string;
  visibility: "INTERNAL_NOTE" | "REQUESTER_COMMENT";
}) => {
  const context = await getTicketWatcherContext(args.ticketId);
  if (!context) return;

  const watchers = await getWatcherRecipients({
    ticketId: args.ticketId,
    excludeUserIds: [args.actorUserId, context.requester_id, context.assigned_agent_id ?? ""],
  });

  const recipients =
    args.visibility === "INTERNAL_NOTE"
      ? watchers.filter((watcher) => containsWatcherMention(args.body, watcher))
      : watchers;

  if (!recipients.length) return;

  await Promise.all(
    recipients.map((watcher) =>
      dispatchNotification({
        userId: watcher.user_id,
        ticketId: args.ticketId,
        actorUserId: args.actorUserId,
        audienceRole: watcher.role,
        type: "TICKET_COMMENTED",
        title: args.visibility === "INTERNAL_NOTE" ? "Mentioned on a watched ticket" : "New activity on a watched ticket",
        body:
          args.visibility === "INTERNAL_NOTE"
            ? `You were mentioned on ${context.title}.`
            : `A new update was added to ${context.title}.`,
        actionUrl: buildActionUrl(watcher.role, args.ticketId),
        metadata: {
          watched: true,
          priority: context.priority,
          status: context.status,
          visibility: args.visibility,
        },
        dedupeKey: sha256Hex(["watch-comment", watcher.user_id, args.ticketId, Date.now(), args.visibility].join("|")),
        emailEnabled: true,
        emailTo: watcher.email,
      })
    )
  );
};
