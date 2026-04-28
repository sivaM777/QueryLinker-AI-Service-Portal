-- Migration: 037_sentiment_analysis_and_agentic_ai.sql
-- Add tables for sentiment-based routing and agentic AI capabilities

-- Table for storing ticket sentiment analysis
CREATE TABLE ticket_sentiment_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    sentiment_score FLOAT NOT NULL, -- -1 to 1
    sentiment_label TEXT NOT NULL CHECK (sentiment_label IN ('NEGATIVE', 'NEUTRAL', 'POSITIVE')),
    confidence FLOAT NOT NULL,
    urgency_keywords TEXT[] DEFAULT '{}',
    escalation_recommended BOOLEAN DEFAULT false,
    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(ticket_id)
);

CREATE INDEX idx_ticket_sentiment_analysis_ticket_id ON ticket_sentiment_analysis(ticket_id);
CREATE INDEX idx_ticket_sentiment_analysis_escalation ON ticket_sentiment_analysis(escalation_recommended) WHERE escalation_recommended = true;

-- Table for AI actions taken on tickets (auto-resolutions, etc.)
CREATE TABLE ai_ticket_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL CHECK (action_type IN ('AUTO_PASSWORD_RESET', 'AUTO_ACCOUNT_UNLOCK', 'AUTO_KB_SUGGESTION', 'AUTO_ASSIGNMENT', 'PRIORITY_BUMP')),
    action_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (action_status IN ('PENDING', 'COMPLETED', 'FAILED', 'REJECTED')),
    action_payload JSONB,
    result_message TEXT,
    executed_by TEXT, -- 'AI_AGENT' or user who approved
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_ai_ticket_actions_ticket_id ON ai_ticket_actions(ticket_id);
CREATE INDEX idx_ai_ticket_actions_status ON ai_ticket_actions(action_status);

-- Table for workflow triggers (automation rules)
CREATE TABLE workflow_triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL CHECK (trigger_type IN ('SENTIMENT_NEGATIVE', 'KEYWORD_DETECTED', 'CATEGORY_MATCH', 'PRIORITY_HIGH', 'UNASSIGNED_TIMEOUT')),
    trigger_conditions JSONB NOT NULL, -- { keywords: [], sentiment_threshold: -0.5, timeout_minutes: 30 }
    action_type TEXT NOT NULL CHECK (action_type IN ('ASSIGN_TO_TEAM', 'ASSIGN_TO_USER', 'SEND_EMAIL', 'CALL_WEBHOOK', 'UPDATE_PRIORITY', 'ADD_TAG')),
    action_payload JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_workflow_triggers_active ON workflow_triggers(is_active) WHERE is_active = true;

-- Function to get high-priority tickets needing attention (for agent dashboard)
CREATE OR REPLACE FUNCTION get_escalated_tickets()
RETURNS TABLE(
    ticket_id UUID,
    title TEXT,
    priority TEXT,
    sentiment_score FLOAT,
    sentiment_label TEXT,
    urgency_keywords TEXT[],
    assigned_to UUID,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id,
        t.title,
        t.priority,
        COALESCE(tsa.sentiment_score, 0),
        COALESCE(tsa.sentiment_label, 'NEUTRAL'),
        COALESCE(tsa.urgency_keywords, '{}'),
        t.assigned_to,
        t.created_at
    FROM tickets t
    LEFT JOIN ticket_sentiment_analysis tsa ON t.id = tsa.ticket_id
    WHERE t.status IN ('OPEN', 'IN_PROGRESS')
      AND (
          t.priority IN ('HIGH', 'CRITICAL')
          OR tsa.escalation_recommended = true
          OR (tsa.sentiment_score < -0.5 AND tsa.analyzed_at > now() - interval '1 hour')
      )
    ORDER BY 
        CASE t.priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END,
        COALESCE(tsa.sentiment_score, 0) ASC,
        t.created_at ASC;
END;
$$ LANGUAGE plpgsql;
