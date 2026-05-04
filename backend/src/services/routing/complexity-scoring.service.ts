import { pool } from "../../config/db.js";

export interface ComplexityFactors {
  category: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH";
  title: string;
  description: string;
  keywords: string[];
}

interface ScoreFactors {
  category: number;
  priority: number;
  keywords: number;
  length: number;
  urgency: number;
}

export interface ComplexityScore {
  score: number; // 1-10
  confidence: number; // 0-1
  factors: {
    category: number;
    priority: number;
    keywords: number;
    length: number;
    urgency: number;
  };
  recommended_level: "L1" | "L2" | "L3";
  reasoning: string[];
}

/**
 * Category complexity mapping
 */
const CATEGORY_COMPLEXITY: Record<string, number> = {
  "IDENTITY_ACCESS": 2, // Password resets, account unlocks - L1 level
  "EMAIL_COLLAB": 3, // Email issues - mostly L1, some L2
  "HARDWARE_PERIPHERAL": 4, // Basic hardware - L1/L2 boundary
  "NETWORK_VPN_WIFI": 5, // Network issues - L2 level
  "SOFTWARE_INSTALL_LICENSE": 6, // Software installation - L2 level
  "BUSINESS_APP_ERP_CRM": 7, // Business applications - L2/L3 boundary
  "SECURITY_INCIDENT": 9, // Security issues - L3 level
  "INFRASTRUCTURE": 8, // Infrastructure - L3 level
  "DATABASE": 9, // Database issues - L3 level
};

/**
 * Priority complexity weights
 */
const PRIORITY_WEIGHTS: Record<string, number> = {
  "LOW": 1,
  "MEDIUM": 2,
  "HIGH": 3,
};

/**
 * Urgency keywords that increase complexity
 */
const URGENCY_KEYWORDS = [
  "urgent", "critical", "asap", "immediately", "emergency",
  "down", "broken", "not working", "blocked", "failure",
  "crash", "corrupt", "lost", "stolen", "breach",
  "production", "customer", "revenue", "legal", "compliance"
];

/**
 * Technical complexity keywords
 */
const TECHNICAL_KEYWORDS = [
  "api", "database", "server", "network", "infrastructure",
  "firewall", "vpn", "active directory", "ldap", "dns",
  "certificate", "encryption", "backup", "disaster recovery",
  "integration", "migration", "upgrade", "patch", "configuration"
];

/**
 * Calculate complexity score for a ticket
 */
export async function calculateComplexityScore(factors: ComplexityFactors): Promise<ComplexityScore> {
  const { category, priority, title, description, keywords } = factors;
  const text = `${title} ${description}`.toLowerCase();
  const words = text.split(/\s+/).filter(word => word.length > 2);
  
  // Initialize scoring factors
  const scoreFactors = {
    category: 0,
    priority: 0,
    keywords: 0,
    length: 0,
    urgency: 0,
  };
  
  // 1. Category-based complexity
  if (category && CATEGORY_COMPLEXITY[category]) {
    scoreFactors.category = CATEGORY_COMPLEXITY[category];
  } else {
    scoreFactors.category = 5; // Default medium complexity
  }
  
  // 2. Priority-based complexity
  scoreFactors.priority = PRIORITY_WEIGHTS[priority] * 1.5;
  
  // 3. Keyword-based complexity
  const technicalKeywordCount = TECHNICAL_KEYWORDS.filter(keyword => 
    text.includes(keyword.toLowerCase())
  ).length;
  const aiKeywordCount = Array.isArray(keywords) ? keywords.filter((keyword) => {
    const normalized = String(keyword || "").toLowerCase();
    return normalized && (
      TECHNICAL_KEYWORDS.includes(normalized) ||
      normalized.includes("vpn") ||
      normalized.includes("password") ||
      normalized.includes("outlook") ||
      normalized.includes("printer")
    );
  }).length : 0;
  scoreFactors.keywords = Math.min((technicalKeywordCount + aiKeywordCount) * 1.5, 5);
  
  // 4. Description length complexity (longer descriptions often indicate complex issues)
  const wordCount = words.length;
  if (wordCount < 20) {
    scoreFactors.length = 1;
  } else if (wordCount < 50) {
    scoreFactors.length = 2;
  } else if (wordCount < 100) {
    scoreFactors.length = 3;
  } else {
    scoreFactors.length = 4;
  }
  
  // 5. Urgency indicators
  const urgencyKeywordCount = URGENCY_KEYWORDS.filter(keyword => 
    text.includes(keyword.toLowerCase())
  ).length;
  scoreFactors.urgency = Math.min(urgencyKeywordCount * 1.5, 4);
  
  // Calculate final score (weighted average)
  const weights = {
    category: 0.3,
    priority: 0.25,
    keywords: 0.2,
    length: 0.1,
    urgency: 0.15,
  };
  
  const rawScore = 
    scoreFactors.category * weights.category +
    scoreFactors.priority * weights.priority +
    scoreFactors.keywords * weights.keywords +
    scoreFactors.length * weights.length +
    scoreFactors.urgency * weights.urgency;
  
  // Normalize to 1-10 scale
  const normalizedScore = Math.max(1, Math.min(10, Math.round(rawScore * 2)));
  
  // Calculate confidence based on how clear the signals are
  const confidence = calculateConfidence(scoreFactors, category, priority);
  
  // Determine recommended support level
  const recommendedLevel = getRecommendedSupportLevel(normalizedScore, category);
  
  // Generate reasoning
  const reasoning = generateReasoning(scoreFactors, category, priority, text);
  
  return {
    score: normalizedScore,
    confidence,
    factors: scoreFactors,
    recommended_level: recommendedLevel,
    reasoning,
  };
}

