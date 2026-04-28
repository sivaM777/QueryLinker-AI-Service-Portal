import { pool } from "../config/db.js";

/**
 * Seed example routing and alert rules for demonstration
 */
const run = async () => {
  // Get teams and users for assignment
  const teamsRes = await pool.query<{ id: string; name: string }>("SELECT id, name FROM teams LIMIT 1");
  const networkTeamId = teamsRes.rows[0]?.id || null;

  const agentsRes = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE role IN ('AGENT', 'ADMIN') LIMIT 1"
  );
  const agentId = agentsRes.rows[0]?.id || null;

  // Example Routing Rules
  const routingRules = [
    {
      name: "Network Issues → Network Team",
      priority: 10,
      enabled: true,
      category_filter: ["Network"],
      priority_filter: null,
      keyword_filter: null,
      assigned_team_id: networkTeamId,
      assigned_agent_id: null,
      auto_priority: "HIGH",
      description: "Automatically route network-related tickets to network team with high priority",
    },
    {
      name: "Urgent Keywords → High Priority",
      priority: 15,
      enabled: true,
      category_filter: null,
      priority_filter: null,
      keyword_filter: ["urgent", "critical", "down", "broken"],
      assigned_team_id: null,
      assigned_agent_id: agentId,
      auto_priority: "HIGH",
      description: "Auto-escalate tickets with urgent keywords",
    },
    {
      name: "Software Issues → Default Agent",
      priority: 5,
      enabled: true,
      category_filter: ["Software"],
      priority_filter: null,
      keyword_filter: null,
      assigned_team_id: null,
      assigned_agent_id: agentId,
      auto_priority: null,
      description: "Route software issues to available agent",
    },
  ];

  for (const rule of routingRules) {
    await pool.query(
      `INSERT INTO routing_rules 
       (name, priority, enabled, category_filter, priority_filter, keyword_filter, 
        assigned_team_id, assigned_agent_id, auto_priority, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [
        rule.name,
        rule.priority,
        rule.enabled,
        rule.category_filter,
        rule.priority_filter,
        rule.keyword_filter,
        rule.assigned_team_id,
        rule.assigned_agent_id,
        rule.auto_priority,
        rule.description,
      ]
    );
  }

  // Example Alert Rules
  const alertRules = [
    {
      name: "High Priority Ticket Alerts",
      enabled: true,
      priority: 10,
      event_type: "TICKET_CREATED",
      conditions: JSON.stringify({ priority: ["HIGH"] }),
      channels: ["EMAIL"],
      recipient_roles: ["ADMIN", "AGENT"],
      recipient_team_ids: null,
      recipient_user_ids: null,
      recipient_emails: null,
      recipient_phones: null,
      webhook_url: null,
      description: "Alert admins and agents when high priority tickets are created",
    },
    {
      name: "SLA Breach Warnings",
      enabled: true,
      priority: 15,
      event_type: "SLA_FIRST_RESPONSE_BREACH",
      conditions: JSON.stringify({}),
      channels: ["EMAIL", "SMS"],
      recipient_roles: ["ADMIN"],
      recipient_team_ids: null,
      recipient_user_ids: null,
      recipient_emails: null,
      recipient_phones: null,
      webhook_url: null,
      description: "Alert admins when SLA is breached",
    },
    {
      name: "Ticket Assignment Notifications",
      enabled: true,
      priority: 5,
      event_type: "TICKET_ASSIGNED",
      conditions: JSON.stringify({}),
      channels: ["EMAIL"],
      recipient_roles: null,
      recipient_team_ids: null,
      recipient_user_ids: null,
      recipient_emails: null,
      recipient_phones: null,
      webhook_url: null,
      description: "Notify assigned agents when tickets are assigned to them",
    },
  ];

  for (const rule of alertRules) {
    await pool.query(
      `INSERT INTO alert_rules 
       (name, enabled, priority, event_type, conditions, channels, recipient_roles,
        recipient_team_ids, recipient_user_ids, recipient_emails, recipient_phones,
        webhook_url, description)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING`,
      [
        rule.name,
        rule.enabled,
        rule.priority,
        rule.event_type,
        rule.conditions,
        rule.channels,
        rule.recipient_roles,
        rule.recipient_team_ids,
        rule.recipient_user_ids,
        rule.recipient_emails,
        rule.recipient_phones,
        rule.webhook_url,
        rule.description,
      ]
    );
  }

  console.log("✅ Example routing and alert rules seeded successfully!");
  console.log("\nRouting Rules:");
  console.log("  - Network Issues → Network Team");
  console.log("  - Urgent Keywords → High Priority");
  console.log("  - Software Issues → Default Agent");
  console.log("\nAlert Rules:");
  console.log("  - High Priority Ticket Alerts");
  console.log("  - SLA Breach Warnings");
  console.log("  - Ticket Assignment Notifications");

  await pool.end();
};

run().catch((err) => {
  console.error("Seed rules failed", err);
  process.exit(1);
});
