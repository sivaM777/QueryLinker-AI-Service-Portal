-- Migration 014: Configurable Alert Rules

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_channel') THEN
    CREATE TYPE alert_channel AS ENUM ('EMAIL', 'SMS', 'IN_APP', 'WEBHOOK');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_event_type') THEN
    CREATE TYPE alert_event_type AS ENUM (
      'TICKET_CREATED',
      'TICKET_ASSIGNED',
      'TICKET_STATUS_CHANGED',
      'TICKET_RESOLVED',
      'TICKET_CLOSED',
      'SLA_FIRST_RESPONSE_BREACH',
      'SLA_RESOLUTION_BREACH',
      'TICKET_ESCALATED',
      'TICKET_COMMENTED'
    );
  END IF;
END$$;

-- Alert rules table
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0, -- Higher priority rules evaluated first
  
  -- Event type to trigger on
  event_type alert_event_type NOT NULL,
  
  -- Conditions (JSONB for flexibility)
  conditions JSONB NOT NULL DEFAULT '{}', -- e.g., {"category": ["Network"], "priority": ["HIGH"]}
  
  -- Channels to send alerts
  channels alert_channel[] NOT NULL DEFAULT ARRAY['EMAIL']::alert_channel[],
  
  -- Recipients
  recipient_user_ids UUID[] NULL, -- Specific users
  recipient_team_ids UUID[] NULL, -- All users in teams
  recipient_roles user_role[] NULL, -- All users with roles
  recipient_emails TEXT[] NULL, -- External email addresses
  recipient_phones TEXT[] NULL, -- External phone numbers
  
  -- Webhook configuration (if channel includes WEBHOOK)
  webhook_url TEXT NULL,
  webhook_secret TEXT NULL,
  
  -- Template customization
  email_subject_template TEXT NULL,
  email_body_template TEXT NULL,
  sms_template TEXT NULL,
  
  -- Metadata
  description TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled, priority) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_alert_rules_event_type ON alert_rules(event_type, enabled) WHERE enabled = true;

-- Alert history for tracking
CREATE TABLE IF NOT EXISTS alert_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  ticket_id UUID NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type alert_event_type NOT NULL,
  channel alert_channel NOT NULL,
  recipient TEXT NOT NULL, -- Email, phone, user_id, etc.
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  error_message TEXT NULL,
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(alert_rule_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_history_ticket ON alert_history(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_alert_history_status ON alert_history(status, created_at) WHERE status = 'pending';

-- Function to check if alert rule conditions match
CREATE OR REPLACE FUNCTION alert_rule_matches(
  rule_conditions JSONB,
  ticket_data JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  condition_key TEXT;
  condition_value JSONB;
  ticket_value JSONB;
BEGIN
  -- If no conditions, rule matches
  IF rule_conditions = '{}'::jsonb THEN
    RETURN true;
  END IF;

  -- Check each condition
  FOR condition_key, condition_value IN SELECT * FROM jsonb_each(rule_conditions)
  LOOP
    ticket_value := ticket_data->condition_key;
    
    -- If condition is an array, check if ticket value is in array
    IF jsonb_typeof(condition_value) = 'array' THEN
      IF NOT (ticket_value ?| (SELECT array_agg(value::text) FROM jsonb_array_elements_text(condition_value))) THEN
        RETURN false;
      END IF;
    -- If condition is a single value, check equality
    ELSIF ticket_value IS DISTINCT FROM condition_value THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