/**
 * Calculate confidence in the complexity score
 */
function calculateConfidence(
  factors: ScoreFactors, 
  category: string | null, 
  priority: string
): number {
  let confidence = 0.5; // Base confidence
  
  // Higher confidence if we have clear category
  if (category && CATEGORY_COMPLEXITY[category]) {
    confidence += 0.2;
  }
  
  // Higher confidence for clear priority
  if (priority !== "LOW") {
    confidence += 0.1;
  }
  
  // Higher confidence if we have technical keywords
  if (factors.keywords > 0) {
    confidence += 0.1;
  }
  
  // Higher confidence for longer descriptions
  if (factors.length >= 3) {
    confidence += 0.1;
  }
  
  return Math.min(0.95, confidence);
}

/**
 * Determine recommended support level based on complexity score
 */
function getRecommendedSupportLevel(score: number, category: string | null): "L1" | "L2" | "L3" {
  // Special cases for certain categories
  if (category === "SECURITY_INCIDENT") {
    return "L3";
  }
  
  if (category === "IDENTITY_ACCESS") {
    return score <= 4 ? "L1" : "L2";
  }
  
  // General scoring rules
  if (score <= 3) {
    return "L1";
  } else if (score <= 6) {
    return "L2";
  } else {
    return "L3";
  }
}

/**
 * Generate human-readable reasoning for the complexity score
 */
function generateReasoning(
  factors: ScoreFactors,
  category: string | null,
  priority: string,
  text: string
): string[] {
  const reasoning: string[] = [];
  
  if (category && CATEGORY_COMPLEXITY[category]) {
    reasoning.push(`Category "${category}" typically requires ${getComplexityDescription(CATEGORY_COMPLEXITY[category])} level support`);
  }
  
  if (priority === "HIGH") {
    reasoning.push("High priority indicates urgent attention needed");
  }
  
  if (factors.keywords > 0) {
    reasoning.push(`Contains ${factors.keywords > 1 ? factors.keywords : 'a'} technical keyword${factors.keywords > 1 ? 's' : ''} suggesting complexity`);
  }
  
  if (factors.urgency > 0) {
    reasoning.push(`Contains urgency indicators requiring faster escalation`);
  }
  
  if (factors.length >= 3) {
    reasoning.push("Detailed description suggests complex issue");
  }
  
  return reasoning;
}

/**
 * Get human-readable complexity description
 */
function getComplexityDescription(score: number): string {
  if (score <= 2) return "basic";
  if (score <= 4) return "intermediate";
  if (score <= 6) return "advanced";
  if (score <= 8) return "expert";
  return "critical";
}

/**
 * Update ticket with complexity score
 */
export async function updateTicketComplexity(
  ticketId: string,
  complexity: ComplexityScore,
  performedBy: string
): Promise<void> {
  await pool.query(
    `UPDATE tickets 
     SET complexity_score = $1, current_support_level = $2, updated_at = now()
     WHERE id = $3`,
    [complexity.score, complexity.recommended_level, ticketId]
  );
  
  // Log complexity analysis
  await pool.query(
    `INSERT INTO ticket_events (ticket_id, action, new_value, performed_by)
     VALUES ($1, 'COMPLEXITY_SCORED', $2, $3)`,
    [ticketId, JSON.stringify(complexity), performedBy]
  );
}

/**
 * Batch update complexity scores for tickets without them
 */
export async function batchUpdateComplexityScores(): Promise<number> {
  const result = await pool.query(
    `SELECT id, category, priority, title, description, created_by
     FROM tickets 
     WHERE complexity_score IS NULL 
     AND status IN ('OPEN', 'IN_PROGRESS')
     LIMIT 100`
  );
  
  let updated = 0;
  
  for (const ticket of result.rows) {
    const complexity = await calculateComplexityScore({
      category: ticket.category,
      priority: ticket.priority,
      title: ticket.title,
      description: ticket.description,
      keywords: [],
    });
    
    await updateTicketComplexity(ticket.id, complexity, ticket.created_by);
    updated++;
  }
  
  return updated;
}
