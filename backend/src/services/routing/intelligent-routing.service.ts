import { pool } from "../../config/db.js";
import { assignTicket } from "../tickets/ticket.service.js";
import { calculateComplexityScore, updateTicketComplexity } from "./complexity-scoring.service.js";

export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  category_filter: string[] | null;
  priority_filter: string[] | null;
  keyword_filter: string[] | null;
  urgency_keywords: string[] | null;
  assigned_team_id: string | null;
  assigned_agent_id: string | null;
  auto_priority: string | null;
}

export interface RoutingResult {
  teamId: string | null;
  agentId: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  confidence: number;
  method: "rule" | "ml" | "fallback" | "complexity";
  appliedRules: string[];
}

export async function findLeastLoadedAgent(): Promise<string | null> {
  const res = await pool.query<{ id: string }>(
    `SELECT u.id
     FROM users u
     LEFT JOIN agent_workload w ON w.agent_id = u.id
     WHERE u.role IN ('AGENT', 'ADMIN')
     ORDER BY (
       (COALESCE(w.high_priority_count, 0) * 4) + 
       (COALESCE(w.medium_priority_count, 0) * 2) + 
       (COALESCE(w.low_priority_count, 0) * 1)
     ) ASC, u.created_at ASC
     LIMIT 1`
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Find matching routing rules for a ticket
 */
export async function findMatchingRules(args: {
  category: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  description: string;
  title: string;
}): Promise<RoutingRule[]> {
  const rules = await pool.query<RoutingRule>(
    `SELECT * FROM routing_rules 
     WHERE enabled = true 
     ORDER BY priority DESC, created_at ASC`
  );

  const matchingRules: RoutingRule[] = [];
  const text = `${args.title} ${args.description}`.toLowerCase();

  for (const rule of rules.rows) {
    let matches = true;

    // Check category filter
    if (rule.category_filter && rule.category_filter.length > 0) {
      if (!args.category || !rule.category_filter.includes(args.category)) {
        matches = false;
      }
    }

    // Check priority filter
    if (rule.priority_filter && rule.priority_filter.length > 0) {
      if (!rule.priority_filter.includes(args.priority)) {
        matches = false;
      }
    }

    // Check keyword filter (all keywords must be present)
    if (rule.keyword_filter && rule.keyword_filter.length > 0) {
      const allKeywordsPresent = rule.keyword_filter.every((keyword: string) =>
        text.includes(keyword.toLowerCase())
      );
      if (!allKeywordsPresent) {
        matches = false;
      }
    }

    if (matches) {
      matchingRules.push(rule);
    }
  }

  return matchingRules;
}

/**
 * Detect urgency from ticket content
 */
export function detectUrgency(args: {
  title: string;
  description: string;
  urgencyKeywords?: string[];
}): "LOW" | "MEDIUM" | "HIGH" {
  const urgencyKeywords = args.urgencyKeywords || [
    "urgent",
    "critical",
    "asap",
    "immediately",
    "emergency",
    "down",
    "broken",
    "not working",
    "blocked",
  ];

  const text = `${args.title} ${args.description}`.toLowerCase();
  const hasUrgency = urgencyKeywords.some((keyword) => text.includes(keyword.toLowerCase()));

  if (hasUrgency) {
    // Check for multiple urgency indicators
    const urgencyCount = urgencyKeywords.filter((keyword) =>
      text.includes(keyword.toLowerCase())
    ).length;
    return urgencyCount >= 3 ? "HIGH" : "MEDIUM";
  }

  return "LOW";
}

/**
 * Get agent workload for balancing
 */
export async function getAgentWorkload(agentId: string): Promise<{
  openTickets: number;
  inProgressTickets: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
  totalWorkload: number;
  weightedScore: number;
}> {
  const result = await pool.query(
    `SELECT 
       open_tickets_count, 
       in_progress_tickets_count,
       high_priority_count,
       medium_priority_count,
       low_priority_count
     FROM agent_workload 
     WHERE agent_id = $1`,
    [agentId]
  );

  if (result.rows.length === 0) {
    return { 
      openTickets: 0, 
      inProgressTickets: 0, 
      highPriority: 0,
      mediumPriority: 0,
      lowPriority: 0,
      totalWorkload: 0,
      weightedScore: 0
    };
  }

  const row = result.rows[0];
  const high = row.high_priority_count || 0;
  const medium = row.medium_priority_count || 0;
  const low = row.low_priority_count || 0;
  
  return {
    openTickets: row.open_tickets_count || 0,
    inProgressTickets: row.in_progress_tickets_count || 0,
    highPriority: high,
    mediumPriority: medium,
    lowPriority: low,
    totalWorkload: (row.open_tickets_count || 0) + (row.in_progress_tickets_count || 0),
    weightedScore: (high * 4) + (medium * 2) + (low * 1)
  };
}

/**
 * Find best team for a given support level and category
 */
export async function findTeamBySupportLevel(
  supportLevel: "L1" | "L2" | "L3",
  category: string | null
): Promise<string | null> {
  const result = await pool.query(
    `SELECT id FROM teams 
     WHERE support_level = $1 
     ORDER BY 
       CASE WHEN $2::text = ANY(STRING_TO_ARRAY(ARRAY_AGG(name), ',')) THEN 1 ELSE 2 END,
       created_at ASC
     LIMIT 1`,
    [supportLevel, category]
  );
  
  return result.rows[0]?.id || null;
}

/**
 * Find best agent for a category based on skills and workload
 */
export async function findBestAgentForCategory(
  category: string | null,
  teamId: string | null
): Promise<string | null> {
  if (!category) {
    return null;
  }

  // Get agents with skills in this category, optionally filtered by team
  let query = `
    SELECT 
      s.agent_id,
      s.skill_level,
      u.max_concurrent_tickets,
      (
        (COALESCE(w.high_priority_count, 0) * 4) + 
        (COALESCE(w.medium_priority_count, 0) * 2) + 
        (COALESCE(w.low_priority_count, 0) * 1)
      ) as weighted_score,
      COALESCE(p.resolved_30d, 0) as resolved_30d
    FROM agent_skills s
    JOIN users u ON u.id = s.agent_id
    LEFT JOIN agent_workload w ON w.agent_id = s.agent_id
    LEFT JOIN (
      SELECT assigned_agent AS agent_id, COUNT(*)::int AS resolved_30d
      FROM tickets
      WHERE assigned_agent IS NOT NULL
        AND status IN ('RESOLVED', 'CLOSED')
        AND updated_at >= now() - interval '30 days'
      GROUP BY assigned_agent
    ) p ON p.agent_id = s.agent_id
    WHERE s.category = $1
      AND u.role IN ('AGENT', 'ADMIN')
      AND (COALESCE(w.open_tickets_count, 0) + COALESCE(w.in_progress_tickets_count, 0)) < u.max_concurrent_tickets
  `;

  const params: any[] = [category];

  if (teamId) {
    query += ` AND EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = s.agent_id AND u.team_id = $2
    )`;
    params.push(teamId);
  }

  query += `
    ORDER BY s.skill_level DESC, resolved_30d DESC, weighted_score ASC
    LIMIT 1
  `;

  const result = await pool.query(query, params);
  return result.rows.length > 0 ? result.rows[0].agent_id : null;
}

/**
 * Intelligent routing: Determine team and agent for a ticket
 */
export async function routeTicket(args: {
  ticketId: string;
  category: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  description: string;
  performedBy: string;
}): Promise<RoutingResult> {
  // Step 0: Calculate complexity and update ticket
  const complexity = await calculateComplexityScore({
    category: args.category,
    priority: args.priority,
    title: args.title,
    description: args.description,
    keywords: [],
  });
  
  await updateTicketComplexity(args.ticketId, complexity, args.performedBy);
  
  // Step 1: Find matching routing rules
  const matchingRules = await findMatchingRules({
    category: args.category,
    priority: args.priority,
    description: args.description,
    title: args.title,
  });

  // Step 2: Apply first matching rule (highest priority)
  if (matchingRules.length > 0) {
    const rule = matchingRules[0];
    let teamId = rule.assigned_team_id;
    let agentId = rule.assigned_agent_id;
    let priority = args.priority;

    // Override priority if rule specifies
    if (rule.auto_priority) {
      priority = rule.auto_priority as "LOW" | "MEDIUM" | "HIGH";
    }

    // If rule assigns team but not agent, find best agent
    if (teamId && !agentId) {
      agentId = await findBestAgentForCategory(args.category, teamId);
    }

    // If rule assigns agent, verify they're available
    if (agentId) {
      const workload = await getAgentWorkload(agentId);
      // If agent has too many tickets, try to find alternative
      if (workload.totalWorkload > 20) {
        agentId = await findBestAgentForCategory(args.category, teamId);
      }
    }

    return {
      teamId,
      agentId,
      priority,
      confidence: 0.8,
      method: "rule",
      appliedRules: [rule.id],
    };
  }

  // Step 3: Use complexity-based routing if no rules match
  const recommendedTeamId = await findTeamBySupportLevel(complexity.recommended_level, args.category);
  const recommendedAgentId = recommendedTeamId ? await findBestAgentForCategory(args.category, recommendedTeamId) : null;

  if (recommendedTeamId) {
    return {
      teamId: recommendedTeamId,
      agentId: recommendedAgentId,
      priority: args.priority,
      confidence: complexity.confidence,
      method: "complexity",
      appliedRules: [],
    };
  }

  // Step 3: Check for urgency and auto-assign if high priority
  const urgency = detectUrgency({
    title: args.title,
    description: args.description,
  });

  if (urgency === "HIGH" && args.priority !== "HIGH") {
    // Find team/agent for urgent tickets
    // This could be a default "urgent" team
    const urgentTeamResult = await pool.query(
      `SELECT id FROM teams WHERE name ILIKE '%urgent%' OR name ILIKE '%critical%' LIMIT 1`
    );

    if (urgentTeamResult.rows.length > 0) {
      return {
        teamId: urgentTeamResult.rows[0].id,
        agentId: null,
        priority: "HIGH",
        confidence: 0.6,
        method: "fallback",
        appliedRules: [],
      };
    }
  }

  // Step 4: Fallback - no auto-assignment
  // Try skill/workload assignment even without explicit rules
  try {
    const skilledAgent = await findBestAgentForCategory(args.category, null);
    if (skilledAgent) {
      const workload = await getAgentWorkload(skilledAgent);
      if (workload.totalWorkload <= 20) {
        return {
          teamId: null,
          agentId: skilledAgent,
          priority: args.priority,
          confidence: 0.6,
          method: "fallback",
          appliedRules: [],
        };
      }
    }
  } catch {
    // ignore
  }

  try {
    const leastLoaded = await findLeastLoadedAgent();
    if (leastLoaded) {
      return {
        teamId: null,
        agentId: leastLoaded,
        priority: args.priority,
        confidence: 0.6,
        method: "fallback",
        appliedRules: [],
      };
    }
  } catch {
    // ignore
  }

  return {
    teamId: null,
    agentId: null,
    priority: args.priority,
    confidence: 0.0,
    method: "fallback",
    appliedRules: [],
  };
}

/**
 * Apply routing to a ticket
 */
export async function applyRouting(
  ticketId: string,
  routingResult: RoutingResult,
  performedBy: string
): Promise<void> {
  // Log routing decision
  await pool.query(
    `INSERT INTO routing_history 
     (ticket_id, routing_method, suggested_team_id, suggested_agent_id, 
      actual_team_id, actual_agent_id, confidence_score, routing_rules_applied)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ticketId,
      routingResult.method,
      routingResult.teamId,
      routingResult.agentId,
      routingResult.teamId,
      routingResult.agentId,
      routingResult.confidence,
      routingResult.appliedRules,
    ]
  );

  await pool.query(
    `INSERT INTO ticket_events (ticket_id, action, old_value, new_value, performed_by)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)`,
    [
      ticketId,
      "STATUS_CHANGED",
      null,
      JSON.stringify({
        stage: "AI_ROUTING_APPLIED",
        method: routingResult.method,
        confidence: routingResult.confidence,
        assigned_team_id: routingResult.teamId,
        assigned_agent_id: routingResult.agentId,
        applied_rules: routingResult.appliedRules,
      }),
      performedBy,
    ]
  );

  // Apply assignment if confidence is high enough
  if (routingResult.confidence >= 0.6 && (routingResult.teamId || routingResult.agentId)) {
    await assignTicket({
      ticketId,
      assignedTeam: routingResult.teamId,
      assignedAgent: routingResult.agentId,
      performedBy,
    });
  }
}
