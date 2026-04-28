-- Migration 009: External Ticket References (GLPI, Solman)

-- External ticket references table
CREATE TABLE IF NOT EXISTS external_ticket_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  external_system ticket_source_type NOT NULL CHECK (external_system IN ('GLPI', 'SOLMAN')),
  external_ticket_id TEXT NOT NULL,
  external_url TEXT NULL,
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ NULL,
  sync_status TEXT NULL, -- 'success', 'failed', 'pending'
  sync_error TEXT NULL,
  external_data JSONB NULL, -- Store full external ticket data
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(external_system, external_ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_external_tickets_ticket_id ON external_ticket_references(ticket_id);
CREATE INDEX IF NOT EXISTS idx_external_tickets_external ON external_ticket_references(external_system, external_ticket_id);
CREATE INDEX IF NOT EXISTS idx_external_tickets_sync ON external_ticket_references(sync_enabled, last_synced_at) WHERE sync_enabled = true;

-- External system configuration
CREATE TABLE IF NOT EXISTS external_system_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_type ticket_source_type NOT NULL CHECK (system_type IN ('GLPI', 'SOLMAN')),
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  api_key TEXT NULL,
  api_token TEXT NULL,
  username TEXT NULL,
  password TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sync_interval_minutes INTEGER NOT NULL DEFAULT 15,
  last_sync_at TIMESTAMPTZ NULL,
  config_data JSONB NULL, -- Additional system-specific config
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_configs_type ON external_system_configs(system_type, enabled) WHERE enabled = true;
