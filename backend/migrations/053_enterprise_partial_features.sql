-- Migration 053: Enterprise feature completion (channels, ticket relations/details, canned responses, Solman events)

-- Extend ticket source types for omnichannel intake
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_source_type') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ticket_source_type' AND e.enumlabel = 'SLACK'
    ) THEN
      ALTER TYPE ticket_source_type ADD VALUE 'SLACK';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ticket_source_type' AND e.enumlabel = 'TEAMS'
    ) THEN
      ALTER TYPE ticket_source_type ADD VALUE 'TEAMS';
    END IF;
  END IF;
END$$;

-- Channel integration configs (Slack / Teams / future chat channels)
CREATE TABLE IF NOT EXISTS channel_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('SLACK', 'TEAMS')),
  inbound_secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  default_requester_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  default_priority ticket_priority NOT NULL DEFAULT 'MEDIUM',
  default_category TEXT NULL,
  auto_create_ticket BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_integrations_name_type ON channel_integrations (channel_type, name);
CREATE INDEX IF NOT EXISTS idx_channel_integrations_enabled ON channel_integrations (enabled);

-- Channel ingestion audit events
CREATE TABLE IF NOT EXISTS channel_ingestion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES channel_integrations(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('SLACK', 'TEAMS')),
  external_message_id TEXT NULL,
  sender_email TEXT NULL,
  sender_name TEXT NULL,
  channel_room_id TEXT NULL,
  message_preview TEXT NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATED', 'IGNORED', 'ERROR')),
  reason TEXT NULL,
  classifier_confidence REAL NULL,
  classifier_label TEXT NULL,
  created_ticket_id UUID NULL REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_ingestion_events_integration ON channel_ingestion_events (integration_id, created_at DESC);

-- Ticket relationship graph (incident/problem/change correlation)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_relationship_type') THEN
    CREATE TYPE ticket_relationship_type AS ENUM (
      'CAUSE_OF',
      'RESOLVED_BY_CHANGE',
      'DUPLICATE_OF',
      'RELATED_TO',
      'BLOCKED_BY'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS ticket_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  target_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  relationship_type ticket_relationship_type NOT NULL,
  notes TEXT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ticket_relationships_source_target_unique UNIQUE (source_ticket_id, target_ticket_id, relationship_type),
  CONSTRAINT ticket_relationships_not_self CHECK (source_ticket_id <> target_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_relationships_source ON ticket_relationships (source_ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_relationships_target ON ticket_relationships (target_ticket_id);

-- Agent canned responses with optional KB linkage
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'canned_response_visibility') THEN
    CREATE TYPE canned_response_visibility AS ENUM ('GLOBAL', 'TEAM', 'PRIVATE');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS canned_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NULL,
  tags TEXT[] NULL,
  visibility canned_response_visibility NOT NULL DEFAULT 'TEAM',
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id UUID NULL REFERENCES teams(id) ON DELETE SET NULL,
  linked_article_id UUID NULL REFERENCES kb_articles(id) ON DELETE SET NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canned_responses_owner ON canned_responses (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_canned_responses_team_visibility ON canned_responses (team_id, visibility);
CREATE INDEX IF NOT EXISTS idx_canned_responses_usage ON canned_responses (usage_count DESC, updated_at DESC);

-- Solman ingestion audit events for parity with GLPI integration
CREATE TABLE IF NOT EXISTS solman_ingestion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solman_config_id UUID REFERENCES external_system_configs(id) ON DELETE CASCADE,
  external_ticket_id VARCHAR(255),
  external_url TEXT,
  action VARCHAR(50) NOT NULL,
  reason TEXT,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solman_ingestion_events_config_id ON solman_ingestion_events(solman_config_id);
CREATE INDEX IF NOT EXISTS idx_solman_ingestion_events_created_at ON solman_ingestion_events(created_at DESC);
